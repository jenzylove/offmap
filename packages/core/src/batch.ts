import { DEFAULT_SPREAD_BPS, accrue } from "./interest.js";
import { cloneLedger, emptyPosition, totals } from "./ledger.js";
import {
  type RiskConfig,
  checkBorrow,
  checkWithdraw,
  collateralValue,
  isLiquidatable,
  ltvAbove,
  planLiquidation,
} from "./risk.js";
import type { CohortLedger, Hex, LossEvent, Op, RejectReason, UserPosition } from "./types.js";
import { absorbShortfall } from "./waterfall.js";

export interface BatchContext {
  /** Oracle price, loan per whole collateral token, 1e8 scale. */
  price: bigint;
  /** Unix seconds of this batch. */
  timestamp: number;
  /** Morpho borrow APR in bps. */
  aprBps: bigint;
  spreadBps?: bigint;
  risk: RiskConfig;
  /** Supplies a fresh 32 byte salt each time a position changes. The agent passes a CSPRNG. */
  saltFor: (userId: string, nonce: bigint) => Hex;
}

/** The ONE net change the agent applies to Morpho for the cohort. Loan and collateral smallest units. */
export interface NetDelta {
  collateralDelta: bigint;
  debtDelta: bigint;
}

export interface Liquidation {
  userId: string;
  kind: "partial" | "full";
  collateralSold: bigint;
  penaltyCollateral: bigint;
  repaid: bigint;
  reserveCredit: bigint;
  coveredByReserve: bigint;
  socialized: bigint;
}

export interface BatchResult {
  ledger: CohortLedger;
  delta: NetDelta;
  applied: Op[];
  rejected: { op: Op; reason: RejectReason }[];
  /** Interest added this batch. `spread` was credited to the reserve. */
  accrued: { interest: bigint; spread: bigint; morpho: bigint };
  liquidations: Liquidation[];
  /** Public loss events. No user ids. */
  lossEvents: LossEvent[];
}

/** Liquidation ops for every position at or above the liquidation LTV, in user id order. */
export function liquidationOps(ledger: CohortLedger, price: bigint, risk: RiskConfig): Op[] {
  return [...ledger.positions.values()]
    .filter((p) => isLiquidatable(p, price, ledger.cohort, risk))
    .sort((a, b) => (a.userId < b.userId ? -1 : 1))
    .map((p) => ({ kind: "liquidate" as const, userId: p.userId }));
}

/**
 * Accrues interest to ctx.timestamp, then applies the ops in order. Invalid ops are rejected
 * with a reason and change nothing. The input ledger is not modified.
 */
export function applyBatch(input: CohortLedger, ops: Op[], ctx: BatchContext): BatchResult {
  if (ctx.price <= 0n) throw new RangeError("price must be positive");
  if (ctx.timestamp < input.lastAccrual) throw new RangeError("timestamp is before the last accrual");
  const ledger = cloneLedger(input);
  const cohort = ledger.cohort;
  const spreadBps = ctx.spreadBps ?? DEFAULT_SPREAD_BPS;
  const touch = (p: UserPosition): void => {
    p.nonce += 1n;
    p.salt = ctx.saltFor(p.userId, p.nonce);
  };

  const accrued = { interest: 0n, spread: 0n, morpho: 0n };
  const seconds = ctx.timestamp - ledger.lastAccrual;
  for (const p of [...ledger.positions.values()].sort((a, b) => (a.userId < b.userId ? -1 : 1))) {
    const a = accrue(p.debt, ctx.aprBps, spreadBps, seconds);
    if (a.interest === 0n) continue;
    p.debt = a.debt;
    touch(p);
    accrued.interest += a.interest;
    accrued.spread += a.spread;
    accrued.morpho += a.morpho;
  }
  ledger.reserve += accrued.spread;
  ledger.lastAccrual = ctx.timestamp;

  const run = totals(ledger);
  const delta: NetDelta = { collateralDelta: 0n, debtDelta: 0n };
  const applied: Op[] = [];
  const rejected: BatchResult["rejected"] = [];
  const liquidations: Liquidation[] = [];
  const lossEvents: LossEvent[] = [];

  for (const op of ops) {
    const reject = (reason: RejectReason): void => {
      rejected.push({ op, reason });
    };
    if (op.kind !== "liquidate" && op.amount <= 0n) {
      reject("zero_amount");
      continue;
    }
    let pos = ledger.positions.get(op.userId);
    if (!pos && op.kind === "deposit") {
      pos = emptyPosition(cohort.id, op.userId, ctx.saltFor(op.userId, 0n));
      ledger.positions.set(op.userId, pos);
    }
    if (!pos) {
      reject("unknown_user");
      continue;
    }

    if (op.kind === "deposit") {
      pos.collateral += op.amount;
      run.collateral += op.amount;
      delta.collateralDelta += op.amount;
    } else if (op.kind === "borrow") {
      const why = checkBorrow(pos, op.amount, ctx.price, cohort, ctx.risk, run);
      if (why) {
        reject(why);
        continue;
      }
      pos.debt += op.amount;
      run.debt += op.amount;
      delta.debtDelta += op.amount;
    } else if (op.kind === "repay") {
      if (op.amount > pos.debt) {
        reject("repay_exceeds_debt");
        continue;
      }
      pos.debt -= op.amount;
      run.debt -= op.amount;
      delta.debtDelta -= op.amount;
    } else if (op.kind === "withdraw") {
      const why = checkWithdraw(pos, op.amount, ctx.price, cohort, ctx.risk, run);
      if (why) {
        reject(why);
        continue;
      }
      pos.collateral -= op.amount;
      run.collateral -= op.amount;
      delta.collateralDelta -= op.amount;
    } else {
      if (!isLiquidatable(pos, ctx.price, cohort, ctx.risk)) {
        reject("not_liquidatable");
        continue;
      }
      const plan = planLiquidation(pos, ctx.price, cohort, ctx.risk);
      const out = plan.collateralSold + plan.penaltyCollateral;
      pos.collateral = plan.collateralAfter;
      pos.debt = plan.debtAfter;
      run.collateral -= out;
      run.debt -= plan.repaid;
      delta.collateralDelta -= out;
      delta.debtDelta -= plan.repaid;
      ledger.reserve += plan.reserveCredit;

      let coveredByReserve = 0n;
      let socialized = 0n;
      if (plan.shortfall > 0n) {
        const others = [...ledger.positions.values()]
          .filter((o) => o.userId !== pos.userId)
          .map((o) => ({ userId: o.userId, debt: o.debt }));
        const w = absorbShortfall({ cohortId: cohort.id, shortfall: plan.shortfall, reserve: ledger.reserve, others });
        ledger.reserve = w.reserveAfter;
        coveredByReserve = w.event.coveredByReserve;
        socialized = w.event.socialized;
        for (const inc of w.debtIncreases) {
          const o = ledger.positions.get(inc.userId)!;
          o.debt += inc.amount;
          touch(o);
        }
        pos.debt = w.unabsorbed;
        run.debt -= plan.shortfall - w.unabsorbed - socialized;
        delta.debtDelta -= coveredByReserve;
        lossEvents.push(w.event);
      }
      liquidations.push({
        userId: pos.userId,
        kind: plan.kind,
        collateralSold: plan.collateralSold,
        penaltyCollateral: plan.penaltyCollateral,
        repaid: plan.repaid,
        reserveCredit: plan.reserveCredit,
        coveredByReserve,
        socialized,
      });
    }
    touch(pos);
    applied.push(op);
  }

  return { ledger, delta, applied, rejected, accrued, liquidations, lossEvents };
}

/** True when cohort debt exceeds the cohort ceiling at this price. */
export function aboveCeiling(ledger: CohortLedger, price: bigint): boolean {
  const t = totals(ledger);
  return ltvAbove(collateralValue(t.collateral, price, ledger.cohort), t.debt, ledger.cohort.cohortCeilingBps);
}
