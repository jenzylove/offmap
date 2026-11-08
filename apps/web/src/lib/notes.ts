import { bytesToHex, leafHash, verify, type Hex, type Note } from "@offmap/core";
import { keccak256, toBytes } from "viem";
import type { NoteWire } from "./agent";

const isHex = (s: unknown, bytes?: number): s is Hex =>
  typeof s === "string" && /^0x[0-9a-f]*$/.test(s) && (bytes === undefined || s.length === 2 + bytes * 2);

/** Parses a note as JSON (amounts as strings or numbers). Throws a plain reason when it is malformed. */
export function parseNote(input: string | NoteWire): Note {
  let raw: Record<string, unknown>;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input) as Record<string, unknown>;
    } catch {
      throw new Error("That is not valid JSON. Paste the note exactly as you saved it.");
    }
  } else raw = input as unknown as Record<string, unknown>;
  const big = (k: string): bigint => {
    const v = raw[k];
    if (typeof v !== "string" && typeof v !== "number") throw new Error(`The note has no ${k}.`);
    try {
      return BigInt(v);
    } catch {
      throw new Error(`The note's ${k} is not a whole number.`);
    }
  };
  const str = (k: string): string => {
    const v = raw[k];
    if (typeof v !== "string" || !v) throw new Error(`The note has no ${k}.`);
    return v;
  };
  const salt = str("salt").toLowerCase();
  const root = str("root").toLowerCase();
  if (!isHex(salt, 32)) throw new Error("The salt must be 32 bytes of hex.");
  if (!isHex(root, 32)) throw new Error("The root must be 32 bytes of hex.");
  const p = raw.proof as { index?: unknown; siblings?: unknown } | undefined;
  if (!p || typeof p.index !== "number" || !Array.isArray(p.siblings)) throw new Error("The note has no Merkle proof.");
  const siblings = p.siblings.map((s) => String(s).toLowerCase());
  if (!siblings.every((s) => isHex(s, 32))) throw new Error("A proof step is not 32 bytes of hex.");
  return {
    cohortId: str("cohortId"),
    userId: str("userId"),
    collateral: big("collateral"),
    debt: big("debt"),
    nonce: big("nonce"),
    salt: salt as Hex,
    root: root as Hex,
    proof: { index: p.index, siblings: siblings as Hex[] },
    batchId: String(raw.batchId ?? ""),
  };
}

export type ProofCheck =
  | { kind: "verified"; leaf: Hex; root: Hex }
  | { kind: "stale"; leaf: Hex; noteRoot: Hex; chainRoot: Hex; selfConsistent: boolean }
  | { kind: "self_only"; leaf: Hex; root: Hex }
  | { kind: "invalid"; leaf: Hex; root: Hex };

/**
 * Checks the note's leaf against the root stored on offmapfi.near.
 * With no on chain root yet, it can only say whether the proof is consistent with the note's own root.
 */
export function checkNote(note: Note, chainRoot: string | null): ProofCheck {
  const leaf = leafHash(note);
  const selfConsistent = verify(leaf, note.proof, note.root);
  if (!chainRoot) return selfConsistent ? { kind: "self_only", leaf, root: note.root } : { kind: "invalid", leaf, root: note.root };
  const cr = chainRoot.toLowerCase() as Hex;
  if (note.root !== cr) return { kind: "stale", leaf, noteRoot: note.root, chainRoot: cr, selfConsistent };
  return verify(leaf, note.proof, cr) ? { kind: "verified", leaf, root: cr } : { kind: "invalid", leaf, root: cr };
}

/** userId per ARCHITECTURE.md: lowercase hex of keccak256(owner auth string). */
export function userIdFor(owner: string): { withPrefix: string; bare: string } {
  const h = keccak256(toBytes(owner));
  return { withPrefix: h.toLowerCase(), bare: h.slice(2).toLowerCase() };
}

export function noteOwnedBy(note: Note, owner: string): boolean {
  const id = userIdFor(owner);
  const n = note.userId.toLowerCase();
  return n === id.withPrefix || n === id.bare;
}

export { bytesToHex };
