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

/** Pull the status of every waiting deposit; mark arrivals with the amount that reached the confidential balance. */
async function pollDeposits(s: State) {
  for (const p of s.pending.filter((p) => p.status === "waiting")) {
    try {
      const st = await intents.status(p.depositAddress);
      if (st.status === "SUCCESS") { p.status = "arrived"; p.arrivedAmount = String(st.swapDetails.amountOut); }
      else if (["REFUNDED", "FAILED"].includes(st.status)) { p.status = "failed"; p.note = st.status; }
      else if (Date.now() - p.createdAt > 26 * 3600e3) { p.status = "failed"; p.note = "expired"; }
    } catch (e) { log("poll", p.id, String(e)); }
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

  // 1. Collateral that arrived privately: move it to the cohort on Base and supply it. Users are credited with what lands.
  const arrived = s.pending.filter((p) => p.status === "arrived" && p.kind === "deposit" && p.cohortId === c.id);
  const ops: Op[] = [];
  if (arrived.length) {
    const total = arrived.reduce((a, p) => a + BigInt(p.arrivedAmount!), 0n);
    await ensureGas(id, c);
    const before = await base.erc20Balance(c.collateralToken, addr);
    const { quote } = await intents.payFromConfidential(id, { asset: c.collateralAssetId, amount: total.toString(), destinationAsset: c.collateralAssetId, recipient: addr });
    const st = await intents.waitFor(quote.depositAddress);
    if (st.status !== "SUCCESS") throw new Error(`collateral transit ${st.status}`);
    const landed = (await base.erc20Balance(c.collateralToken, addr)) - before;
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
  const supplied = s.pending.filter((p) => p.status === "supplied" && p.cohortId === c.id);
  for (const p of supplied) {
    ops.push({ kind: "deposit", userId: p.userId, amount: BigInt(p.suppliedAmount!) });
    if (p.borrow && BigInt(p.borrow) > 0n && !s.requests.some((r) => r.id === `borrow:${p.id}`)) {
      s.requests.push({ id: `borrow:${p.id}`, kind: "borrow", userId: p.userId, cohortId: c.id, amount: p.borrow, receive: p.receive!, createdAt: Date.now(), status: "queued" });
    }
  }

  // 2. Repayments that arrived privately as USDC.
  const repays = s.pending.filter((p) => p.status === "arrived" && p.kind === "repay" && p.cohortId === c.id);
  for (const p of repays) { ops.push({ kind: "repay", userId: p.userId, amount: BigInt(p.arrivedAmount!) }); }

  // 3. Borrow and withdraw requests, then private liquidations.
  const queued = s.requests.filter((r) => r.status === "queued" && r.cohortId === c.id);
  for (const r of queued) ops.push({ kind: r.kind, userId: r.userId, amount: BigInt(r.amount) } as Op);

  // Dry run first: liquidations are computed on the ledger after this batch's other ops.
  let res = applyBatch(ledger, ops, { price, timestamp: now, aprBps: 600n, risk, saltFor: () => randomSalt() });
  const liq = liquidationOps(res.ledger, price, risk);
  if (liq.length) res = applyBatch(ledger, [...ops, ...liq], { price, timestamp: now, aprBps: 600n, risk, saltFor: () => randomSalt() });

  // 4. Execute the one net change on Morpho. Repays and liquidation proceeds net against new borrows inside the confidential pool.
  const repaidUsdc = repays.reduce((a, p) => a + BigInt(p.arrivedAmount!), 0n);
  const borrowed = res.applied.filter((o) => o.kind === "borrow").reduce((a, o) => a + (o as any).amount, 0n);
  const withdrawn = res.applied.filter((o) => o.kind === "withdraw").reduce((a, o) => a + (o as any).amount, 0n);
  const liqSold = res.liquidations.reduce((a, l) => a + l.collateralSold + l.penaltyCollateral, 0n);

  if (withdrawn + liqSold > 0n) {
    await ensureGas(id, c);
    txs.push(...(await base.withdraw(id, c, withdrawn + liqSold)));
    const q = await intents.quoteFromBaseIntoConfidential(id, { baseAsset: c.collateralAssetId, amount: (withdrawn + liqSold).toString(), asset: c.collateralAssetId, refundTo: addr });
    txs.push(await base.transfer(id, c, c.collateralToken, q.depositAddress as Address, withdrawn + liqSold));
    if ((await intents.waitFor(q.depositAddress)).status !== "SUCCESS") throw new Error("collateral return failed");
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
    txs.push(...(await base.borrow(id, c, netDebt)));
    const q = await intents.quoteFromBaseIntoConfidential(id, { baseAsset: USDC_BASE_ID, amount: netDebt.toString(), asset: USDC_INTENTS_ID, refundTo: addr });
    txs.push(await base.transfer(id, c, USDC_BASE, q.depositAddress as Address, netDebt));
    if ((await intents.waitFor(q.depositAddress)).status !== "SUCCESS") throw new Error("borrow return failed");
  } else if (netDebt < 0n) {
    const need = -netDebt;
    const before = await base.erc20Balance(USDC_BASE, addr);
    const { quote } = await intents.payFromConfidential(id, { asset: USDC_INTENTS_ID, amount: need.toString(), destinationAsset: USDC_BASE_ID, recipient: addr });
    if ((await intents.waitFor(quote.depositAddress)).status !== "SUCCESS") throw new Error("repay transit failed");
    txs.push(...(await base.repay(id, c, (await base.erc20Balance(USDC_BASE, addr)) - before)));
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
  const batchId = String(++s.batchCounter[c.id]!);
  const cm = commit(res.ledger);
  const stmt = buildStatement(res.ledger, cm, batchId, Date.now());
  let statementTx: string | undefined;
  if (config.contractId) {
    const t = totals(res.ledger);
    const r: any = await id.callContract("submit_statement", { stmt: {
      cohort_id: c.id, batch_id: Number(batchId), total_collateral: t.collateral.toString(), total_debt: t.debt.toString(),
      collateral_value_loan: collateralValue(t.collateral, price, c).toString(), reserve: res.ledger.reserve.toString(),
      merkle_root: stmt.merkleRoot, leaf_count: stmt.leafCount, timestamp_ms: stmt.timestamp } });
    statementTx = r?.transaction?.hash;
  }
  for (const p of res.ledger.positions.values()) s.notes[`${c.id}:${p.userId}`] = createNote(p, cm, batchId);
  s.batches.push({ batchId, cohortId: c.id, at: Date.now(), txs, statementTx, delta: { collateral: res.delta.collateralDelta.toString(), debt: res.delta.debtDelta.toString() }, usersChanged: new Set(res.applied.map((o) => o.userId)).size });
  save(s);
  log("batch", c.id, batchId, "ops", res.applied.length, "rejected", res.rejected.length, "liquidations", res.liquidations.length, "txs", txs.length);
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
  for (const p of s.payouts.filter((p) => p.status === "queued" && p.notBefore <= Date.now())) {
    try {
      const { quote } = await intents.payFromConfidential(id, { asset: p.asset, amount: p.amount, destinationAsset: p.destinationAsset, recipient: p.recipient });
      p.status = "sent"; p.deposit = quote.depositAddress; save(s);
      const st = await intents.waitFor(quote.depositAddress);
      p.status = st.status === "SUCCESS" ? "done" : "failed";
      p.tx = st.swapDetails?.destinationChainTxHashes?.[0]?.hash;
      save(s);
    } catch (e) { log("payout", p.id, String(e)); }
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
      try { await runCohort(id, s, c); } catch (e) { log("cohort", c.id, "failed, ledger unchanged:", String(e)); }
    }
    await runPayouts(id, s);
    if (Date.now() - lastLeak > 3600_000) { lastLeak = Date.now(); await runLeakStudy(s).catch((e) => log("leak", String(e))); }
    save(s);
  } finally { running = false; }
}
