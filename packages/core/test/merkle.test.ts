import { describe, expect, it } from "vitest";
import {
  type Hex,
  MIN_LEAVES,
  buildTree,
  leafCount,
  leafHash,
  padLeaf,
  paddedSize,
  proof,
  root,
  verify,
} from "../src/index.js";
import { BTCU, USDC, pos } from "./helpers.js";

const leaves = (n: number): Hex[] => Array.from({ length: n }, (_, i) => leafHash(pos(`u${i}`, BTCU(1), USDC(i))));

describe("merkle tree", () => {
  it("pads to at least 1024 and then to the next power of two", () => {
    expect(paddedSize(0)).toBe(MIN_LEAVES);
    expect(paddedSize(3)).toBe(1024);
    expect(paddedSize(1024)).toBe(1024);
    expect(paddedSize(1025)).toBe(2048);
    expect(leafCount(buildTree(leaves(5)))).toBe(1024);
  });

  it("fills with deterministic dummy leaves keccak256('blindside-pad' || index)", () => {
    const t = buildTree(leaves(2));
    expect(t.levels[0]![2]).toBe(padLeaf(2));
    expect(t.levels[0]![1023]).toBe(padLeaf(1023));
    expect(padLeaf(7)).toBe(padLeaf(7));
    expect(padLeaf(7)).not.toBe(padLeaf(8));
  });

  it("verifies every real and padded slot", () => {
    const t = buildTree(leaves(7));
    const r = root(t);
    for (const i of [0, 1, 6, 7, 500, 1023]) {
      expect(verify(t.levels[0]![i]!, proof(t, i), r)).toBe(true);
    }
  });

  it("is stable for the same input and changes when any leaf changes", () => {
    const l = leaves(4);
    expect(root(buildTree(l))).toBe(root(buildTree(leaves(4))));
    const changed = [...l];
    changed[3] = leafHash(pos("u3", BTCU(1), USDC(3) + 1n));
    expect(root(buildTree(changed))).not.toBe(root(buildTree(l)));
  });

  it("a tampered amount fails", () => {
    const t = buildTree(leaves(4));
    const r = root(t);
    const real = pos("u2", BTCU(1), USDC(2));
    expect(verify(leafHash(real), proof(t, 2), r)).toBe(true);
    expect(verify(leafHash({ ...real, debt: real.debt - 1n }), proof(t, 2), r)).toBe(false);
    expect(verify(leafHash({ ...real, collateral: real.collateral + 1n }), proof(t, 2), r)).toBe(false);
    expect(verify(leafHash({ ...real, nonce: real.nonce + 1n }), proof(t, 2), r)).toBe(false);
  });

  it("a proof is bound to its index: left and right are not interchangeable", () => {
    const t = buildTree(leaves(4));
    const r = root(t);
    const p = proof(t, 2);
    expect(verify(t.levels[0]![2]!, { ...p, index: 3 }, r)).toBe(false);
    expect(verify(t.levels[0]![2]!, { ...p, index: 2 + 1024 }, r)).toBe(false);
    // swapping a leaf with its sibling must not verify at the swapped slot
    expect(verify(t.levels[0]![3]!, { index: 2, siblings: p.siblings }, r)).toBe(false);
  });

  it("rejects a wrong root and a truncated proof", () => {
    const t = buildTree(leaves(4));
    const p = proof(t, 1);
    expect(verify(t.levels[0]![1]!, p, padLeaf(0))).toBe(false);
    expect(verify(t.levels[0]![1]!, { ...p, siblings: p.siblings.slice(1) }, root(t))).toBe(false);
  });

  it("cannot match a leaf without the salt", () => {
    const real = pos("alice", BTCU(1), USDC(40_000));
    const published = leafHash(real);
    let hit: bigint | null = null;
    // an observer who knows the user and the cohort tries every plausible debt with a guessed salt
    const zeroSalt = ("0x" + "00".repeat(32)) as Hex;
    for (let d = 39_990n; d <= 40_010n; d++) {
      if (leafHash({ ...real, debt: USDC(0) + d * 10n ** 6n, salt: zeroSalt }) === published) hit = d;
    }
    expect(hit).toBeNull();
    // with the salt the exact amounts confirm
    expect(leafHash({ ...real })).toBe(published);
    // a different salt gives an unrelated leaf for the same amounts
    const other = ("0x" + "11".repeat(32)) as Hex;
    expect(leafHash({ ...real, salt: other })).not.toBe(published);
  });

  it("validates salt length", () => {
    expect(() => leafHash({ ...pos("a", 1n, 1n), salt: "0x1234" })).toThrow();
  });
});
