import { describe, expect, it } from "vitest";
import {
  checkBorrow,
  collateralValue,
  isLiquidatable,
  liquidationPrice,
  ltvAbove,
  ltvBps,
  planLiquidation,
} from "../src/index.js";
import { BTC, BTCU, P100K, RISK, USDC, pos } from "./helpers.js";

describe("ltv", () => {
  it("values collateral with decimals adjusted", () => {
    expect(collateralValue(BTCU(1), P100K, BTC)).toBe(USDC(100_000));
    expect(collateralValue(BTCU(0.5), P100K, BTC)).toBe(USDC(50_000));
  });
  it("computes ltv in bps", () => {
    expect(ltvBps(BTCU(1), USDC(60_000), P100K, BTC)).toBe(6000n);
    expect(ltvBps(BTCU(1), USDC(70_000), P100K, BTC)).toBe(7000n);
    expect(ltvBps(0n, 0n, P100K, BTC)).toBe(0n);
    expect(ltvBps(0n, 1n, P100K, BTC) > 10n ** 12n).toBe(true);
  });
  it("handles an 18 decimal asset", () => {
    const weth = { ...BTC, id: "weth", collateralDecimals: 18 };
    expect(collateralValue(10n ** 18n, 3000n * 10n ** 8n, weth)).toBe(USDC(3000));
  });
});

describe("liquidation price", () => {
  it("is where ltv reaches 70%", () => {
    const p = pos("a", BTCU(1), USDC(50_000));
    const lp = liquidationPrice(p, BTC, RISK)!;
    // 50,000 / 0.7 = 71,428.571428... USDC per BTC, rounded up at the 1e8 scale
    expect(lp).toBe(7_142_857_142_858n);
    expect(isLiquidatable(p, lp, BTC, RISK)).toBe(true);
    expect(isLiquidatable(p, lp - 10n * 10n ** 8n, BTC, RISK)).toBe(true);
    expect(isLiquidatable(p, lp + 10n * 10n ** 8n, BTC, RISK)).toBe(false);
  });
  it("is null without debt", () => {
    expect(liquidationPrice(pos("a", BTCU(1), 0n), BTC, RISK)).toBeNull();
  });
});

describe("borrow rules", () => {
  const cfg = { ...RISK, userCapLoan: USDC(1_000_000) };
  const big = { collateral: BTCU(10), debt: 0n };
  it("allows exactly 60% and rejects one unit above", () => {
    const p = pos("a", BTCU(1), 0n);
    expect(checkBorrow(p, USDC(60_000), P100K, BTC, cfg, big)).toBeNull();
    expect(checkBorrow(p, USDC(60_000) + 1n, P100K, BTC, cfg, big)).toBe("ltv_exceeds_open_limit");
  });
  it("rejects over the per user cap", () => {
    const p = pos("a", BTCU(1), 0n);
    expect(checkBorrow(p, USDC(50_000), P100K, BTC, { ...cfg, userCapLoan: USDC(40_000) }, big)).toBe("user_cap_exceeded");
  });
  it("rejects over the cohort size cap", () => {
    const small = { ...BTC, sizeCapLoan: USDC(10_000) };
    expect(checkBorrow(pos("a", BTCU(1), 0n), USDC(10_001), P100K, small, cfg, big)).toBe("cohort_size_cap_exceeded");
  });
  it("rejects when the cohort would pass its 50% ceiling", () => {
    const t = { collateral: BTCU(10), debt: USDC(499_000) };
    const p = pos("a", BTCU(1), 0n);
    expect(checkBorrow(p, USDC(1_000), P100K, BTC, cfg, t)).toBeNull();
    expect(checkBorrow(p, USDC(1_001), P100K, BTC, cfg, t)).toBe("cohort_ceiling_exceeded");
    // the user alone would be fine at 60%, but the cohort total is what binds
    expect(ltvAbove(USDC(1_000_000), USDC(500_000), 5000n)).toBe(false);
  });
});

describe("planLiquidation exact math", () => {
  const p = pos("a", BTCU(1), USDC(70_000));

  it("pins the literal result for 1 BTC, 70,000 debt, 50 bps slippage, 300 bps penalty", () => {
    // Solve (70000 - 0.995x) / (100000 - x - 0.995x * 0.03) = 0.6 for the oracle value x sold:
    // x = 10000 / (0.995 - 0.6 - 0.6 * 0.995 * 0.03) = 26,518.9 USDC, i.e. about 0.2651887 BTC
    const plan = planLiquidation(p, P100K, BTC, RISK);
    expect(plan.kind).toBe("partial");
    expect(plan.shortfall).toBe(0n);
    expect(plan.collateralSold).toBeGreaterThan(26_518_000n);
    expect(plan.collateralSold).toBeLessThan(26_519_500n);
    expect(plan.repaid).toBe((collateralValue(plan.collateralSold, P100K, BTC) * 9950n) / 10_000n);
    expect(plan.debtAfter).toBe(USDC(70_000) - plan.repaid);
    expect(plan.collateralAfter).toBe(BTCU(1) - plan.collateralSold - plan.penaltyCollateral);
  });

  it("lands on 60% and one unit less would not", () => {
    const plan = planLiquidation(p, P100K, BTC, RISK);
    expect(ltvAbove(collateralValue(plan.collateralAfter, P100K, BTC), plan.debtAfter, 6000n)).toBe(false);
    expect(ltvBps(plan.collateralAfter, plan.debtAfter, P100K, BTC)).toBe(5999n);
    const lessSold = plan.collateralSold - 1n;
    const repaid = (collateralValue(lessSold, P100K, BTC) * 9950n) / 10_000n;
    // same penalty collateral is an upper bound for the smaller sale, so its LTV is at least this
    const after = BTCU(1) - lessSold - plan.penaltyCollateral;
    expect(ltvAbove(collateralValue(after, P100K, BTC), USDC(70_000) - repaid, 6000n) || plan.debtAfter === USDC(70_000) - repaid).toBe(true);
  });

  it("penalty is 3% of the repaid amount, credited to the reserve at swap value", () => {
    const plan = planLiquidation(p, P100K, BTC, RISK);
    const penaltyLoan = collateralValue(plan.penaltyCollateral, P100K, BTC);
    const expected = (plan.repaid * 300n) / 10_000n;
    expect(penaltyLoan >= expected - 1n && penaltyLoan - expected < 1_000n).toBe(true);
    expect(plan.reserveCredit).toBe((penaltyLoan * 9950n) / 10_000n);
  });

  it("zero slippage and zero penalty matches the plain formula", () => {
    const cfg = { ...RISK, slippageBps: 0n, penaltyBps: 0n };
    const plan = planLiquidation(p, P100K, BTC, cfg);
    // (70000 - x) / (100000 - x) = 0.6  ->  x = 25,000 USDC = 0.25 BTC
    expect(plan.collateralSold).toBe(BTCU(0.25));
    expect(plan.repaid).toBe(USDC(25_000));
    expect(plan.penaltyCollateral).toBe(0n);
    expect(plan.debtAfter).toBe(USDC(45_000));
    expect(plan.collateralAfter).toBe(BTCU(0.75));
  });

  it("seizes everything and reports a shortfall when collateral cannot cover the debt", () => {
    const plan = planLiquidation(pos("a", BTCU(1), USDC(120_000)), P100K, BTC, RISK);
    expect(plan.kind).toBe("full");
    expect(plan.collateralAfter).toBe(0n);
    expect(plan.collateralSold + plan.penaltyCollateral).toBe(BTCU(1));
    expect(plan.shortfall).toBe(USDC(120_000) - plan.repaid);
    expect(plan.shortfall).toBeGreaterThan(USDC(20_000));
  });

  it("rejects a non positive price", () => {
    expect(() => planLiquidation(p, 0n, BTC, RISK)).toThrow();
  });
});
