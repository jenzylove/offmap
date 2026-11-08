// Remove stale public keys from offmapfi.near on intents.near (only the live TEE agent key should remain).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const c = new Account("offmapfi.near", new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" }), new KeyPairSigner(KeyPair.fromString(cred.private_key as KeyPairString)));
for (const k of process.argv.slice(2)) {
  try { await c.callFunction({ contractId: "intents.near", methodName: "remove_public_key", args: { public_key: k }, deposit: 1n, gas: 30_000_000_000_000n }); console.log("removed", k); }
  catch (e) { console.log("skip", k, String(e).slice(0, 120)); }
}
const keys = await (c.provider as any).callFunction("intents.near", "public_keys_of", { account_id: "offmapfi.near" });
console.log("remaining", JSON.stringify(keys));
