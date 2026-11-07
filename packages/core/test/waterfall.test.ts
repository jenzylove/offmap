import { describe, expect, it } from "vitest";
import { absorbShortfall, applyBatch, newLedger } from "../src/index.js";
import { BTC, BTCU, RISK, USDC, ctx } from "./helpers.js";

describe("absorbShortfall", () => {
  const others = [
    { userId: "b", debt: 300n },
    { userId: "c", debt: 100n },
  ];

  it("takes the user residual first, then the reserve, then others", () => {
    const r = absorbShortfall({ cohortId: "x", shortfall: 1000n, userResidual: 100n, reserve: 200n, others });
    expect(r.coveredByUser).toBe(100n);
    expect(r.event).toEqual({ cohortId: "x", amount: 900n, coveredByReserve: 200n, socialized: 700n });
    expect(r.reserveAfter).toBe(0n);
    expect(r.unabsorbed).toBe(0n);
  });

  it("uses only the reserve when it is large enough, and socializes nothing", () => {
    const r = absorbShortfall({ cohortId: "x", shortfall: 150n, reserve: 500n, others });
    expect(r.event.coveredByReserve).toBe(150n);
    expect(r.event.socialized).toBe(0n);
    expect(r.debtIncreases).toEqual([]);
    expect(r.reserveAfter).toBe(350n);
  });

  it("socializes pro rata by debt and the shares add up exactly", () => {
    const r = absorbShortfall({ cohortId: "x", shortfall: 401n, reserve: 0n, others });
    const sum = r.debtIncreases.reduce((s, d) => s + d.amount, 0n);
    expect(sum).toBe(401n);
    const b = r.debtIncreases.find((d) => d.userId === "b")!.amount;
    const c = r.debtIncreases.find((d) => d.userId === "c")!.amount;
    expect(b).toBe(301n);
    expect(c).toBe(100n);
  });

  it("leaves bad debt when nobody else in the cohort has debt", () => {
    const r = absorbShortfall({ cohortId: "x", shortfall: 50n, reserve: 10n, others: [{ userId: "b", debt: 0n }] });
    expect(r.event.socialized).toBe(0n);
    expect(r.unabsorbed).toBe(40n);
  });

  it("the loss event never carries a user id", () => {
    const r = absorbShortfall({ cohortId: "x", shortfall: 1000n, reserve: 0n, others });
    expect(Object.keys(r.event).sort()).toEqual(["amount", "cohortId", "coveredByReserve", "socialized"]);
  });
});

describe("waterfall inside a batch", () => {
  // cohort A: victim borrows 59,000 on 1 BTC; two healthy borrowers with 10 BTC and 20,000 / 10,000 debt
  function setup() {
    const a = newLedger(BTC, 1000);
    const b = newLedger({ ...BTC, id: "other" }, 1000);
    const c0 = ctx({ risk: { ...RISK, userCapLoan: USDC(1e6) } });
    const la = applyBatch(
      a,
      [
        { kind: "deposit", userId: "victim", amount: BTCU(1) },
        { kind: "deposit", userId: "b", amount: BTCU(10) },
        { kind: "deposit", userId: "c", amount: BTCU(10) },
        { kind: "borrow", userId: "victim", amount: USDC(59_000) },
        { kind: "borrow", userId: "b", amount: USDC(20_000) },
        { kind: "borrow", userId: "c", amount: USDC(10_000) },
      ],
      c0,
    ).ledger;
    const lb = applyBatch(
      b,
      [{ kind: "deposit", userId: "z", amount: BTCU(1) }, { kind: "borrow", userId: "z", amount: USDC(30_000) }],
      c0,
    ).ledger;
    return { la, lb };
  }

  it("crash: reserve pays first, then only same cohort users, other cohorts untouched", () => {
    const { la, lb } = setup();
    la.reserve = USDC(1_000);
    const crash = ctx({ price: 50_000n * 10n ** 8n }, 2000);
    const r = applyBatch(la, [{ kind: "liquidate", userId: "victim" }], crash);
    expect(r.rejected).toEqual([]);
    const loss = r.lossEvents[0]!;
    expect(loss.cohortId).toBe("cbbtc");
    expect(loss.amount).toBe(loss.coveredByReserve + loss.socialized);
    // the reserve (old balance plus this liquidation's penalty) was fully used before anyone else paid
    expect(loss.socialized).toBeGreaterThan(0n);
    expect(loss.coveredByReserve).toBe(USDC(1_000) + r.liquidations[0]!.reserveCredit);
    expect(r.ledger.reserve).toBe(0n);
    // socialization split 2:1 by debt (20k vs 10k)
    const bDebt = r.ledger.positions.get("b")!.debt - USDC(20_000);
    const cDebt = r.ledger.positions.get("c")!.debt - USDC(10_000);
    expect(bDebt + cDebt).toBe(loss.socialized);
    expect(bDebt).toBeGreaterThanOrEqual(cDebt * 2n);
    expect(bDebt).toBeLessThanOrEqual(cDebt * 2n + 2n);
    // the victim is wiped out
    expect(r.ledger.positions.get("victim")).toMatchObject({ collateral: 0n, debt: 0n });
    // the other cohort ledger is the same object content and was never an input
    expect(lb.positions.get("z")!.debt).toBe(USDC(30_000));
  });

  it("the Morpho debt delta equals repaid plus reserve cover, never the socialized part", () => {
    const { la } = setup();
    la.reserve = USDC(500);
    const r = applyBatch(la, [{ kind: "liquidate", userId: "victim" }], ctx({ price: 50_000n * 10n ** 8n }, 2000));
    const l = r.liquidations[0]!;
    expect(r.delta.debtDelta).toBe(-(l.repaid + l.coveredByReserve));
    expect(r.delta.collateralDelta).toBe(-(l.collateralSold + l.penaltyCollateral));
  });
});
