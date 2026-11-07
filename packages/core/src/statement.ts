import { bytesToHex, utf8 } from "./hex.js";
import { totals } from "./ledger.js";
import { type Tree, buildTree, leafCount, leafHash, root } from "./merkle.js";
import type { CohortLedger, SolvencyStatement, UserPosition } from "./types.js";
import { keccak_256 } from "@noble/hashes/sha3";

/** The tree of a ledger plus the slot of each user. Private to the agent. */
export interface Commitment {
  tree: Tree;
  /** Slot index by user id. */
  slots: Map<string, number>;
}

/** Leaves are ordered by keccak(userId), so the order is deterministic and reveals nothing about join order. */
export function commit(ledger: CohortLedger): Commitment {
  const ordered = [...ledger.positions.values()]
    .map((p) => ({ p, key: bytesToHex(keccak_256(utf8(p.userId))) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const slots = new Map<string, number>();
  ordered.forEach((o, i) => slots.set(o.p.userId, i));
  return { tree: buildTree(ordered.map((o) => leafHash(o.p))), slots };
}

export function buildStatement(
  ledger: CohortLedger,
  commitment: Commitment,
  batchId: string,
  timestamp: number,
): SolvencyStatement {
  const t = totals(ledger);
  return {
    cohortId: ledger.cohort.id,
    totalCollateral: t.collateral,
    totalDebt: t.debt,
    reserve: ledger.reserve,
    merkleRoot: root(commitment.tree),
    leafCount: leafCount(commitment.tree),
    timestamp,
    batchId,
  };
}

/** Returns every violated invariant. An empty list means the statement matches the positions. */
export function checkInvariants(positions: UserPosition[], s: SolvencyStatement): string[] {
  const errors: string[] = [];
  let collateral = 0n;
  let debt = 0n;
  for (const p of positions) {
    if (p.collateral < 0n || p.debt < 0n) errors.push(`negative amount for a position in ${s.cohortId}`);
    if (p.cohortId !== s.cohortId) errors.push("position belongs to another cohort");
    collateral += p.collateral;
    debt += p.debt;
  }
  if (collateral !== s.totalCollateral) errors.push("sum of user collateral differs from totalCollateral");
  if (debt !== s.totalDebt) errors.push("sum of user debt differs from totalDebt");
  if (s.reserve < 0n) errors.push("negative reserve");
  if (positions.length > s.leafCount) errors.push("more positions than leaves");
  return errors;
}

