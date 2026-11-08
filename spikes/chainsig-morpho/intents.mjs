// Minimal NEAR Intents helpers: versioned nonce, NEP-413 signing, 1Click calls with the partner key.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { KeyPair } from "@near-js/crypto";

const env = fs.readFileSync(path.join(os.homedir(), ".offmap-secrets", "oneclick.env"), "utf8");
const JWT = env.match(/ONECLICK_JWT=(.+)/)[1].trim();
const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))), "utf8"));
export const accountId = cred.implicit_account_id;
const kp = KeyPair.fromString(cred.private_key);
export const publicKey = kp.getPublicKey().toString();

const API = "https://1click.chaindefuser.com";
export async function api(p, body, extraHeaders = {}) {
  const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "X-API-Key": JWT, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${p} ${r.status} ${t}`);
  return j;
}

const MAGIC = Buffer.from([86, 40, 246, 198]);
/** Salt is read live from the verifying contract (intents.near returns it from current_salt). */
export async function contractSalt(contract = "intents.near") {
  const r = await fetch("https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: "current_salt", args_base64: "e30=" } }) });
  const j = await r.json();
  return Buffer.from(JSON.parse(Buffer.from(j.result.result).toString()), "hex");
}
/** Versioned nonce: magic(4) | version 0 | salt(4) | deadline ns u64 LE | 15 bytes (first 8 = start time ns, rest random). */
export function versionedNonce(deadline, salt) {
  const b = Buffer.alloc(27);
  salt.copy(b, 0);
  b.writeBigUInt64LE(BigInt(deadline.getTime()) * 1000000n, 4);
  const r = Buffer.alloc(15);
  r.writeBigInt64LE(BigInt(Date.now()) * 1000000n, 0);
  randomBytes(7).copy(r, 8);
  r.copy(b, 12);
  return Buffer.concat([MAGIC, Buffer.from([0]), b]).toString("base64");
}

function borshString(s) { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); }
/** NEP-413: sha256(u32 LE 2^31+413 || borsh{message, nonce[32], recipient, callbackUrl: None}), ed25519 signed. */
export function signNep413({ message, nonce, recipient }) {
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const nonceBytes = Buffer.from(nonce, "base64");
  if (nonceBytes.length !== 32) throw new Error("nonce must be 32 bytes");
  const data = Buffer.concat([tag, borshString(message), nonceBytes, borshString(recipient), Buffer.from([0])]);
  const hash = createHash("sha256").update(data).digest();
  const { signature } = kp.sign(hash);
  return { standard: "nep413", payload: { recipient, nonce, message }, public_key: publicKey, signature: "ed25519:" + bs58.encode(Buffer.from(signature)) };
}

export async function userSession() {
  const deadline = new Date(Date.now() + 4 * 60_000);
  const message = JSON.stringify({ deadline: deadline.toISOString(), intents: [], signer_id: accountId });
  const signedData = signNep413({ message, nonce: versionedNonce(deadline, await contractSalt()), recipient: "intents.near" });
  return api("/v0/auth/authenticate", { signedData });
}
export async function confidentialBalances(token) {
  return api("/v0/account/balances", null, { Authorization: `Bearer ${token}` });
}
