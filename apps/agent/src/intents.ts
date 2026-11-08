import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { type Identity, sha256 } from "./identity.js";

/**
 * NEAR Intents through the 1Click API: quotes, confidential balances (owner session),
 * signed intent execution. Proven on mainnet in docs/spikes/s2-confidential-rail.md.
 */
const API = "https://1click.chaindefuser.com";

export async function api<T = any>(path: string, body?: object, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(config.oneClickJwt ? { "X-API-Key": config.oneClickJwt } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`1click ${path} ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}

const MAGIC = Buffer.from([86, 40, 246, 198]);
let saltCache: { salt: Buffer; at: number } | undefined;

/** The verifying contract's live salt (intents.near returns it from current_salt). */
async function intentsSalt(): Promise<Buffer> {
  if (saltCache && Date.now() - saltCache.at < 600_000) return saltCache.salt;
  const r = await fetch(config.nearRpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "current_salt", args_base64: "e30=" } }) });
  const j: any = await r.json();
  const salt = Buffer.from(JSON.parse(Buffer.from(j.result.result).toString()), "hex");
  saltCache = { salt, at: Date.now() };
  return salt;
}

/** magic(4) | version 0 | salt(4) | deadline ns u64 LE | 15 bytes: start time ns (8) + random (7). */
export async function versionedNonce(deadline: Date): Promise<string> {
  const b = Buffer.alloc(27);
  (await intentsSalt()).copy(b, 0);
  b.writeBigUInt64LE(BigInt(deadline.getTime()) * 1_000_000n, 4);
  const r = Buffer.alloc(15);
  r.writeBigInt64LE(BigInt(Date.now()) * 1_000_000n, 0);
  randomBytes(7).copy(r, 8);
  r.copy(b, 12);
  return Buffer.concat([MAGIC, Buffer.from([0]), b]).toString("base64");
}

const borshString = (s: string) => {
  const b = Buffer.from(s, "utf8");
  const l = Buffer.alloc(4);
  l.writeUInt32LE(b.length);
  return Buffer.concat([l, b]);
};

export interface Nep413Payload { message: string; nonce: string; recipient: string }

/** NEP-413: sha256(u32 LE 2^31+413 || borsh{message, nonce[32], recipient, callbackUrl: None}). */
export function signNep413(id: Identity, p: Nep413Payload) {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  const nonce = Buffer.from(p.nonce, "base64");
  if (nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  const hash = sha256(Buffer.concat([tag, borshString(p.message), nonce, borshString(p.recipient), Buffer.from([0])]));
  return { standard: "nep413", payload: { recipient: p.recipient, nonce: p.nonce, message: p.message }, public_key: id.publicKey, signature: id.signHash(hash) };
}

let session: { token: string; exp: number } | undefined;
async function ownerSession(id: Identity): Promise<string> {
  if (session && session.exp > Date.now() + 30_000) return session.token;
  const deadline = new Date(Date.now() + 4 * 60_000);
  const message = JSON.stringify({ deadline: deadline.toISOString(), intents: [], signer_id: id.intentsSigner });
  const signedData = signNep413(id, { message, nonce: await versionedNonce(deadline), recipient: "intents.near" });
  const r = await api<{ accessToken: string; expiresIn: number }>("/v0/auth/authenticate", { signedData });
  session = { token: r.accessToken, exp: Date.now() + r.expiresIn * 1000 };
  return session.token;
}

/** Private balances of the confidential account, by public asset id, in smallest units. */
export async function confidentialBalances(id: Identity): Promise<Map<string, bigint>> {
  const r = await api<{ balances: { tokenId: string; available: string }[] }>("/v0/account/balances", undefined, { Authorization: `Bearer ${await ownerSession(id)}` });
  return new Map(r.balances.map((b) => [b.tokenId, BigInt(b.available)]));
}

export interface Quote { depositAddress: string; amountIn: string; amountOut: string; minAmountOut: string; amountOutFormatted: string; deadline: string }

const deadline = (h = 2) => new Date(Date.now() + h * 3600e3).toISOString();

/** A deposit address that moves the user's funds from any chain into the confidential balance, as `asset`. */
export async function quoteIntoConfidential(id: Identity, a: { originAsset: string; amount: string; asset: string; refundTo: string }): Promise<Quote> {
  const r = await api<{ quote: Quote }>("/v0/quote", {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: a.originAsset, depositType: "ORIGIN_CHAIN",
    destinationAsset: a.asset, amount: a.amount, refundTo: a.refundTo, refundType: "ORIGIN_CHAIN",
    recipient: id.intentsSigner, recipientType: "CONFIDENTIAL_INTENTS", deadline: deadline(24),
  });
  return r.quote;
}

/** Spend from the confidential balance to an address on another chain (or swap inside it), signed intent execution. */
export async function payFromConfidential(id: Identity, a: { asset: string; amount: string; destinationAsset: string; recipient: string; recipientType?: "DESTINATION_CHAIN" | "CONFIDENTIAL_INTENTS" }) {
  const { quote } = await api<{ quote: Quote }>("/v0/quote", {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: a.asset, depositType: "CONFIDENTIAL_INTENTS",
    destinationAsset: a.destinationAsset, amount: a.amount, refundTo: id.intentsSigner, refundType: "CONFIDENTIAL_INTENTS",
    recipient: a.recipient, recipientType: a.recipientType ?? "DESTINATION_CHAIN", deadline: deadline(),
  });
  const gen = await api<{ intent: { payload: Nep413Payload } }>("/v0/generate-intent", { type: "swap_transfer", standard: "nep413", signerId: id.intentsSigner, depositAddress: quote.depositAddress });
  const sub = await api<{ intentHash: string }>("/v0/submit-intent", { type: "swap_transfer", signedData: signNep413(id, gen.intent.payload) });
  return { quote, intentHash: sub.intentHash };
}

/** A deposit address on Base that moves funds sent to it into the confidential balance. */
export async function quoteFromBaseIntoConfidential(id: Identity, a: { baseAsset: string; amount: string; asset: string; refundTo: string }): Promise<Quote> {
  const r = await api<{ quote: Quote }>("/v0/quote", {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: a.baseAsset, depositType: "ORIGIN_CHAIN",
    destinationAsset: a.asset, amount: a.amount, refundTo: a.refundTo, refundType: "ORIGIN_CHAIN",
    recipient: id.intentsSigner, recipientType: "CONFIDENTIAL_INTENTS", deadline: deadline(),
  });
  return r.quote;
}

export type SwapStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
export async function status(depositAddress: string) {
  return api<{ status: SwapStatus; swapDetails: any }>(`/v0/status?depositAddress=${depositAddress}`);
}

export async function waitFor(depositAddress: string, timeoutMs = 20 * 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await status(depositAddress);
    if (["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`timeout waiting for ${depositAddress}`);
}
