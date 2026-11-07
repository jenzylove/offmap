import { BPS, PRICE_SCALE, type Cohort, type RejectReason, type UserPosition } from "./types.js";

export interface RiskConfig {
  /** Maximum LTV at open and the level liquidation restores. */
  maxOpenLtvBps: bigint;
  /** Private liquidation triggers at or above this LTV. */
  liquidationLtvBps: bigint;
  /** Penalty as bps of the repaid amount, taken from collateral to the reserve. */
  penaltyBps: bigint;
  /** Slippage assumed on the confidential swap, in bps below the oracle price. */
  slippageBps: bigint;
  /** Maximum debt per user, loan smallest units. */
  userCapLoan: bigint;
}

export const DEFAULT_RISK: Omit<RiskConfig, "userCapLoan"> = {
  maxOpenLtvBps: 6000n,
  liquidationLtvBps: 7000n,
  penaltyBps: 300n,
  slippageBps: 50n,
};

/** Returned by ltvBps when there is debt and no collateral value. */
export const LTV_INFINITE = 1n << 64n;

const pow10 = (n: number): bigint => 10n ** BigInt(n);
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/**
 * Price is loan tokens per ONE WHOLE collateral token, scaled by 1e8
 * (cbBTC at 100,000 USDC is 100000e8). Decimals are adjusted here.
 */
export function collateralValue(collateral: bigint, price: bigint, cohort: Cohort): bigint {
  return (collateral * price * pow10(cohort.loanDecimals)) / (PRICE_SCALE * pow10(cohort.collateralDecimals));
}

/** Collateral units whose value is at least `value` loan units. */
function collateralForValue(value: bigint, price: bigint, cohort: Cohort): bigint {
  return ceilDiv(value * PRICE_SCALE * pow10(cohort.collateralDecimals), price * pow10(cohort.loanDecimals));
}

export function ltvBps(collateral: bigint, debt: bigint, price: bigint, cohort: Cohort): bigint {
  const value = collateralValue(collateral, price, cohort);
  if (value === 0n) return debt === 0n ? 0n : LTV_INFINITE;
  return (debt * BPS) / value;
}

/** Exact comparison, no rounding: debt/value > limit. */
export function ltvAbove(value: bigint, debt: bigint, limitBps: bigint): boolean {
  return debt * BPS > limitBps * value;
}

/** Exact comparison, no rounding: debt/value >= limit. */
export function ltvAtLeast(value: bigint, debt: bigint, limitBps: bigint): boolean {
  return debt * BPS >= limitBps * value;
}

export function isLiquidatable(p: UserPosition, price: bigint, cohort: Cohort, cfg: RiskConfig): boolean {
  if (p.debt === 0n) return false;
  return ltvAtLeast(collateralValue(p.collateral, price, cohort), p.debt, cfg.liquidationLtvBps);
}

/** Price (1e8 scale) at which this position becomes liquidatable. Null with no debt or no collateral. */
export function liquidationPrice(p: UserPosition, cohort: Cohort, cfg: RiskConfig): bigint | null {
  if (p.debt === 0n || p.collateral === 0n) return null;
  const num = p.debt * BPS * PRICE_SCALE * pow10(cohort.collateralDecimals);
  const den = cfg.liquidationLtvBps * p.collateral * pow10(cohort.loanDecimals);
  return ceilDiv(num, den);
}

export interface CohortTotals {
  collateral: bigint;
  debt: bigint;
}

/** Checks a proposed borrow of `amount`. Returns the reject reason or null. */
export function checkBorrow(
  p: UserPosition,
  amount: bigint,
  price: bigint,
  cohort: Cohort,
  cfg: RiskConfig,
  totals: CohortTotals,
): RejectReason | null {
  const newDebt = p.debt + amount;
  if (ltvAbove(collateralValue(p.collateral, price, cohort), newDebt, cfg.maxOpenLtvBps)) {
    return "ltv_exceeds_open_limit";
  }
  if (newDebt > cfg.userCapLoan) return "user_cap_exceeded";
  if (totals.debt + amount > cohort.sizeCapLoan) return "cohort_size_cap_exceeded";
  if (ltvAbove(collateralValue(totals.collateral, price, cohort), totals.debt + amount, cohort.cohortCeilingBps)) {
    return "cohort_ceiling_exceeded";
  }
  return null;
}

/** Checks a proposed collateral withdrawal. Returns the reject reason or null. */
export function checkWithdraw(
  p: UserPosition,
  amount: bigint,
  price: bigint,
  cohort: Cohort,
  cfg: RiskConfig,
  totals: CohortTotals,
): RejectReason | null {
  if (amount > p.collateral) return "insufficient_collateral";
  const left = p.collateral - amount;
  if (ltvAbove(collateralValue(left, price, cohort), p.debt, cfg.maxOpenLtvBps)) return "ltv_exceeds_open_limit";
  if (ltvAbove(collateralValue(totals.collateral - amount, price, cohort), totals.debt, cohort.cohortCeilingBps)) {
    return "cohort_ceiling_exceeded";
  }
  return null;
}

export interface LiquidationPlan {
  kind: "partial" | "full";
  /** Collateral sold through the swap to repay debt. */
  collateralSold: bigint;
  /** Collateral taken as penalty, sold and credited to the reserve. */
  penaltyCollateral: bigint;
  /** Debt repaid from swap proceeds. */
  repaid: bigint;
  /** Loan value credited to the cohort reserve from the penalty collateral. */
  reserveCredit: bigint;
  /** Proceeds above the debt (full seizure only), returned to the user. */
  surplus: bigint;
  collateralAfter: bigint;
  debtAfter: bigint;
  /** Debt left with no collateral behind it. Goes to the loss waterfall. */
  shortfall: bigint;
}

/**
 * Sells exactly enough collateral, at oracle price minus slippage, to bring LTV back to
 * maxOpenLtvBps after also taking the penalty from collateral. If even all collateral
 * cannot do that, seizes everything and reports the shortfall.
 *
 * With x the oracle value sold, k = 1 - slippage and p = penalty:
 * proceeds = x*k, penalty value = x*k*p, and (D - x*k) / (V - x - x*k*p) = target.
 */
export function planLiquidation(p: UserPosition, price: bigint, cohort: Cohort, cfg: RiskConfig): LiquidationPlan {
  if (price <= 0n) throw new RangeError("price must be positive");
  const kb = BPS - cfg.slippageBps;
  const pen = cfg.penaltyBps;
  const target = cfg.maxOpenLtvBps;
  const value = collateralValue(p.collateral, price, cohort);
  const proceedsOf = (units: bigint): bigint => (collateralValue(units, price, cohort) * kb) / BPS;

  const coef = kb * PRICE_SCALE - target * PRICE_SCALE - target * kb * pen;
  const num = BPS * p.debt - target * value;
  if (coef > 0n && num > 0n) {
    const x = ceilDiv(num * PRICE_SCALE, coef);
    if (x * (PRICE_SCALE + kb * pen) <= value * PRICE_SCALE) {
      let sold = collateralForValue(x, price, cohort);
      for (let i = 0; i < 64; i++) {
        const repaid = proceedsOf(sold);
        const penColl = collateralForValue(ceilDiv(repaid * pen, BPS), price, cohort);
        if (sold + penColl > p.collateral || repaid > p.debt) break;
        const collateralAfter = p.collateral - sold - penColl;
        const debtAfter = p.debt - repaid;
        if (!ltvAbove(collateralValue(collateralAfter, price, cohort), debtAfter, target)) {
          return {
            kind: "partial",
            collateralSold: sold,
            penaltyCollateral: penColl,
            repaid,
            reserveCredit: proceedsOf(penColl),
            surplus: 0n,
            collateralAfter,
            debtAfter,
            shortfall: 0n,
          };
        }
        sold += 1n;
      }
    }
  }

  // Full seizure: split all collateral into the sold part and the penalty part.
  const x = (value * PRICE_SCALE) / (PRICE_SCALE + kb * pen);
  const sold = (x * PRICE_SCALE * pow10(cohort.collateralDecimals)) / (price * pow10(cohort.loanDecimals));
  const soldClamped = sold > p.collateral ? p.collateral : sold;
  const penColl = p.collateral - soldClamped;
  const repaidRaw = proceedsOf(soldClamped);
  const repaid = repaidRaw > p.debt ? p.debt : repaidRaw;
  const debtAfter = p.debt - repaid;
  return {
    kind: "full",
    collateralSold: soldClamped,
    penaltyCollateral: penColl,
    repaid,
    reserveCredit: proceedsOf(penColl),
    surplus: repaidRaw - repaid,
    collateralAfter: 0n,
    debtAfter,
    shortfall: debtAfter,
  };
}
