export const SECONDS_PER_YEAR = 31_536_000n;
export const DEFAULT_SPREAD_BPS = 100n;

const RAY = 10n ** 27n;
const BPS = 10_000n;

export interface Accrual {
  /** Debt after accrual. */
  debt: bigint;
  /** Total interest added. */
  interest: bigint;
  /** Part of the interest that is the Blindside spread, owed to the cohort reserve. */
  spread: bigint;
  /** Part of the interest that accrues at the Morpho borrow rate. */
  morpho: bigint;
}

function rpow(base: bigint, exp: bigint): bigint {
  let result = RAY;
  let b = base;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) / RAY;
    b = (b * b) / RAY;
    e >>= 1n;
  }
  return result;
}

/**
 * Compounds `debt` once per second for `seconds` at (Morpho APR + spread).
 * Integer ray math, rounded up so the cohort never under-collects.
 * The interest is split between Morpho and the spread in proportion to the two rates.
 */
export function accrue(debt: bigint, aprBps: bigint, spreadBps: bigint, seconds: number): Accrual {
  if (debt < 0n || aprBps < 0n || spreadBps < 0n || seconds < 0 || !Number.isInteger(seconds)) {
    throw new RangeError("invalid accrual input");
  }
  const totalBps = aprBps + spreadBps;
  if (debt === 0n || totalBps === 0n || seconds === 0) {
    return { debt, interest: 0n, spread: 0n, morpho: 0n };
  }
  const perSecond = (totalBps * RAY) / (BPS * SECONDS_PER_YEAR);
  const factor = rpow(RAY + perSecond, BigInt(seconds));
  const next = (debt * factor + RAY - 1n) / RAY;
  const interest = next - debt;
  const spread = (interest * spreadBps) / totalBps;
  return { debt: next, interest, spread, morpho: interest - spread };
}
