import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { api, signNep413, versionedNonce } from "../src/intents.js";
const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const kp = KeyPair.fromString(cred.private_key as KeyPairString);
const id: any = { intentsSigner: process.argv[2] ?? "offmapfi.near", publicKey: kp.getPublicKey().toString(), signHash: (h: Uint8Array) => "ed25519:" + bs58.encode(Buffer.from(kp.sign(h).signature)) };
const deadline = new Date(Date.now() + 4 * 60_000);
const message = JSON.stringify({ deadline: deadline.toISOString(), intents: [], signer_id: id.intentsSigner });
const s = await api<any>("/v0/auth/authenticate", { signedData: signNep413(id, { message, nonce: await versionedNonce(deadline), recipient: "intents.near" }) });
for (const p of ["/v0/account/balances", "/v0/account/history"]) {
  try { console.log(p, JSON.stringify(await api(p, undefined, { Authorization: `Bearer ${s.accessToken}` })).slice(0, 1500)); } catch (e) { console.log(p, String(e).slice(0, 300)); }
}
