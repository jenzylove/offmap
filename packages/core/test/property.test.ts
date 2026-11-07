import { describe, expect, it } from "vitest";
import {
  type Cohort,
  type CohortLedger,
  type Op,
  aboveCeiling,
  applyBatch,
  buildStatement,
  checkInvariants,
  collateralValue,
  commit,
  createNote,
  liquidationOps,
  newLedger,
  totals,
  verifyNote,
} from "../src/index.js";
import { BTC, RISK, USDC, ctx, mulberry32 } from "./helpers.js";

const WETH: Cohort = { ...BTC, id: "weth", collateralAsset: "WETH", collateralDecimals: 18, sizeCapLoan: USDC(2_000_000) };

interface Stats {
  ops: number;
  applied: number;
  rejected: number;
  liquidations: number;
  losses: number;
  socialized: number;
}

function simulate(cohort: Cohort, startPrice: bigint, unit: bigint, seed: number, opCount: number, rates: boolean): Stats {
  const rnd = mulberry32(seed);
  const pick = (n: number): number => Math.floor(rnd() * n);
  const big = (max: bigint): bigint => (max <= 0n ? 0n : BigInt(Math.floor(rnd() * 1e9)) * max / 1_000_000_000n);
  const users = Array.from({ length: 24 }, (_, i) => `user${i}`);
  const risk = { ...RISK, userCapLoan: USDC(400_000) };

  let ledger: CohortLedger = newLedger(cohort, 0);
  let price = startPrice;
  let t = 0;
  let shadowCollateral = 0n;
  let shadowDebt = 0n;
  const stats: Stats = { ops: 0, applied: 0, rejected: 0, liquidations: 0, losses: 0, socialized: 0 };
  let batchNo = 0;

  while (stats.ops < opCount) {
    batchNo++;
    // random walk with occasional crashes and rebounds
    const roll = rnd();
    const move = roll < 0.04 ? -2200 + pick(800) : roll < 0.08 ? 600 + pick(900) : pick(600) - 300;
    price = (price * BigInt(10_000 + move)) / 10_000n;
    if (price < startPrice / 4n) price = startPrice / 4n;
    t += 1 + pick(7200);
    const c = ctx({ price, risk, aprBps: rates ? BigInt(pick(2500)) : 0n, spreadBps: rates ? 100n : 0n }, t);

    const pre = applyBatch(ledger, [], c).ledger;
    const ops: Op[] = liquidationOps(pre, price, risk);
    const n = 5 + pick(30);
    for (let i = 0; i < n; i++) {
      const userId = users[pick(users.length)]!;
      const p = pre.positions.get(userId);
      const k = rnd();
      if (k < 0.3) ops.push({ kind: "deposit", userId, amount: big(25n * unit) });
      else if (k < 0.65) {
        const room = p ? (collateralValue(p.collateral, price, cohort) * 6200n) / 10_000n - p.debt : USDC(1000);
        ops.push({ kind: "borrow", userId, amount: big(room > 0n ? room : USDC(1000)) });
      } else if (k < 0.8) ops.push({ kind: "repay", userId, amount: big((p?.debt ?? 0n) + USDC(1)) });
      else ops.push({ kind: "withdraw", userId, amount: big(((p?.collateral ?? 0n) * 12n) / 10n) });
    }
    stats.ops += ops.length;

    const r = applyBatch(ledger, ops, c);
    ledger = r.ledger;
    stats.applied += r.applied.length;
    stats.rejected += r.rejected.length;
    stats.liquidations += r.liquidations.length;
    stats.losses += r.lossEvents.length;
    stats.socialized += r.lossEvents.reduce((s, e) => s + Number(e.socialized), 0);

    shadowCollateral += r.delta.collateralDelta;
    shadowDebt += r.accrued.interest + r.delta.debtDelta;

    // totals never negative, and equal the independent running sums
    const tot = totals(ledger);
    expect(tot.collateral).toBe(shadowCollateral);
    expect(tot.debt).toBe(shadowDebt);
    expect(ledger.reserve >= 0n).toBe(true);
    for (const p of ledger.positions.values()) {
      expect(p.collateral >= 0n && p.debt >= 0n).toBe(true);
    }

    // no cohort above its ceiling after a valid batch (unless price and interest alone put it there)
    if (!aboveCeiling(pre, price)) expect(aboveCeiling(ledger, price)).toBe(false);

    // statement invariants (tree rebuilt every 4th batch to keep the run fast)
    if (batchNo % 4 !== 0) continue;
    const cm = commit(ledger);
    const s = buildStatement(ledger, cm, `b${batchNo}`, t);
    expect(checkInvariants([...ledger.positions.values()], s)).toEqual([]);
    const sample = [...ledger.positions.values()][pick(ledger.positions.size)];
    if (sample) expect(verifyNote(createNote(sample, cm, s.batchId), s.merkleRoot)).toBe(true);
  }
  return stats;
}

describe("property: 10,000 random ops", () => {
  it("holds all invariants across two cohorts with interest", () => {
    const a = simulate(BTC, 100_000n * 10n ** 8n, 10n ** 8n, 1337, 5_000, true);
    const b = simulate(WETH, 3_000n * 10n ** 8n, 10n ** 18n, 4242, 5_000, true);
    expect(a.ops + b.ops).toBeGreaterThanOrEqual(10_000);
    // the run must actually exercise the risky paths
    expect(a.applied + b.applied).toBeGreaterThan(2_000);
    expect(a.rejected + b.rejected).toBeGreaterThan(500);
    expect(a.liquidations + b.liquidations).toBeGreaterThan(5);
  }, 300_000);

  it("with zero rates the ledger debt equals the sum of the net deltas", () => {
    const s = simulate(BTC, 100_000n * 10n ** 8n, 10n ** 8n, 99, 3_000, false);
    expect(s.applied).toBeGreaterThan(500);
  }, 300_000);
});
