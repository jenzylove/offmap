import { randomUUID } from "node:crypto";
import { DEFAULT_RISK, applyBatch, buildStatement, commit, createNote, liquidationOps, randomSalt, totals, collateralValue, type Op, type RiskConfig } from "@offmap/core";
import type { Address } from "viem";
import { COHORTS, USDC_BASE, USDC_BASE_ID, USDC_INTENTS_ID, ETH_BASE_ID, config, type CohortConfig } from "./config.js";
import * as base from "./base.js";
import * as intents from "./intents.js";
import { cohortPrice } from "./prices.js";
import type { Identity } from "./identity.js";
import { save, type State, type Payout } from "./store.js";
import { runLeakStudy } from "./leak.js";
import { frozen, syncEjects } from "./ejects.js";

let helpers: Record<string, Address> | undefined;
/** The eject helper per cohort, read from the contract config (the single source of truth). */
async function helperFor(id: Identity, cohortId: string): Promise<Address | undefined> {
  if (!helpers) {
    const cfg: any = await id.viewContract("config", {});
    helpers = Object.fromEntries((cfg?.cohorts ?? []).map((k: any) => [k.id, k.eject_helper as Address]));
  }
  return helpers[cohortId];
}

let lastLeak = 0;

export const risk: RiskConfig = { ...DEFAULT_RISK, userCapLoan: config.userCapLoan };

/** Round lot sizes for private payouts of USDC (6 decimals): 1, 5, 10, 50, 100, 500 USDC. */
const LOTS = [500_000_000n, 100_000_000n, 50_000_000n, 10_000_000n, 5_000_000n, 1_000_000n];
export function splitLots(amount: bigint): bigint[] {
  const out: bigint[] = [];
  let left = amount;
  for (const lot of LOTS) while (left >= lot) { out.push(lot); left -= lot; }
  if (left > 0n) out.push(left);
  return out;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
/** Last error per stage, served on /health so a failing batch is never invisible. */
export const engineErrors: Record<string, { at: string; error: string }> = {};
const note = (key: string, e: unknown) => { engineErrors[key] = { at: new Date().toISOString(), error: String((e as any)?.message ?? e).slice(0, 500) }; };

/** Pull the status of every waiting deposit; mark arrivals with the amount that reached the confidential balance. */
async function pollDeposits(s: State) {
  for (const p of s.pending.filter((p) => p.status === "waiting")) {
    try {
      const st = await intents.status(p.depositAddress);
      if (st.status === "SUCCESS") { p.status = "arrived"; p.arrivedAmount = String(st.swapDetails.amountOut); }
      else if (["REFUNDED", "FAILED"].includes(st.status)) { p.status = "failed"; p.note = st.status; }
      else if (Date.now() - p.createdAt > 26 * 3600e3) { p.status = "failed"; p.note = "expired"; }
    } catch (e) { note("poll", e); log("poll", p.id, String(e)); }
  }
}

/** Keep a little ETH on the cohort address for gas, bought from the confidential USDC balance. */
async function ensureGas(id: Identity, c: CohortConfig) {
  const addr = base.cohortAddress(id.mpcPredecessor, c.id);
  if ((await base.ethBalance(addr)) >= config.minGasEth) return;
  const { quote } = await intents.payFromConfidential(id, { asset: USDC_INTENTS_ID, amount: "1000000", destinationAsset: ETH_BASE_ID, recipient: addr });
  await intents.waitFor(quote.depositAddress);
}

/** One batch for one cohort. Returns the Base transactions it made. Throws before touching the ledger if any step fails. */
export async function runCohort(id: Identity, s: State, c: CohortConfig) {
  const ledger = s.ledgers[c.id]!;
  const addr = base.cohortAddress(id.mpcPredecessor, c.id) as Address;
  const txs: string[] = [];
  const { price } = await cohortPrice(c);
  const now = Math.floor(Date.now() / 1000);
  await ensureFreshStatement(id, s, c, price, addr);
  if (config.contractId) {
    // Ejects first: a user who exited must not stay in the ledger, and one in flight is frozen.
    await syncEjects(id, s, c);
    const helper = await helperFor(id, c.id);
    if (helper && !(await base.helperIsAuthorized(addr, helper))) { await ensureGas(id, c); txs.push(...(await base.authorizeHelper(id, c, helper))); }
  }
  const out = frozen(s, c.id);

  // 1. Collateral that arrived privately: move it to the cohort on Base and supply it. Users are credited with what lands.
  const arrived = s.pending.filter((p) => p.status === "arrived" && p.kind === "deposit" && p.cohortId === c.id && !out.has(p.userId));
  const ops: Op[] = [];
  if (arrived.length) {
    const total = arrived.reduce((a, p) => a + BigInt(p.arrivedAmount!), 0n);
    await ensureGas(id, c);
    // Trust the chain, not a status message: collateral that already sits idle on the cohort address
    // (a transit that landed but was reported as failed) is supplied as is, never moved twice.
    const idle = await base.erc20Balance(c.collateralToken, addr);
    let landed: bigint;
    if (idle * 100n >= total * 98n) {
      landed = idle;
    } else {
      const before = idle;
      const { quote } = await intents.payFromConfidential(id, { asset: c.collateralAssetId, amount: total.toString(), destinationAsset: c.collateralAssetId, recipient: addr });
      const st = await intents.waitFor(quote.depositAddress);
      landed = (await base.erc20Balance(c.collateralToken, addr)) - before;
      if (landed <= 0n) throw new Error(`collateral transit ${st.status}, nothing landed on ${addr}`);
    }
    txs.push(...(await base.supply(id, c, landed)));
    let left = landed;
    arrived.forEach((p, i) => {
      const share = i === arrived.length - 1 ? left : (landed * BigInt(p.arrivedAmount!)) / total;
      left -= share;
      p.status = "supplied";
      p.suppliedAmount = share.toString();
    });
    save(s); // checkpoint: collateral is on Morpho, never move it again
  }
  const supplied = s.pending.filter((p) => p.status === "supplied" && p.cohortId === c.id && !out.has(p.userId));
  for (const p of supplied) {
    ops.push({ kind: "deposit", userId: p.userId, amount: BigInt(p.suppliedAmount!) });
    if (p.borrow && BigInt(p.borrow) > 0n && !s.requests.some((r) => r.id === `borrow:${p.id}`)) {
      s.requests.push({ id: `borrow:${p.id}`, kind: "borrow", userId: p.userId, cohortId: c.id, amount: p.borrow, receive: p.receive!, createdAt: Date.now(), status: "queued" });
    }
  }

  // 2. Repayments that arrived privately as USDC.
  const repays = s.pending.filter((p) => p.status === "arrived" && p.kind === "repay" && p.cohortId === c.id && !out.has(p.userId));
  for (const p of repays) { ops.push({ kind: "repay", userId: p.userId, amount: BigInt(p.arrivedAmount!) }); }

  // 3. Borrow and withdraw requests, then private liquidations.
  for (const r of s.requests.filter((r) => r.status === "queued" && r.cohortId === c.id && out.has(r.userId))) { r.status = "rejected"; r.reason = "eject in progress"; }
  const queued = s.requests.filter((r) => r.status === "queued" && r.cohortId === c.id);
  for (const r of queued) ops.push({ kind: r.kind, userId: r.userId, amount: BigInt(r.amount) } as Op);

  // Dry run first: liquidations are computed on the ledger after this batch's other ops.
  let res = applyBatch(ledger, ops, { price, timestamp: now, aprBps: 600n, risk, saltFor: () => randomSalt() });
  const liq = liquidationOps(res.ledger, price, risk).filter((o) => !out.has(o.userId));
  if (liq.length) res = applyBatch(ledger, [...ops, ...liq], { price, timestamp: now, aprBps: 600n, risk, saltFor: () => randomSalt() });

  // 4. Execute the one net change on Morpho. Repays and liquidation proceeds net against new borrows inside the confidential pool.
  const repaidUsdc = repays.reduce((a, p) => a + BigInt(p.arrivedAmount!), 0n);
  const borrowed = res.applied.filter((o) => o.kind === "borrow").reduce((a, o) => a + (o as any).amount, 0n);
  const withdrawn = res.applied.filter((o) => o.kind === "withdraw").reduce((a, o) => a + (o as any).amount, 0n);
  const liqSold = res.liquidations.reduce((a, l) => a + l.collateralSold + l.penaltyCollateral, 0n);

  if (withdrawn + liqSold > 0n) {
    await ensureGas(id, c);
    // Idempotent: collateral already idle on the cohort (a withdraw whose return failed) counts first.
    const idle = await base.erc20Balance(c.collateralToken, addr);
    if (idle < withdrawn + liqSold) txs.push(...(await base.withdraw(id, c, withdrawn + liqSold - idle)));
    const q = await intents.quoteFromBaseIntoConfidential(id, { baseAsset: c.collateralAssetId, amount: (withdrawn + liqSold).toString(), asset: c.collateralAssetId, refundTo: addr });
    txs.push(await base.transfer(id, c, c.collateralToken, q.depositAddress as Address, withdrawn + liqSold));
    // The collateral has left Morpho: commit the batch either way. A refund comes back to the cohort address.
    const st = await intents.waitFor(q.depositAddress).catch((e) => ({ status: String(e) }));
    if (st.status !== "SUCCESS") note(`return:${c.id}`, `collateral sent to Intents, status ${st.status}; refunds come back to ${addr}`);
  }
  if (liqSold > 0n) {
    // Private liquidation: sell the seized collateral for USDC inside the confidential balance. No public auction.
    const { quote } = await intents.payFromConfidential(id, { asset: c.collateralAssetId, amount: liqSold.toString(), destinationAsset: USDC_INTENTS_ID, recipient: id.intentsSigner, recipientType: "CONFIDENTIAL_INTENTS" });
    await intents.waitFor(quote.depositAddress);
  }
  const liqRepaid = res.liquidations.reduce((a, l) => a + l.repaid, 0n);
  const netDebt = borrowed - repaidUsdc - liqRepaid;
  if (netDebt > 0n) {
    await ensureGas(id, c);
    // Idempotent: USDC already idle on the cohort (a borrow whose return was reported as failed) counts first.
    const idleUsdc = await base.erc20Balance(USDC_BASE, addr);
    if (idleUsdc < netDebt) txs.push(...(await base.borrow(id, c, netDebt - idleUsdc)));
    const q = await intents.quoteFromBaseIntoConfidential(id, { baseAsset: USDC_BASE_ID, amount: netDebt.toString(), asset: USDC_INTENTS_ID, refundTo: addr });
    txs.push(await base.transfer(id, c, USDC_BASE, q.depositAddress as Address, netDebt));
    const st = await intents.waitFor(q.depositAddress);
    if (st.status !== "SUCCESS") note(`return:${c.id}`, `borrowed USDC sent to Intents, status ${st.status}; refunds come back to ${addr}`);
  } else if (netDebt < 0n) {
    const need = -netDebt;
    const before = await base.erc20Balance(USDC_BASE, addr);
    if (before < need) {
      const { quote } = await intents.payFromConfidential(id, { asset: USDC_INTENTS_ID, amount: (need - before).toString(), destinationAsset: USDC_BASE_ID, recipient: addr });
      await intents.waitFor(quote.depositAddress);
    }
    const have = await base.erc20Balance(USDC_BASE, addr);
    if (have <= 0n) throw new Error("repay transit: no USDC landed on the cohort");
    txs.push(...(await base.repay(id, c, have < need ? have : need)));
  }

  // 5. Commit: new ledger, statement on offmap.near, notes, payouts.
  s.ledgers[c.id] = res.ledger;
  for (const p of [...repays, ...supplied]) p.status = "applied";
  for (const r of queued) {
    const rej = res.rejected.find((x) => (x.op as any).userId === r.userId && x.op.kind === r.kind && (x.op as any).amount === BigInt(r.amount));
    r.status = rej ? "rejected" : "applied";
    if (rej) r.reason = rej.reason;
    else if (r.kind === "borrow") queuePayouts(s, r.userId, USDC_INTENTS_ID, BigInt(r.amount), r.receive);
    else if (r.kind === "withdraw") queuePayouts(s, r.userId, c.collateralAssetId, BigInt(r.amount), r.receive, false);
  }
  // The ledger is committed; a failed statement post is retried by the freshness check on the next tick.
  let batchId: string, cm: ReturnType<typeof commit>, statementTx: string | undefined;
  try { ({ batchId, cm, statementTx } = await postStatement(id, s, c, res.ledger, price, addr)); }
  catch (e) { note(`statement:${c.id}`, e); batchId = String(s.batchCounter[c.id]); cm = commit(res.ledger); }
  for (const p of res.ledger.positions.values()) s.notes[`${c.id}:${p.userId}`] = createNote(p, cm, batchId);
  s.batches.push({ batchId, cohortId: c.id, at: Date.now(), txs, statementTx, delta: { collateral: res.delta.collateralDelta.toString(), debt: res.delta.debtDelta.toString() }, usersChanged: new Set(res.applied.map((o) => o.userId)).size });
  save(s);
  log("batch", c.id, batchId, "ops", res.applied.length, "rejected", res.rejected.length, "liquidations", res.liquidations.length, "txs", txs.length);
}

/** Publishes the solvency statement for a ledger on the contract. Returns the batch id and commitment. */
async function postStatement(id: Identity, s: State, c: CohortConfig, ledger: State["ledgers"][string], price: bigint, addr: Address) {
  const batchId = String(++s.batchCounter[c.id]!);
  const cm = commit(ledger);
  const stmt = buildStatement(ledger, cm, batchId, Date.now());
  let statementTx: string | undefined;
  if (config.contractId) {
    const t = totals(ledger);
    const onchain = await base.position(c, addr);
    const r: any = await id.callContract("submit_statement", { stmt: {
      cohort_id: c.id, batch_id: batchId, total_collateral: t.collateral.toString(), total_debt: t.debt.toString(),
      reserve: ledger.reserve.toString(), collateral_value_loan: collateralValue(t.collateral, price, c).toString(),
      borrow_shares: onchain.borrowShares.toString(), merkle_root: stmt.merkleRoot, leaf_count: stmt.leafCount, timestamp_ms: String(stmt.timestamp) } });
    statementTx = r?.transaction?.hash;
  }
  save(s);
  return { batchId, cm, stmt, statementTx };
}

/** The contract signs only for a cohort with a fresh statement: post one for the current ledger first if needed. */
async function ensureFreshStatement(id: Identity, s: State, c: CohortConfig, price: bigint, addr: Address) {
  if (!config.contractId) return;
  const v: any = await id.viewContract("statement", { cohort_id: c.id }).catch(() => null);
  const acceptedAt = Number(v?.accepted_at_ms ?? 0);
  if (!v || Date.now() - acceptedAt > 20 * 60_000) await postStatement(id, s, c, s.ledgers[c.id]!, price, addr);
}

/** Borrowed USDC leaves in round lots, each after a random delay, to blunt amount and timing links. */
function queuePayouts(s: State, userId: string, asset: string, amount: bigint, receive: { asset: string; address: string }, lots = true) {
  const parts = lots ? splitLots(amount) : [amount];
  let t = Date.now();
  for (const part of parts) {
    t += 60_000 + Math.floor(Math.random() * 9 * 60_000);
    s.payouts.push({ id: randomUUID(), userId, asset, amount: part.toString(), destinationAsset: receive.asset, recipient: receive.address, notBefore: t, status: "queued" } as Payout);
  }
}

async function runPayouts(id: Identity, s: State) {
  // Payouts sent before a restart: resolve them from their status instead of leaving them stuck.
  for (const p of s.payouts.filter((p) => p.status === "sent" && p.deposit)) {
    try {
      const st = await intents.status(p.deposit!);
      if (st.status === "SUCCESS") { p.status = "done"; p.tx = st.swapDetails?.destinationChainTxHashes?.[0]?.hash; }
      else if (["REFUNDED", "FAILED"].includes(st.status)) p.status = "failed";
      // Recorded but never submitted: its quote expired unused, so it is safe to send again.
      else if (st.status === "PENDING_DEPOSIT" && Date.now() - (p.sentAt ?? 0) > 3 * 3600e3) p.status = "failed";
      else if (st.status === "INCOMPLETE_DEPOSIT") { p.status = "failed"; p.tries = 3; note("payout", `${p.id} incomplete, held for review`); }
    } catch (e) { note("payout", e); }
  }
  // A failed lot is retried (at most three times) instead of being dropped.
  for (const p of s.payouts.filter((p) => p.status === "failed" && (p.tries ?? 0) < 3)) { p.status = "queued"; p.notBefore = Date.now(); p.deposit = undefined; }
  for (const p of s.payouts.filter((p) => p.status === "queued" && p.notBefore <= Date.now())) {
    try {
      // Transit fees leave the private balance slightly under the borrowed total: pay what is there, never more than owed.
      const available = (await intents.confidentialBalances(id)).get(p.asset) ?? 0n;
      const amount = BigInt(p.amount) < available ? BigInt(p.amount) : available;
      if (amount <= 0n) { note("payout", `nothing available for ${p.asset}`); continue; }
      p.tries = (p.tries ?? 0) + 1;
      // Recorded as sent before the intent is submitted: a crash or a lost response is resolved from its status, never paid twice.
      const { quote } = await intents.payFromConfidential(id, { asset: p.asset, amount: amount.toString(), destinationAsset: p.destinationAsset, recipient: p.recipient,
        beforeSubmit: (q) => { p.status = "sent"; p.deposit = q.depositAddress; p.sentAt = Date.now(); p.amount = amount.toString(); save(s); } });
      const st = await intents.waitFor(quote.depositAddress);
      if (st.status === "SUCCESS") { p.status = "done"; p.tx = st.swapDetails?.destinationChainTxHashes?.[0]?.hash; }
      else if (["REFUNDED", "FAILED"].includes(st.status)) p.status = "failed";
      save(s);
    } catch (e) { note("payout", e); log("payout", p.id, String(e)); }
  }
}

async function needsLiquidation(s: State, c: CohortConfig): Promise<boolean> {
  try {
    const { price } = await cohortPrice(c);
    return liquidationOps(s.ledgers[c.id]!, price, risk).length > 0;
  } catch { return false; }
}

let running = false;
export async function tick(id: Identity, s: State) {
  if (running) return;
  running = true;
  try {
    await pollDeposits(s);
    for (const c of COHORTS) {
      const moves = s.pending.some((p) => p.cohortId === c.id && (p.status === "arrived" || p.status === "supplied")) || s.requests.some((r) => r.cohortId === c.id && r.status === "queued");
      const open = s.ledgers[c.id]!.positions.size > 0;
      const last = s.batches.filter((b) => b.cohortId === c.id).at(-1)?.at ?? 0;
      // Open positions are checked every tick for private liquidation; a statement is refreshed at least every 15 minutes.
      const needsLiq = open && (await needsLiquidation(s, c));
      if (!moves && !needsLiq && !(open && Date.now() - last > 15 * 60_000)) continue;
      try { await runCohort(id, s, c); delete engineErrors[`cohort:${c.id}`]; } catch (e) { note(`cohort:${c.id}`, e); log("cohort", c.id, "failed, ledger unchanged:", String(e)); }
    }
    await runPayouts(id, s);
    if (Date.now() - lastLeak > 3600_000) { lastLeak = Date.now(); await runLeakStudy(s).catch((e) => { note("leak", e); log("leak", String(e)); }); }
    save(s);
  } finally { running = false; }
}
