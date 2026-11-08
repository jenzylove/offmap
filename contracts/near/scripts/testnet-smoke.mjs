// Testnet smoke run for offmap: deploy, init (dev mode), whitelist + register an agent, submit a
// statement, get a real MPC signature, eject with the fixture proof, and record each refusal as a
// real failed transaction. Testnet only.
//
//   node contracts/near/scripts/testnet-smoke.mjs <contract.testnet> <implicit agent> <funder.testnet> [recovery_delay_ms]
//
// Keys are read from ~/.near-credentials/testnet/<account>.json (legacy keychain). Writes
// contracts/near/scripts/<contract>.run.json with every tx hash and result.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const spike = path.join(here, "../../../spikes/chainsig-morpho/package.json");
const require = createRequire(spike);
const { Account } = require("@near-js/accounts");
const { KeyPair } = require("@near-js/crypto");
const { JsonRpcProvider } = require("@near-js/providers");
const { KeyPairSigner } = require("@near-js/signers");
const { actionCreators } = require("@near-js/transactions");
const { recoverTransactionAddress, createPublicClient, http } = require("viem");
const { base } = require("viem/chains");
const { chainAdapters, contracts } = require("chainsig.js");

const [CONTRACT, AGENT, FUNDER, RECOVERY_MS] = process.argv.slice(2);
if (!CONTRACT || !AGENT || !FUNDER) throw new Error("usage: contract agent funder [recovery_delay_ms]");
const MPC = "v1.signer-prod.testnet";
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const fx = JSON.parse(fs.readFileSync(path.join(here, "../tests/fixtures.json"), "utf8"));
const wasm = fs.readFileSync(path.join(here, "../target/near/offmap.wasm"));

function account(id) {
  const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", "testnet", `${id}.json`), "utf8"));
  return new Account(id, provider, new KeyPairSigner(KeyPair.fromString(cred.private_key)));
}
const contract = account(CONTRACT);
const agent = account(AGENT);
const funder = account(FUNDER);

const log = [];
const out = (r) => {
  const st = r.status;
  if (st.SuccessValue !== undefined) {
    const raw = Buffer.from(st.SuccessValue, "base64").toString();
    try { return { ok: true, value: raw ? JSON.parse(raw) : null }; } catch { return { ok: true, value: raw }; }
  }
  return { ok: false, error: JSON.stringify(st.Failure) };
};
const receiptFailures = (r) =>
  r.receipts_outcome
    .filter((o) => o.outcome.status.Failure)
    .map((o) => ({ executor: o.outcome.executor_id, error: JSON.stringify(o.outcome.status.Failure).slice(0, 300) }));

async function step(name, who, receiverId, actions, expectFail = false) {
  const r = await who.signAndSendTransaction({ receiverId, actions, throwOnFailure: false, waitUntil: "FINAL" });
  const o = out(r);
  const entry = { name, signer: who.accountId, tx: r.transaction.hash, ...o, receipt_failures: receiptFailures(r) };
  log.push(entry);
  const tag = o.ok === !expectFail ? "OK  " : "UNEXPECTED";
  console.log(`${tag} ${name}  ${r.transaction.hash}  ${o.ok ? JSON.stringify(o.value)?.slice(0, 160) : o.error.slice(0, 200)}`);
  return entry;
}
const call = (method, args, deposit = 0n, gas = 300_000_000_000_000n) =>
  [actionCreators.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit)];
const view = async (method, args = {}) => provider.callFunction(CONTRACT, method, args);

const now = Date.now();
const recoveryDelay = Number(RECOVERY_MS ?? 3 * 24 * 3600 * 1000);
const config = {
  mpc_contract_id: MPC,
  intents_contract: "intents.near",
  cohorts: [fx.cohort],
  approved_measurements: [],
  approved_ppids: [],
  attestation_expiry_ms: String(7 * 24 * 3600 * 1000),
  statement_max_age_ms: String(3600 * 1000),
  recovery_delay_ms: String(recoveryDelay),
  eject_min_gas_limit: "300000",
  eject_max_gas_limit: "3000000",
  eject_max_fee_per_gas: "50000000000",
  dev_mode: true,
  dev_agents: [],
};
// The attestation shade-agent-js sends in local mode (attestationForContract(getFakeAttestation())).
const fakeAttestation = {
  quote: [],
  collateral: { pck_crl_issuer_chain: "", root_ca_crl: "", pck_crl: "", tcb_info_issuer_chain: "", tcb_info: "", tcb_info_signature: "", qe_identity_issuer_chain: "", qe_identity: "", qe_identity_signature: "" },
  tcb_info: { mrtd: "0".repeat(96), rtmr0: "0".repeat(96), rtmr1: "0".repeat(96), rtmr2: "0".repeat(96), rtmr3: "0".repeat(96), os_image_hash: "", compose_hash: "0".repeat(64), device_id: "0".repeat(64), app_compose: "", event_log: [] },
};

// 0. fund the agent (implicit account is created by the transfer)
await step("fund agent 2 NEAR", funder, AGENT, [actionCreators.transfer(2_000_000_000_000_000_000_000_000n)]);
await step("fund contract 3 NEAR", funder, CONTRACT, [actionCreators.transfer(3_000_000_000_000_000_000_000_000n)]);

// 1. deploy and init
await step("deploy + new(config)", contract, CONTRACT, [
  actionCreators.deployContract(wasm),
  actionCreators.functionCall("new", Buffer.from(JSON.stringify({ config })), 100_000_000_000_000n, 0n),
]);

// 2. agent registration (refusal first: not whitelisted)
await step("register_agent before whitelist (refused)", agent, CONTRACT, call("register_agent", { attestation: fakeAttestation }, 5_000_000_000_000_000_000_000n), true);
await step("whitelist_agent_dev", contract, CONTRACT, call("whitelist_agent_dev", { account_id: AGENT }));
await step("whitelist_agent_dev by a stranger (refused)", funder, CONTRACT, call("whitelist_agent_dev", { account_id: FUNDER }), true);
console.log("get_agent before:", JSON.stringify(await view("get_agent", { account_id: AGENT })));
await step("register_agent (0.005 NEAR, adds intents key)", agent, CONTRACT, call("register_agent", { attestation: fakeAttestation }, 5_000_000_000_000_000_000_000n));
console.log("get_agent after:", JSON.stringify(await view("get_agent", { account_id: AGENT })).slice(0, 200));

// 3. statements
const stmt = { ...fx.statement, timestamp_ms: String(Date.now() - 5000) };
await step("submit_statement by unregistered account (refused)", funder, CONTRACT, call("submit_statement", { stmt }), true);
await step("submit_statement batch 1", agent, CONTRACT, call("submit_statement", { stmt }));
await step("submit_statement batch 1 again (refused, non increasing)", agent, CONTRACT, call("submit_statement", { stmt }), true);
const over = { ...stmt, batch_id: "2", collateral_value_loan: String(BigInt(stmt.total_debt) * 2n - 1n) };
await step("submit_statement over ceiling (refused)", agent, CONTRACT, call("submit_statement", { stmt: over }), true);
const stale = { ...stmt, batch_id: "2", timestamp_ms: String(Date.now() - 2 * 3600 * 1000) };
await step("submit_statement stale (refused)", agent, CONTRACT, call("submit_statement", { stmt: stale }), true);

// 4. agent signature through MPC
const payload = fx.expected.payload_hash;
await step("request_signature by unregistered account (refused)", funder, CONTRACT, call("request_signature", { cohort_id: fx.cohort.id, payload_hex: payload }), true);
const sig = await step("request_signature (real MPC)", agent, CONTRACT, call("request_signature", { cohort_id: fx.cohort.id, payload_hex: payload }));

// 5. eject (permissionless; funder acts as a relayer). With a short recovery delay it runs after recover().
const ejectArgs = { cohort_id: fx.cohort.id, leaf: fx.leaf, proof: fx.proof, eject_args: fx.eject_args };
const preview = await view("eject_tx_preview", ejectArgs);
console.log("eject_tx_preview payload:", preview.payload_hash, preview.payload_hash === fx.expected.payload_hash ? "(matches viem)" : "(MISMATCH)");
const shortRecovery = recoveryDelay < 10 * 60 * 1000;
let ej = null;
async function ejectFlow(label) {
  const badProof = { ...ejectArgs, proof: { ...fx.proof, index: 1 } };
  await step(`eject with wrong proof (refused)${label}`, funder, CONTRACT, call("eject", badProof), true);
  ej = await step(`eject (real MPC signature)${label}`, funder, CONTRACT, call("eject", ejectArgs));
  await step(`eject same leaf again (refused)${label}`, funder, CONTRACT, call("eject", ejectArgs), true);
}
if (!shortRecovery) await ejectFlow("");
await step("recover while agent active (refused)", funder, CONTRACT, call("recover", {}), true);

if (shortRecovery) {
  const wait = recoveryDelay + 5000;
  console.log(`waiting ${wait} ms for recovery delay...`);
  await new Promise((r) => setTimeout(r, wait));
  await step("recover (removes agent intents keys)", funder, CONTRACT, call("recover", {}));
  console.log("mode:", await view("mode"));
  await step("request_signature in recovery (refused)", agent, CONTRACT, call("request_signature", { cohort_id: fx.cohort.id, payload_hex: payload }), true);
  await step("register_agent in recovery (refused)", agent, CONTRACT, call("register_agent", { attestation: fakeAttestation }), true);
  await ejectFlow(" in recovery mode");
}

// 6. check the signatures recover to the cohort address derived for this contract
const evm = new chainAdapters.evm.EVM({
  publicClient: createPublicClient({ chain: base, transport: http("https://mainnet.base.org") }),
  contract: new contracts.ChainSignatureContract({ networkId: "testnet", contractId: MPC }),
});
const { address: cohortAddress } = await evm.deriveAddressAndPublicKey(CONTRACT, `cohort:${fx.cohort.id}`);
let recovered = null;
if (ej.ok && ej.value?.signed_tx) recovered = await recoverTransactionAddress({ serializedTransaction: ej.value.signed_tx });
console.log("cohort address", cohortAddress, "eject tx signer", recovered, recovered?.toLowerCase() === cohortAddress.toLowerCase() ? "(match)" : "(MISMATCH)");

const result = {
  contract: CONTRACT, agent: AGENT, funder: FUNDER, mpc: MPC, recovery_delay_ms: recoveryDelay, started_ms: now,
  cohort_address: cohortAddress, eject_signer_recovered: recovered, request_signature_result: sig.value,
  eject_preview: preview, steps: log,
};
fs.writeFileSync(path.join(here, `${CONTRACT}.run.json`), JSON.stringify(result, null, 2) + "\n");

console.log("done");
