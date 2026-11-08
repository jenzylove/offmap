// Probe: act as offmapfi.near on Intents with the build key (registered temporarily), read the private balance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { confidentialBalances } from "../src/intents.js";
const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const kp = KeyPair.fromString(cred.private_key as KeyPairString);
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" });
const contract = new Account("offmapfi.near", provider, new KeyPairSigner(kp));
const pk = kp.getPublicKey().toString();
if (process.argv.includes("--add")) {
  const r = await contract.callFunction({ contractId: "intents.near", methodName: "add_public_key", args: { public_key: pk }, deposit: 1n, gas: 30_000_000_000_000n });
  console.log("added build key to intents for offmapfi.near", r);
}
if (process.argv.includes("--remove")) {
  const r = await contract.callFunction({ contractId: "intents.near", methodName: "remove_public_key", args: { public_key: pk }, deposit: 1n, gas: 30_000_000_000_000n });
  console.log("removed build key", r);
  process.exit(0);
}
const id: any = { intentsSigner: "offmapfi.near", publicKey: pk, signHash: (h: Uint8Array) => "ed25519:" + bs58.encode(Buffer.from(kp.sign(h).signature)) };
try { console.log("balances", Object.fromEntries(await confidentialBalances(id))); } catch (e) { console.log("session/balance error:", String(e).slice(0, 300)); }
