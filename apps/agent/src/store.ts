import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { newLedger, type CohortLedger, type Note, type UserPosition } from "@offmap/core";
import { COHORTS, config } from "./config.js";

/** A request waiting for its money to arrive or for the next batch. */
export interface Pending {
  id: string;
  kind: "deposit" | "repay";
  userId: string;
  cohortId: string;
  depositAddress: string;
  /** For a deposit: USDC to borrow once the collateral is in. */
  borrow?: string;
  receive?: Receive;
  createdAt: number;
  status: "waiting" | "arrived" | "supplied" | "applied" | "failed";
  arrivedAmount?: string;
  /** Collateral credited after it landed on Morpho (checkpoint, survives a crash). */
  suppliedAmount?: string;
  note?: string;
}
export interface Receive { asset: string; address: string }
export interface Request { id: string; kind: "borrow" | "withdraw"; userId: string; cohortId: string; amount: string; receive: Receive; createdAt: number; status: "queued" | "applied" | "rejected"; reason?: string }
export interface Payout { id: string; userId: string; asset: string; amount: string; destinationAsset: string; recipient: string; notBefore: number; status: "queued" | "sent" | "done" | "failed"; deposit?: string; tx?: string; tries?: number }
export interface BatchLog { batchId: string; cohortId: string; at: number; txs: string[]; statementTx?: string; delta: { collateral: string; debt: string }; usersChanged?: number }

export interface State {
  ledgers: Record<string, CohortLedger>;
  batchCounter: Record<string, number>;
  pending: Pending[];
  requests: Request[];
  payouts: Payout[];
  notes: Record<string, Note>;
  /** userId -> EVM address that owns the position (eject destination). */
  owners: Record<string, string>;
  batches: BatchLog[];
}

export function freshState(): State {
  const now = Math.floor(Date.now() / 1000);
  return {
    ledgers: Object.fromEntries(COHORTS.map((c) => [c.id, newLedger(c, now)])),
    batchCounter: Object.fromEntries(COHORTS.map((c) => [c.id, 0])),
    pending: [], requests: [], payouts: [], notes: {}, owners: {}, batches: [],
  };
}

// JSON with bigint and Map support.
const replacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? { $big: v.toString() } : v instanceof Map ? { $map: [...v.entries()] } : v;
const reviver = (_k: string, v: any) => (v && typeof v === "object" ? ("$big" in v ? BigInt(v.$big) : "$map" in v ? new Map(v.$map) : v) : v);

function key(): Buffer {
  if (!config.stateKey || config.stateKey.length !== 64) throw new Error("STATE_KEY must be 32 bytes hex");
  return Buffer.from(config.stateKey, "hex");
}

/** AES-256-GCM: iv(12) | tag(16) | ciphertext. Only an instance holding the key can read the ledger. */
export function save(s: State) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(s, replacer), "utf8"), c.final()]);
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  const tmp = config.stateFile + ".tmp";
  fs.writeFileSync(tmp, Buffer.concat([iv, c.getAuthTag(), body]));
  fs.renameSync(tmp, config.stateFile);
}

export function load(): State {
  if (!fs.existsSync(config.stateFile)) return freshState();
  const b = fs.readFileSync(config.stateFile);
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  const s: State = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"), reviver);
  for (const c of COHORTS) if (!s.ledgers[c.id]) s.ledgers[c.id] = newLedger(c, Math.floor(Date.now() / 1000));
  return s;
}

export const positionOf = (s: State, cohortId: string, userId: string): UserPosition | undefined => s.ledgers[cohortId]?.positions.get(userId);
