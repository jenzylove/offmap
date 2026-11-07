import type { CohortTotals } from "./risk.js";
import type { Cohort, CohortLedger, Hex, UserPosition } from "./types.js";

export function newLedger(cohort: Cohort, timestamp: number): CohortLedger {
  return { cohort, positions: new Map(), reserve: 0n, lastAccrual: timestamp };
}

export function cloneLedger(l: CohortLedger): CohortLedger {
  const positions = new Map<string, UserPosition>();
  for (const [k, v] of l.positions) positions.set(k, { ...v });
  return { cohort: l.cohort, positions, reserve: l.reserve, lastAccrual: l.lastAccrual };
}

export function totals(l: CohortLedger): CohortTotals {
  let collateral = 0n;
  let debt = 0n;
  for (const p of l.positions.values()) {
    collateral += p.collateral;
    debt += p.debt;
  }
  return { collateral, debt };
}

export function emptyPosition(cohortId: string, userId: string, salt: Hex): UserPosition {
  return { userId, cohortId, collateral: 0n, debt: 0n, nonce: 0n, salt };
}
