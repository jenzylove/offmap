import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concat, hexToBytes, u256, utf8 } from "./hex.js";
import type { Hex, MerkleProof, UserPosition } from "./types.js";

export const MIN_LEAVES = 1024;

export interface Tree {
  /** levels[0] are the padded leaves, the last level holds the root. */
  levels: Hex[][];
}

const h = (b: Uint8Array): Hex => bytesToHex(keccak_256(b));

export type LeafFields = Pick<UserPosition, "cohortId" | "userId" | "collateral" | "debt" | "nonce" | "salt">;

/**
 * leaf = keccak256(keccak(cohortId) || keccak(userId) || uint256 collateral
 *                  || uint256 debt || uint256 nonce || bytes32 salt)
 * Six 32 byte words, 192 bytes. Inner nodes hash 64 bytes, so a leaf and a node never collide.
 */
export function leafHash(f: LeafFields): Hex {
  const salt = hexToBytes(f.salt);
  if (salt.length !== 32) throw new RangeError("salt must be 32 bytes");
  return h(
    concat(keccak_256(utf8(f.cohortId)), keccak_256(utf8(f.userId)), u256(f.collateral), u256(f.debt), u256(f.nonce), salt),
  );
}

/** Deterministic filler leaf: keccak256("offmap-pad" || uint32 big endian slot index). */
export function padLeaf(index: number): Hex {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index, false);
  return h(concat(utf8("offmap-pad"), idx));
}

export function paddedSize(count: number): number {
  let n = MIN_LEAVES;
  while (n < count) n *= 2;
  return n;
}

/** Node hash is positional: left child first, right child second. No sorting. */
function node(left: Hex, right: Hex): Hex {
  return h(concat(hexToBytes(left), hexToBytes(right)));
}

export function buildTree(leaves: Hex[]): Tree {
  const size = paddedSize(leaves.length);
  const level0: Hex[] = [];
  for (let i = 0; i < size; i++) level0.push(i < leaves.length ? leaves[i]! : padLeaf(i));
  const levels: Hex[][] = [level0];
  while (levels[levels.length - 1]!.length > 1) {
    const prev = levels[levels.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(node(prev[i]!, prev[i + 1]!));
    levels.push(next);
  }
  return { levels };
}

export function root(tree: Tree): Hex {
  return tree.levels[tree.levels.length - 1]![0]!;
}

export function leafCount(tree: Tree): number {
  return tree.levels[0]!.length;
}

export function proof(tree: Tree, index: number): MerkleProof {
  if (!Number.isInteger(index) || index < 0 || index >= leafCount(tree)) throw new RangeError("index out of range");
  const siblings: Hex[] = [];
  let i = index;
  for (let l = 0; l < tree.levels.length - 1; l++) {
    siblings.push(tree.levels[l]![i ^ 1]!);
    i >>= 1;
  }
  return { index, siblings };
}

export function verify(leaf: Hex, p: MerkleProof, expectedRoot: Hex): boolean {
  const depth = p.siblings.length;
  if (!Number.isInteger(p.index) || p.index < 0 || p.index >= 2 ** depth) return false;
  let acc = leaf;
  let i = p.index;
  for (const sib of p.siblings) {
    acc = i & 1 ? node(sib, acc) : node(acc, sib);
    i >>= 1;
  }
  return acc === expectedRoot;
}
