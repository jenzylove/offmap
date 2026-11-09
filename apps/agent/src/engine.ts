import { randomUUID } from "node:crypto";
import { DEFAULT_RISK, applyBatch, buildStatement, commit, createNote, liquidationOps, randomSalt, totals, collateralValue, type Op, type RiskConfig } from "@offmap/core";
import type { Address } from "viem";
import { COHORTS, USDC_BASE, USDC_BASE_ID, USDC_INTENTS_ID, ETH_BASE_ID, config, type CohortConfig } from "./config.js";
import * as base from "./base.js";
import * as intents from "./intents.js";
import { cohortPrice } from "./prices.js";
import type { Identity } from "./identity.js";
import { save, type State, type Payout, type Plan } from "./store.js";
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
/** USDC (6 decimals) spent on Base gas since start, and USDC still owed in queued remainders. */
export let gasSpentUsdc = 0n;
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
  // Gas bought from the pooled balance is recorded and published on /health, never hidden in a payout.
  gasSpentUsdc += 1_000_000n;
  const { quote } = await intents.payFromConfidential(id, { asset: USDC_INTENTS_ID, amount: "1000000", destinationAsset: ETH_BASE_ID, recipient: addr });
  await intents.waitFor(quote.depositAddress);
}

/**
 * One batch for one cohort, under the contract's batch lock.
 *
 * While the lock is open the contract refuses ejects, and it never opens while an eject is still being
 * signed. So when the agent reads the eject list inside the lock it is complete, nobody can eject against
 * the old statement any more, and the new statement goes on chain before any money moves. After that,
 * an eject against the new statement is consistent with the moves still running (its leaf already counts
 * them), so the lock can close even if a move has to be resumed on a later tick.
 */
export async function runCohort(id: Identity, s: State, c: CohortConfig) {
  const addr = base.cohortAddress(id.mpcPredecessor, c.id) as Address;
  const { price } = await cohortPrice(c);
  await ensureFreshStatement(id, s, c, price, addr);
  if (config.contractId) await syncEjects(id, s, c);

  // 0. Collateral that arrived privately moves to the cohort address before the lock (no signature needed).
  if (!s.inflight?.[c.id]) await bringDeposits(id, s, c, addr);

  // A plan whose signed moves are all done only waits on Intents: resolve it without taking the lock.
  const pending = s.inflight?.[c.id];
  if (pending && !needsSigning(pending)) { await execute(id, s, c, pending); return; }
  await ensureGas(id, c); // bought before the lock, so the lock is never held while gas is in transit
  // The contract returns our own open lock if an earlier run was interrupted; another agent's lock is refused.
  if (config.contractId) await id.callContract("begin_batch", { cohort_id: c.id });
  try {
    if (config.contractId) {
      const helper = await helperFor(id, c.id);
      if (helper && !(await base.helperIsAuthorized(addr, helper))) { await ensureGas(id, c); await base.authorizeHelper(id, c, helper); }
    }
    const open = s.inflight?.[c.id];
    if (open) { await execute(id, s, c, open); return; }
    await commitBatch(id, s, c, addr, price);
    await execute(id, s, c, s.inflight![c.id]!);
  } finally {
    if (config.contractId) await id.callContract("end_batch", { cohort_id: c.id }).catch((e) => note(`lock:${c.id}`, e));
  }
}

/** Moves arrived collateral from the private balance to the cohort address. Users are credited with what lands. */
async function bringDeposits(id: Identity, s: State, c: CohortConfig, addr: Address) {
  const out = frozen(s, c.id);
  const arrived = s.pending.filter((p) => p.status === "arrived" && p.kind === "deposit" && p.cohortId === c.id && !out.has(p.userId));
  if (!arrived.length) return;
  const total = arrived.reduce((a, p) => a + BigInt(p.arrivedAmount!), 0n);
  // Trust the chain, not a status message: collateral already idle on the cohort address is used as is, never moved twice.
  const idle = await base.erc20Balance(c.collateralToken, addr);
  let landed: bigint;
  if (idle * 100n >= total * 98n) landed = idle;
  else {
    const { quote } = await intents.payFromConfidential(id, { asset: c.collateralAssetId, amount: total.toString(), destinationAsset: c.collateralAssetId, recipient: addr });
    const st = await intents.waitFor(quote.depositAddress);
    landed = (await base.erc20Balance(c.collateralToken, addr)) - idle;
    if (landed <= 0n) throw new Error(`collateral transit ${st.status}, nothing landed on ${addr}`);
  }
  let left = landed;
  arrived.forEach((p, i) => {
    const share = i === arrived.length - 1 ? left : (landed * BigInt(p.arrivedAmount!)) / total;
    left -= share;
    p.status = "onbase";
    p.suppliedAmount = share.toString();
  });
  save(s);
}

/** Inside the lock: supply, read the complete eject list, compute, post the statement, save the plan and notes. */
async function commitBatch(id: Identity, s: State, c: CohortConfig, addr: Address, price: bigint) {
  const txs: string[] = [];
  const onBase = s.pending.filter((p) => p.status === "onbase" && p.cohortId === c.id);
  if (onBase.length) {
    const amount = onBase.reduce((a, p) => a + BigInt(p.suppliedAmount!), 0n);
    const idle = await base.erc20Balance(c.collateralToken, addr);
    txs.push(...(await base.supply(id, c, idle < amount ? idle : amount)));
    for (const p of onBase) p.status = "supplied";
    save(s); // checkpoint: collateral is on Morpho, never move it again
  }
  // Complete inside the lock: no eject can be signed now and none is mid signature.
  if (config.contractId) await syncEjects(id, s, c);
  const out = frozen(s, c.id);
  const ledger = s.ledgers[c.id]!;
  const now = Math.floor(Date.now() / 1000);
  const ops: Op[] = [];

  const supplied = s.pending.filter((p) => p.status === "supplied" && p.cohortId === c.id && !out.has(p.userId));
  for (const p of supplied) {
    ops.push({ kind: "deposit", userId: p.userId, amount: BigInt(p.suppliedAmount!) });
    if (p.borrow && BigInt(p.borrow) > 0n && !s.requests.some((r) => r.id === `borrow:${p.id}`)) {
      s.requests.push({ id: `borrow:${p.id}`, kind: "borrow", userId: p.userId, cohortId: c.id, amount: p.borrow, receive: p.receive!, createdAt: Date.now(), status: "queued" });
    }
  }
  const repays = s.pending.filter((p) => p.status === "arrived" && p.kind === "repay" && p.cohortId === c.id && !out.has(p.userId));
  for (const p of repays) ops.push({ kind: "repay", userId: p.userId, amount: BigInt(p.arrivedAmount!) });
  for (const r of s.requests.filter((r) => r.status === "queued" && r.cohortId === c.id && out.has(r.userId))) { r.status = "rejected"; r.reason = "eject in progress"; }
  const queued = s.requests.filter((r) => r.status === "queued" && r.cohortId === c.id);
  for (const r of queued) ops.push({ kind: r.kind, userId: r.userId, amount: BigInt(r.amount) } as Op);

  // Dry run first: liquidations are computed on the ledger after this batch's other ops.
  let res = applyBatch(ledger, ops, { price, timestamp: now, aprBps: 600n, risk, saltFor: () => randomSalt() });
  const liq = liquidationOps(res.ledger, price, risk).filter((o) => !out.has(o.userId));
  if (liq.length) res = applyBatch(ledger, [...ops, ...liq], { price, timestamp: now, aprBps: 600n, risk, saltFor: () => randomSalt() });

  // A user whose eject failed keeps a leaf the contract marked as spent: give them a fresh one, before the
  // root is computed, so the posted root and every note agree.
  for (const u of s.retouch?.[c.id] ?? []) { const p = res.ledger.positions.get(u); if (p) { p.nonce += 1n; p.salt = randomSalt(); } }
  // The statement goes on chain before any money moves.
  const { batchId, statementTx } = await postStatement(id, s, c, res.ledger, price, addr);
  if (s.retouch) s.retouch[c.id] = [];
  if (s.rootDirty) s.rootDirty[c.id] = false;
  s.ledgers[c.id] = res.ledger;
  for (const p of [...repays, ...supplied]) p.status = "applied";
  const plan: Plan = {
    batchId, withdraws: [], borrows: [], done: [], txs,
    liqSold: res.liquidations.reduce((a, l) => a + l.collateralSold + l.penaltyCollateral, 0n).toString(),
    liqRepaid: res.liquidations.reduce((a, l) => a + l.repaid, 0n).toString(),
    repaid: repays.reduce((a, p) => a + BigInt(p.arrivedAmount!), 0n).toString(),
    delta: { collateral: res.delta.collateralDelta.toString(), debt: res.delta.debtDelta.toString() },
    usersChanged: new Set(res.applied.map((o) => o.userId)).size, statementTx,
  };
  for (const r of queued) {
    const rej = res.rejected.find((x) => (x.op as any).userId === r.userId && x.op.kind === r.kind && (x.op as any).amount === BigInt(r.amount));
    r.status = rej ? "rejected" : "applied";
    if (rej) { r.reason = rej.reason; continue; }
    (r.kind === "borrow" ? plan.borrows : plan.withdraws).push({ userId: r.userId, amount: r.amount, receive: r.receive });
  }
  // Notes for the new statement, except for users with an eject in flight: they must not get a second leaf.
  const cm = commit(res.ledger);
  for (const p of res.ledger.positions.values()) {
    if (out.has(p.userId)) delete s.notes[`${c.id}:${p.userId}`];
    else s.notes[`${c.id}:${p.userId}`] = createNote(p, cm, batchId);
  }
  (s.inflight ??= {})[c.id] = plan;
  save(s);
}

/** Runs the moves of a committed batch. Each stage is recorded when done; resuming skips finished stages. */
async function execute(id: Identity, s: State, c: CohortConfig, plan: Plan) {
  const addr = base.cohortAddress(id.mpcPredecessor, c.id) as Address;
  const has = (k: string) => plan.done.includes(k);
  const mark = (k: string) => { if (!has(k)) plan.done.push(k); save(s); };
  const sum = (xs: { amount: string }[]) => xs.reduce((a, x) => a + BigInt(x.amount), 0n);

  const out = sum(plan.withdraws) + BigInt(plan.liqSold);
  if (out > 0n && !has("withdraw")) {
    await ensureGas(id, c);
    const idle = await base.erc20Balance(c.collateralToken, addr);
    if (idle < out) plan.txs.push(...(await base.withdraw(id, c, out - idle)));
    mark("withdraw");
  }
  if (out > 0n && !has("return")) {
    const idle = await base.erc20Balance(c.collateralToken, addr);
    const amt = idle < out ? idle : out;
    if (amt > 0n) {
      const q = await intents.quoteFromBaseIntoConfidential(id, { baseAsset: c.collateralAssetId, amount: amt.toString(), asset: c.collateralAssetId, refundTo: addr });
      plan.returnDeposit = q.depositAddress; plan.returnAmount = amt.toString(); save(s);
      plan.txs.push(await base.transfer(id, c, c.collateralToken, q.depositAddress as Address, amt));
      mark("return");
    } else throw new Error("nothing idle on the cohort to return yet");
  }
  if (BigInt(plan.liqSold) > 0n && !has("liq")) {
    // Private liquidation: sell the seized collateral for USDC inside the confidential balance. No public auction.
    const { quote } = await intents.payFromConfidential(id, { asset: c.collateralAssetId, amount: plan.liqSold, destinationAsset: USDC_INTENTS_ID, recipient: id.intentsSigner, recipientType: "CONFIDENTIAL_INTENTS", beforeSubmit: () => mark("liq") });
    await intents.waitFor(quote.depositAddress).catch(() => null);
  }

  const netDebt = sum(plan.borrows) - BigInt(plan.repaid) - BigInt(plan.liqRepaid);
  if (netDebt > 0n) {
    if (!has("borrowed")) {
      await ensureGas(id, c);
      const idleUsdc = await base.erc20Balance(USDC_BASE, addr);
      if (idleUsdc < netDebt) plan.txs.push(...(await base.borrow(id, c, netDebt - idleUsdc)));
      mark("borrowed");
    }
    if (!has("sentUsdc")) {
      const idle = await base.erc20Balance(USDC_BASE, addr);
      const amt = idle < netDebt ? idle : netDebt;
      if (amt > 0n) {
        const q = await intents.quoteFromBaseIntoConfidential(id, { baseAsset: USDC_BASE_ID, amount: amt.toString(), asset: USDC_INTENTS_ID, refundTo: addr });
        plan.usdcDeposit = q.depositAddress; plan.usdcAmount = amt.toString(); save(s);
        plan.txs.push(await base.transfer(id, c, USDC_BASE, q.depositAddress as Address, amt));
        mark("sentUsdc");
      } else throw new Error("no borrowed USDC idle on the cohort yet");
    }
  } else if (netDebt < 0n && !has("repaid")) {
    const need = -netDebt;
    if (!has("repayFund")) {
      const before = await base.erc20Balance(USDC_BASE, addr);
      if (before < need) {
        // Marked before the transit is submitted: a crash never sends a second one.
        const { quote } = await intents.payFromConfidential(id, { asset: USDC_INTENTS_ID, amount: (need - before).toString(), destinationAsset: USDC_BASE_ID, recipient: addr, beforeSubmit: () => mark("repayFund") });
        await intents.waitFor(quote.depositAddress);
      }
      mark("repayFund");
    }
    const have = await base.erc20Balance(USDC_BASE, addr);
    const owed = (await base.position(c, addr)).debt;
    const amt = [need, have, owed].reduce((a, b) => (b < a ? b : a));
    if (amt <= 0n) throw new Error("repay transit: no USDC on the cohort yet");
    plan.txs.push(...(await base.repay(id, c, amt)));
    mark("repaid");
  }

  // Transits into the private balance are resolved by status, never waited on inside the lock. A refund lands
  // back on the cohort address: the stage reopens and is sent again on a later run.
  const resolve = async (dep: string | undefined, sent: string, ok: string, what: string) => {
    if (!has(sent) || has(ok) || !dep) return;
    const st = (await intents.status(dep)).status;
    if (st === "SUCCESS") { mark(ok); return; }
    if (["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(st)) {
      // Resend only once the refund is back on the cohort address.
      const back = await base.erc20Balance(token, addr);
      if (back >= BigInt(sentAmount ?? "0") && back > 0n) { plan.done = plan.done.filter((x) => x !== sent); save(s); }
    }
    throw new Error(`${what} transit ${st}; the batch finishes when it settles`);
  };
  let token: Address = c.collateralToken, sentAmount = plan.returnAmount;
  await resolve(plan.returnDeposit, "return", "returnOk", "collateral return");
  token = USDC_BASE; sentAmount = plan.usdcAmount;
  await resolve(plan.usdcDeposit, "sentUsdc", "usdcOk", "borrowed USDC");

  // Payouts, then the batch is closed. Each is paid only once its funds are confirmed in the private balance.
  for (const b of plan.borrows) queuePayouts(s, b.userId, USDC_INTENTS_ID, BigInt(b.amount), b.receive, true, c.id);
  for (const w of plan.withdraws) queuePayouts(s, w.userId, c.collateralAssetId, BigInt(w.amount), w.receive, false, c.id);
  s.batches.push({ batchId: plan.batchId, cohortId: c.id, at: Date.now(), txs: plan.txs, statementTx: plan.statementTx, delta: plan.delta, usersChanged: plan.usersChanged });
  delete s.inflight![c.id];
  save(s);
  log("batch", c.id, plan.batchId, "done", "txs", plan.txs.length);
}

/** Whether a plan still has a move that needs a cohort signature (and so the lock). */
function needsSigning(plan: Plan) {
  const sum = (xs: { amount: string }[]) => xs.reduce((a, x) => a + BigInt(x.amount), 0n);
  const out = sum(plan.withdraws) + BigInt(plan.liqSold);
  const net = sum(plan.borrows) - BigInt(plan.repaid) - BigInt(plan.liqRepaid);
  const d = (k: string) => plan.done.includes(k);
  return (out > 0n && (!d("withdraw") || !d("return"))) || (net > 0n && (!d("borrowed") || !d("sentUsdc"))) || (net < 0n && !d("repaid"));
}

/** Publishes the solvency statement for a ledger on the contract. Returns the batch id and commitment. */
async function postStatement(id: Identity, s: State, c: CohortConfig, ledger: State["ledgers"][string], price: bigint, addr: Address) {
  const batchId = String(++s.batchCounter[c.id]!);
  const cm = commit(ledger);
  const stmt = buildStatement(ledger, cm, batchId, Date.now());
  let statementTx: string | undefined;
  if (config.contractId) {
    const t = totals(ledger);
    // Shares worth the ledger's debt at the market's current rate, so an eject's pro rata debt is fair even
    // while this batch's borrow or repay is still running on Morpho.
    const m = await base.marketTotals(c);
    const onchain = await base.position(c, addr);
    const shares = m.borrowAssets > 0n ? (t.debt * m.borrowShares + m.borrowAssets - 1n) / m.borrowAssets : onchain.borrowShares;
    const r: any = await id.callContract("submit_statement", { stmt: {
      cohort_id: c.id, batch_id: batchId, total_collateral: t.collateral.toString(), total_debt: t.debt.toString(),
      reserve: ledger.reserve.toString(), collateral_value_loan: collateralValue(t.collateral, price, c).toString(),
      borrow_shares: shares.toString(), merkle_root: stmt.merkleRoot, leaf_count: stmt.leafCount, timestamp_ms: String(stmt.timestamp) } });
    statementTx = r?.transaction?.hash;
  }
  save(s);
  return { batchId, cm, stmt, statementTx };
}

/**
 * The contract signs only for a cohort with a fresh statement. Outside the batch lock the contract accepts
 * only the same root again, so a refresh is posted only when the ledger still commits to the root on chain.
 * A changed ledger (an eject landed, for example) is posted by the next locked batch instead.
 */
async function ensureFreshStatement(id: Identity, s: State, c: CohortConfig, price: bigint, addr: Address) {
  if (!config.contractId) return;
  const v: any = await id.viewContract("statement", { cohort_id: c.id }).catch(() => null);
  const acceptedAt = Number(v?.accepted_at_ms ?? 0);
  if (v && Date.now() - acceptedAt <= 20 * 60_000) return;
  const root = buildStatement(s.ledgers[c.id]!, commit(s.ledgers[c.id]!), "0", Date.now()).merkleRoot;
  if (v && String(v.statement?.merkle_root).toLowerCase() !== root.toLowerCase()) { ((s.rootDirty ??= {})[c.id] = true); return; }
  await postStatement(id, s, c, s.ledgers[c.id]!, price, addr);
}

/** Borrowed USDC leaves in round lots, each after a random delay, to blunt amount and timing links. */
function queuePayouts(s: State, userId: string, asset: string, amount: bigint, receive: { asset: string; address: string }, lots = true, cohortId?: string) {
  const parts = lots ? splitLots(amount) : [amount];
  let t = Date.now();
  for (const part of parts) {
    t += 60_000 + Math.floor(Math.random() * 9 * 60_000);
    s.payouts.push({ id: randomUUID(), userId, asset, amount: part.toString(), destinationAsset: receive.asset, recipient: receive.address, notBefore: t, status: "queued", cohortId } as Payout);
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
      // Never a silent cut: pay what the private balance holds; the rest is recorded as owed (published on /health), never taken from other users.
      if (amount < BigInt(p.amount)) { s.payouts.push({ ...p, id: randomUUID(), amount: (BigInt(p.amount) - amount).toString(), status: "failed", tries: 3, note: `owed: remainder of ${p.id}` }); p.amount = amount.toString(); }
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
      const moves = !!s.inflight?.[c.id] || !!s.rootDirty?.[c.id] || s.pending.some((p) => p.cohortId === c.id && ["arrived", "onbase", "supplied"].includes(p.status)) || s.requests.some((r) => r.cohortId === c.id && r.status === "queued");
      const open = s.ledgers[c.id]!.positions.size > 0;
      const last = s.batches.filter((b) => b.cohortId === c.id).at(-1)?.at ?? 0;
      // Open positions are checked every tick for private liquidation; a quiet cohort runs a batch every 6 hours (each costs NEAR gas).
      const needsLiq = open && (await needsLiquidation(s, c));
      if (!moves && !needsLiq && !(open && Date.now() - last > 6 * 3600_000)) continue;
      try { await runCohort(id, s, c); delete engineErrors[`cohort:${c.id}`]; } catch (e) { note(`cohort:${c.id}`, e); log("cohort", c.id, "failed, ledger unchanged:", String(e)); }
    }
    await runPayouts(id, s);
    if (Date.now() - lastLeak > 3600_000) { lastLeak = Date.now(); await runLeakStudy(s).catch((e) => { note("leak", e); log("leak", String(e)); }); }
    save(s);
  } finally { running = false; }
}
