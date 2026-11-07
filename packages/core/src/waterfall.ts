import type { LossEvent } from "./types.js";

export interface WaterfallInput {
  cohortId: string;
  /** Debt the liquidation could not cover, loan smallest units. */
  shortfall: bigint;
  /** Loan value of the user's collateral and penalty not yet applied (usually 0). */
  userResidual?: bigint;
  /** Cohort reserve before the loss. */
  reserve: bigint;
  /** Other users of the SAME cohort with debt. The loss never leaves the cohort. */
  others: { userId: string; debt: bigint }[];
}

export interface WaterfallResult {
  event: LossEvent;
  coveredByUser: bigint;
  reserveAfter: bigint;
  /** Debt added to other users of the cohort, by pro rata share of their debt. */
  debtIncreases: { userId: string; amount: bigint }[];
  /** Part nobody in the cohort could absorb (no other borrowers). Stays as bad debt. */
  unabsorbed: bigint;
}

/**
 * Absorbs a shortfall in order: the user's own remaining collateral and penalty,
 * then the cohort reserve, then pro rata across the other users in the same cohort by debt.
 * The event never carries a user id.
 */
export function absorbShortfall(input: WaterfallInput): WaterfallResult {
  if (input.shortfall < 0n || input.reserve < 0n) throw new RangeError("negative amount");
  const residual = input.userResidual ?? 0n;
  const coveredByUser = residual < input.shortfall ? residual : input.shortfall;
  const amount = input.shortfall - coveredByUser;
  const coveredByReserve = amount < input.reserve ? amount : input.reserve;
  const remaining = amount - coveredByReserve;

  const holders = input.others.filter((o) => o.debt > 0n);
  const totalDebt = holders.reduce((s, o) => s + o.debt, 0n);
  const socialized = totalDebt === 0n ? 0n : remaining;
  const debtIncreases = splitProRata(holders, totalDebt, socialized);

  return {
    event: { cohortId: input.cohortId, amount, coveredByReserve, socialized },
    coveredByUser,
    reserveAfter: input.reserve - coveredByReserve,
    debtIncreases,
    unabsorbed: remaining - socialized,
  };
}

/** Floor shares by debt; the leftover units go one each to the largest debts, ties by user id. */
function splitProRata(
  holders: { userId: string; debt: bigint }[],
  totalDebt: bigint,
  total: bigint,
): { userId: string; amount: bigint }[] {
  if (total === 0n) return [];
  const rows = holders.map((h) => ({ userId: h.userId, debt: h.debt, amount: (total * h.debt) / totalDebt }));
  let left = total - rows.reduce((s, r) => s + r.amount, 0n);
  const order = [...rows].sort((a, b) => (a.debt === b.debt ? (a.userId < b.userId ? -1 : 1) : a.debt > b.debt ? -1 : 1));
  for (let i = 0; left > 0n; i = (i + 1) % order.length, left--) order[i]!.amount += 1n;
  return rows.filter((r) => r.amount > 0n).map((r) => ({ userId: r.userId, amount: r.amount }));
}
