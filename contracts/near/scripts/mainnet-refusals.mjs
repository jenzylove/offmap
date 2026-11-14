// Sends calls a stranger should never be allowed to make to offmapfi.near on NEAR mainnet,
// and records how the contract refuses each one. Costs a little gas, moves no funds.
// Run: node contracts/near/scripts/mainnet-refusals.mjs <signer account id>   (key in ~/.near-credentials/implicit)
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../spikes/chainsig-morpho/package.json"));
const { Account } = require("@near-js/accounts");
const { KeyPair } = require("@near-js/crypto");
const { JsonRpcProvider } = require("@near-js/providers");
const { KeyPairSigner } = require("@near-js/signers");
const { actionCreators } = require("@near-js/transactions");

const CONTRACT = "offmapfi.near";
const SIGNER = process.argv[2];
if (!SIGNER) throw new Error("usage: mainnet-refusals.mjs <signer account id>");
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" });
const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", "implicit", `${SIGNER}.json`), "utf8"));
const stranger = new Account(SIGNER, provider, new KeyPairSigner(KeyPair.fromString(cred.private_key)));
const fx = JSON.parse(fs.readFileSync(path.join(here, "../tests/fixtures.json"), "utf8"));
const view = async (method, args = {}) => {
  const r = await provider.query({ request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
};

const log = [];
const only = process.argv[3];
async function attack(name, method, args, gasT = 30n, deposit = 0n) {
  if (only && only !== method) return;
  const r = await stranger.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actionCreators.functionCall(method, Buffer.from(JSON.stringify(args)), gasT * 10n ** 12n, deposit)],
    throwOnFailure: false,
    waitUntil: "FINAL",
  });
  const failure = r.status.Failure ? JSON.stringify(r.status.Failure) : null;
  const msg = failure ? (failure.match(/Smart contract panicked: ([^"]+)"/)?.[1] ?? failure.slice(0, 200)) : null;
  const entry = { name, method, tx: r.transaction.hash, refused: !!failure, answer: msg ?? "NOT REFUSED" };
  log.push(entry);
  console.log(`${failure ? "REFUSED" : "!! ACCEPTED"}  ${name}  ${entry.tx}  ${entry.answer}`);
}

const zeros = (n) => "0".repeat(n);
const fakeAttestation = {
  quote: [],
  collateral: { pck_crl_issuer_chain: "", root_ca_crl: "", pck_crl: "", tcb_info_issuer_chain: "", tcb_info: "", tcb_info_signature: "", qe_identity_issuer_chain: "", qe_identity: "", qe_identity_signature: "" },
  tcb_info: { mrtd: zeros(96), rtmr0: zeros(96), rtmr1: zeros(96), rtmr2: zeros(96), rtmr3: zeros(96), os_image_hash: "", compose_hash: zeros(64), device_id: zeros(64), app_compose: "", event_log: [] },
};
const config = await view("config");
const stmt = { ...fx.statement, cohort_id: "cbbtc-usdc", batch_id: "999999", timestamp_ms: String(Date.now() - 5000) };

await attack("A stranger registers as the agent with a made up attestation", "register_agent", { attestation: fakeAttestation }, 30n, 5_000_000_000_000_000_000_000n);
await attack("A stranger whitelists their own agent", "whitelist_agent_dev", { account_id: SIGNER });
await attack("A stranger posts a solvency statement", "submit_statement", { stmt });
await attack("A stranger opens a batch lock", "begin_batch", { cohort_id: "cbbtc-usdc" });
await attack("A stranger asks for a signature over the pool", "request_signature", { cohort_id: "cbbtc-usdc", payload_hex: fx.expected.payload_hash });
await attack("A stranger proposes a new config", "propose_config", { config });
await attack("A stranger sweeps the contract's NEAR", "sweep", {});
await attack("A stranger announces a code swap", "announce_wind_down", { code_hash: zeros(64) });
await attack("A stranger forces recovery mode while the agent is alive", "recover", {});
await attack("Someone ejects with a forged note", "eject", { cohort_id: "cbbtc-usdc", leaf: fx.leaf, proof: fx.proof, eject_args: fx.eject_args }, 25n, 20_000_000_000_000_000_000_000n);

if (!only) fs.writeFileSync(path.join(here, "mainnet-refusals.run.json"), JSON.stringify({ contract: CONTRACT, signer: SIGNER, at: new Date().toISOString(), log }, null, 2));
console.log(`\n${log.filter((e) => e.refused).length} of ${log.length} refused`);
