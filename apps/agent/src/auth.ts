import { createHmac, timingSafeEqual } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { verifyMessage, getAddress } from "viem";
import { config } from "./config.js";

/** userId = hex(keccak256("evm:<lowercase address>")). The same address is the eject destination. */
export const userIdFor = (address: string) => "0x" + Buffer.from(keccak_256(`evm:${address.toLowerCase()}`)).toString("hex");

export const authMessage = (nonce: string, deadline: string) => `offmap:auth:${nonce}:${deadline}`;

const sign = (body: string) => createHmac("sha256", config.sessionSecret).update(body).digest("base64url");

/** EVM wallet signs `offmap:auth:<nonce>:<deadline>` (EIP-191). Returns a session token valid for 12 hours. */
export async function login(address: string, nonce: string, deadline: string, signature: `0x${string}`) {
  if (Date.parse(deadline) < Date.now() || Date.parse(deadline) > Date.now() + 15 * 60_000) throw new Error("deadline out of range");
  const ok = await verifyMessage({ address: getAddress(address), message: authMessage(nonce, deadline), signature });
  if (!ok) throw new Error("bad signature");
  const body = Buffer.from(JSON.stringify({ a: address.toLowerCase(), e: Date.now() + 12 * 3600e3 })).toString("base64url");
  return { token: `${body}.${sign(body)}`, userId: userIdFor(address), address: address.toLowerCase() };
}

export function session(token: string | undefined): { address: string; userId: string } | null {
  if (!token) return null;
  const [body, mac] = token.replace(/^Bearer /, "").split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const { a, e } = JSON.parse(Buffer.from(body, "base64url").toString());
  if (e < Date.now()) return null;
  return { address: a, userId: userIdFor(a) };
}
