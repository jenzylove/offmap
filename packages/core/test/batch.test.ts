import { describe, expect, it } from "vitest";
import { type Op, aboveCeiling, applyBatch, liquidationOps, newLedger, totals } from "../src/index.js";
import { BTC, BTCU, P100K, RISK, USDC, ctx } from "./helpers.js";

const fresh = () => newLedger(BTC, 1000);
const wide = { ...RISK, userCapLoan: USDC(1e6) };

describe("applyBatch", () => {
  it("nets many ops into one delta equal to the sum of the applied ops", () => {
    const ops: Op[] = [
      { kind: "deposit", userId: "a", amount: BTCU(2) },
      { kind: "deposit", userId: "b", amount: BTCU(3) },
      { kind: "borrow", userId: "a", amount: USDC(50_000) },
      { kind: "borrow", userId: "b", amount: USDC(30_000) },
      { kind: "repay", userId: "a", amount: USDC(10_000) },
      { kind: "withdraw", userId: "b", amount: BTCU(1) },
    ];
    const r = applyBatch(fresh(), ops, ctx({ risk: wide }));
    expect(r.rejected).toEqual([]);
    expect(r.applied).toHaveLength(6);
    expect(r.delta).toEqual({ collateralDelta: BTCU(4), debtDelta: USDC(70_000) });
    expect(totals(r.ledger)).toEqual({ collateral: BTCU(4), debt: USDC(70_000) });
  });

  it("a borrow and a repay of the same size cancel in the net delta", () => {
    const base = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(5) }], ctx()).ledger;
    const r = applyBatch(base, [
      { kind: "borrow", userId: "a", amount: USDC(20_000) },
      { kind: "repay", userId: "a", amount: USDC(20_000) },
    ], ctx({}, 1001));
    expect(r.delta).toEqual({ collateralDelta: 0n, debtDelta: 0n });
  });

  it("returns rejected ops with reason codes and leaves them out of the delta", () => {
    const ops: Op[] = [
      { kind: "borrow", userId: "ghost", amount: 1n },
      { kind: "deposit", userId: "a", amount: 0n },
      { kind: "deposit", userId: "a", amount: BTCU(1) },
      { kind: "borrow", userId: "a", amount: USDC(60_001) },
      { kind: "borrow", userId: "a", amount: USDC(60_000) },
      { kind: "repay", userId: "a", amount: USDC(60_001) },
      { kind: "withdraw", userId: "a", amount: BTCU(0.5) },
      { kind: "withdraw", userId: "a", amount: BTCU(5) },
      { kind: "liquidate", userId: "a" },
    ];
    const r = applyBatch(fresh(), ops, ctx({ risk: wide }));
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "unknown_user",
      "zero_amount",
      "ltv_exceeds_open_limit",
      "cohort_ceiling_exceeded",
      "repay_exceeds_debt",
      "insufficient_collateral",
      "not_liquidatable",
    ]);
    expect(r.applied).toHaveLength(2);
    // the 0.5 BTC withdrawal is allowed because there is no debt
    expect(r.delta).toEqual({ collateralDelta: BTCU(0.5), debtDelta: 0n });
  });

  it("enforces the cohort ceiling and size cap and the per user cap", () => {
    const base = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(10) }, { kind: "deposit", userId: "b", amount: BTCU(10) }], ctx()).ledger;
    const r1 = applyBatch(base, [{ kind: "borrow", userId: "a", amount: USDC(700_000) }], ctx({ risk: wide }, 1001));
    expect(r1.rejected[0]!.reason).toBe("ltv_exceeds_open_limit");
    const r2 = applyBatch(base, [{ kind: "borrow", userId: "a", amount: USDC(150_000) }], ctx({ risk: { ...wide, userCapLoan: USDC(100_000) } }, 1001));
    expect(r2.rejected[0]!.reason).toBe("user_cap_exceeded");
    const small = { ...BTC, sizeCapLoan: USDC(100_000) };
    const l = newLedger(small, 1000);
    const b2 = applyBatch(l, [{ kind: "deposit", userId: "a", amount: BTCU(10) }, { kind: "borrow", userId: "a", amount: USDC(100_001) }], ctx({ risk: wide }));
    expect(b2.rejected[0]!.reason).toBe("cohort_size_cap_exceeded");
  });

  it("does not modify the input ledger", () => {
    const base = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(1) }], ctx()).ledger;
    const snapshot = JSON.stringify([...base.positions], (_, v) => (typeof v === "bigint" ? v.toString() : v));
    applyBatch(base, [{ kind: "borrow", userId: "a", amount: USDC(10_000) }], ctx({}, 1005));
    expect(JSON.stringify([...base.positions], (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });

  it("bumps nonce and re-salts every changed position", () => {
    const a = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(1) }], ctx());
    const b = applyBatch(a.ledger, [{ kind: "borrow", userId: "a", amount: USDC(1_000) }], ctx({}, 1001));
    expect(b.ledger.positions.get("a")!.nonce).toBe(a.ledger.positions.get("a")!.nonce + 1n);
    expect(b.ledger.positions.get("a")!.salt).not.toBe(a.ledger.positions.get("a")!.salt);
  });

  it("accrues interest first and credits the spread to the reserve", () => {
    const rates = ctx({ aprBps: 400n, spreadBps: 100n });
    const a = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(1) }, { kind: "borrow", userId: "a", amount: USDC(50_000) }], rates);
    const year = 1000 + 31_536_000;
    const b = applyBatch(a.ledger, [], { ...rates, timestamp: year });
    expect(b.accrued.interest).toBeGreaterThan(USDC(2_500));
    expect(b.accrued.interest).toBeLessThan(USDC(2_600));
    expect(b.ledger.reserve).toBe(b.accrued.spread);
    expect(b.accrued.spread * 5n).toBeGreaterThanOrEqual(b.accrued.interest - 5n);
    expect(b.ledger.positions.get("a")!.debt).toBe(USDC(50_000) + b.accrued.interest);
    expect(() => applyBatch(b.ledger, [], { ...rates, timestamp: 5 })).toThrow();
  });
});

describe("private liquidation in a batch", () => {
  it("liquidates at 70% back to 60%, the penalty goes to the reserve, and the delta matches", () => {
    const a = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(1) }, { kind: "deposit", userId: "z", amount: BTCU(20) }, { kind: "borrow", userId: "a", amount: USDC(59_000) }], ctx());
    const price = 84_000n * 10n ** 8n; // 59,000 / 84,000 = 70.2%
    const ops = liquidationOps(a.ledger, price, RISK);
    expect(ops).toEqual([{ kind: "liquidate", userId: "a" }]);
    const r = applyBatch(a.ledger, ops, ctx({ price }, 1001));
    const l = r.liquidations[0]!;
    expect(l.kind).toBe("partial");
    expect(r.lossEvents).toEqual([]);
    expect(r.ledger.reserve).toBe(l.reserveCredit);
    expect(r.ledger.reserve).toBeGreaterThan(0n);
    expect(r.delta).toEqual({ collateralDelta: -(l.collateralSold + l.penaltyCollateral), debtDelta: -l.repaid });
    expect(aboveCeiling(r.ledger, price)).toBe(false);
    expect(liquidationOps(r.ledger, price, RISK)).toEqual([]);
  });

  it("applying the same liquidation twice rejects the second", () => {
    const a = applyBatch(fresh(), [{ kind: "deposit", userId: "a", amount: BTCU(1) }, { kind: "deposit", userId: "z", amount: BTCU(20) }, { kind: "borrow", userId: "a", amount: USDC(59_000) }], ctx());
    const price = 84_000n * 10n ** 8n;
    const r = applyBatch(a.ledger, [{ kind: "liquidate", userId: "a" }, { kind: "liquidate", userId: "a" }], ctx({ price }, 1001));
    expect(r.rejected.map((x) => x.reason)).toEqual(["not_liquidatable"]);
  });
});

describe("price sanity", () => {
  it("refuses a zero price", () => {
    expect(() => applyBatch(fresh(), [], ctx({ price: 0n }))).toThrow();
    expect(P100K).toBeGreaterThan(0n);
  });
});
