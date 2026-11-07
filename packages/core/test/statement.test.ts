import { describe, expect, it } from "vitest";
import {
  type Hex,
  applyBatch,
  buildStatement,
  checkInvariants,
  commit,
  createNote,
  leafHash,
  newLedger,
  proof,
  verify,
  verifyNote,
} from "../src/index.js";
import { BTC, BTCU, USDC, ctx } from "./helpers.js";

function sample() {
  const r = applyBatch(
    newLedger(BTC, 1000),
    [
      { kind: "deposit", userId: "alice", amount: BTCU(2) },
      { kind: "deposit", userId: "bob", amount: BTCU(3) },
      { kind: "borrow", userId: "alice", amount: USDC(80_000) },
      { kind: "borrow", userId: "bob", amount: USDC(10_000) },
    ],
    ctx(),
  );
  const c = commit(r.ledger);
  return { ledger: r.ledger, c };
}

describe("statement", () => {
  it("reports totals, reserve, root, padded leaf count, timestamp and batch id", () => {
    const { ledger, c } = sample();
    ledger.reserve = 123n;
    const s = buildStatement(ledger, c, "batch-1", 1234);
    expect(s).toMatchObject({
      cohortId: "cbbtc",
      totalCollateral: BTCU(5),
      totalDebt: USDC(90_000),
      reserve: 123n,
      leafCount: 1024,
      timestamp: 1234,
      batchId: "batch-1",
    });
    expect(s.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(checkInvariants([...ledger.positions.values()], s)).toEqual([]);
  });

  it("flags totals that disagree with the positions", () => {
    const { ledger, c } = sample();
    const s = buildStatement(ledger, c, "b", 1);
    const positions = [...ledger.positions.values()];
    expect(checkInvariants(positions, { ...s, totalCollateral: s.totalCollateral + 1n })).toHaveLength(1);
    expect(checkInvariants(positions, { ...s, totalDebt: s.totalDebt - 1n })).toHaveLength(1);
    expect(checkInvariants(positions, { ...s, reserve: -1n })).toHaveLength(1);
    expect(checkInvariants(positions.slice(1), s)).toHaveLength(2);
  });

  it("the root is independent of insertion order", () => {
    const { ledger, c } = sample();
    const reordered = { ...ledger, positions: new Map([...ledger.positions].reverse()) };
    expect(buildStatement(reordered, commit(reordered), "b", 1).merkleRoot).toBe(buildStatement(ledger, c, "b", 1).merkleRoot);
  });
});

describe("notes", () => {
  it("every user's note verifies against the root", () => {
    const { ledger, c } = sample();
    const root = buildStatement(ledger, c, "b1", 1).merkleRoot;
    for (const p of ledger.positions.values()) {
      const note = createNote(p, c, "b1");
      expect(note).toMatchObject({ cohortId: "cbbtc", userId: p.userId, collateral: p.collateral, debt: p.debt, nonce: p.nonce, salt: p.salt, root, batchId: "b1" });
      expect(verifyNote(note, root)).toBe(true);
      expect(verify(leafHash(p), proof(c.tree, c.slots.get(p.userId)!), root)).toBe(true);
    }
  });

  it("a tampered note fails", () => {
    const { ledger, c } = sample();
    const root = buildStatement(ledger, c, "b1", 1).merkleRoot;
    const note = createNote(ledger.positions.get("alice")!, c, "b1");
    expect(verifyNote({ ...note, debt: note.debt - 1n }, root)).toBe(false);
    expect(verifyNote({ ...note, collateral: note.collateral + 1n }, root)).toBe(false);
    expect(verifyNote({ ...note, nonce: note.nonce - 1n }, root)).toBe(false);
    expect(verifyNote({ ...note, salt: ("0x" + "ab".repeat(32)) as Hex }, root)).toBe(false);
    expect(verifyNote({ ...note, userId: "bob" }, root)).toBe(false);
  });

  it("an old note fails against a newer root", () => {
    const { ledger, c } = sample();
    const old = createNote(ledger.positions.get("alice")!, c, "b1");
    const next = applyBatch(ledger, [{ kind: "repay", userId: "alice", amount: USDC(1) }], ctx({}, 1001)).ledger;
    const newRoot = buildStatement(next, commit(next), "b2", 2).merkleRoot;
    expect(verifyNote(old, newRoot)).toBe(false);
  });

  it("refuses a note for a user not in the commitment", () => {
    const { ledger, c } = sample();
    expect(() => createNote({ ...ledger.positions.get("alice")!, userId: "nobody" }, c, "b")).toThrow();
  });
});
