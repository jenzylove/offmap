import { leafHash, proof, verify } from "./merkle.js";
import type { Commitment } from "./statement.js";
import { root as treeRoot } from "./merkle.js";
import type { Hex, Note, UserPosition } from "./types.js";

/** A note holds the user's position, salt, the root and the user's Merkle proof. */
export function createNote(position: UserPosition, commitment: Commitment, batchId: string): Note {
  const slot = commitment.slots.get(position.userId);
  if (slot === undefined) throw new RangeError("user is not in the commitment");
  return {
    cohortId: position.cohortId,
    userId: position.userId,
    collateral: position.collateral,
    debt: position.debt,
    nonce: position.nonce,
    salt: position.salt,
    root: treeRoot(commitment.tree),
    proof: proof(commitment.tree, slot),
    batchId,
  };
}

/** True only if the note's fields hash to a leaf that the proof ties to `root`, and the note names the same root. */
export function verifyNote(note: Note, root: Hex): boolean {
  if (note.root !== root) return false;
  return verify(leafHash(note), note.proof, root);
}
