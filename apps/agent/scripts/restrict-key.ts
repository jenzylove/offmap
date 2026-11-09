// Option C: replace offmapfi.near's full access key with a key that can only call the contract's own
// owner methods. After this, nobody can replace the code or move the private Intents balance directly;
// config changes still wait the contract's 24h public notice, and NEAR comes back through sweep / wind_down.
// Run: npx tsx scripts/restrict-key.ts --dry    then    npx tsx scripts/restrict-key.ts --go
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";

const CONTRACT = "offmapfi.near";
const METHODS = ["propose_config", "apply_config", "cancel_config", "sweep", "announce_wind_down", "wind_down"];
const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const full = KeyPair.fromString(cred.private_key as KeyPairString);
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" });
const contract = new Account(CONTRACT, provider, new KeyPairSigner(full));

const keys: any = await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: CONTRACT } as any);
const fullPub = full.getPublicKey().toString();
console.log("keys on", CONTRACT, keys.keys.map((k: any) => `${k.public_key.slice(0, 16)}… ${k.access_key.permission === "FullAccess" ? "FullAccess" : "FunctionCall"}`));
if (!keys.keys.some((k: any) => k.public_key === fullPub && k.access_key.permission === "FullAccess")) throw new Error("the local key is not the full access key on the contract");

const out = path.join(os.homedir(), ".offmap-secrets", "offmapfi-restricted.json");
let restricted: KeyPair;
if (fs.existsSync(out)) restricted = KeyPair.fromString(JSON.parse(fs.readFileSync(out, "utf8")).private_key);
else {
  restricted = KeyPair.fromRandom("ed25519");
  fs.writeFileSync(out, JSON.stringify({ account_id: CONTRACT, public_key: restricted.getPublicKey().toString(), private_key: restricted.toString(), methods: METHODS }, null, 2), { mode: 0o600 });
}
console.log("restricted key", restricted.getPublicKey().toString(), "methods", METHODS.join(","), "saved to", out);
if (!process.argv.includes("--go")) { console.log("dry run: nothing sent"); process.exit(0); }

// One transaction: add the restricted key, then delete the full access key. Atomic: both or neither.
const r = await contract.signAndSendTransaction({
  receiverId: CONTRACT,
  actions: [
    actionCreators.addKey(restricted.getPublicKey(), actionCreators.functionCallAccessKey(CONTRACT, METHODS)),
    actionCreators.deleteKey(full.getPublicKey()),
  ],
});
console.log("swapped", r.transaction.hash, JSON.stringify(r.status).slice(0, 120));
const after: any = await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: CONTRACT } as any);
console.log("keys now", after.keys.map((k: any) => `${k.public_key.slice(0, 16)}… ${k.access_key.permission === "FullAccess" ? "FullAccess" : JSON.stringify(k.access_key.permission.FunctionCall?.method_names)}`));
