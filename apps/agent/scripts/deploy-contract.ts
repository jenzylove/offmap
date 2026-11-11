// Deploys offmap.near on NEAR mainnet: create the account from the build account, deploy the wasm, call new(config).
// The account keeps one full access key until the owner decides to delete it (that choice is irreversible).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { COHORTS, USDC_BASE } from "../src/config.js";
import { marketParams } from "../src/base.js";

const CONTRACT = "offmapfi.near";
const HELPER = "0x262fe96b235be762dca8cc1937a542848e12f8b8";
const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const kp = KeyPair.fromString(cred.private_key as KeyPairString);
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" });
const builder = new Account(cred.implicit_account_id, provider, new KeyPairSigner(kp));
// The contract account holds only a restricted key now (owner methods only); use it when present.
const restrictedFile = path.join(os.homedir(), ".offmap-secrets", "offmapfi-restricted.json");
const contractKey = fs.existsSync(restrictedFile) ? KeyPair.fromString(JSON.parse(fs.readFileSync(restrictedFile, "utf8")).private_key) : kp;
const contract = new Account(CONTRACT, provider, new KeyPairSigner(contractKey));

const m = JSON.parse(fs.readFileSync("../../contracts/near/deploy/measurements.json", "utf8"));
// --keep-current also keeps the measurements approved on chain now, so the running agent stays valid until it is replaced.
const live: any = await provider.query({ request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: "config", args_base64: Buffer.from("{}").toString("base64") } as any);
const liveMeasurements: any[] = JSON.parse(Buffer.from(live.result).toString()).approved_measurements ?? [];
const sameM = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const drop = (process.env.DROP_HASH ?? "").toLowerCase();
const approved = process.argv.includes("--keep-current") ? [...liveMeasurements.filter((x) => !sameM(x, m.measurements) && !(drop && String(x.app_compose_hash_payload).toLowerCase().startsWith(drop))), m.measurements] : [m.measurements];
const cohorts = [];
for (const c of COHORTS) {
  const p = await marketParams(c);
  cohorts.push({ id: c.id, market_id: c.marketId, loan_token: USDC_BASE, collateral_token: c.collateralToken, oracle: p.oracle, irm: p.irm,
    lltv: p.lltv.toString(), base_chain_id: 8453, eject_helper: HELPER, size_cap_loan: c.sizeCapLoan.toString(), ceiling_bps: Number(c.cohortCeilingBps) });
}
const config = {
  mpc_contract_id: "v1.signer", intents_contract: "intents.near", cohorts,
  approved_measurements: approved, approved_ppids: m.ppids.filter((p: string) => p && p.length === 32),
  attestation_expiry_ms: String(7 * 24 * 3600e3), statement_max_age_ms: String(30 * 60e3), recovery_delay_ms: String(3 * 24 * 3600e3),
  eject_min_gas_limit: "300000", eject_max_gas_limit: "3000000", eject_max_fee_per_gas: "50000000000", dev_mode: false, dev_agents: [],
};
fs.writeFileSync("../../contracts/near/deploy/mainnet-config.json", JSON.stringify(config, null, 2));
const wasm = fs.readFileSync("../../contracts/near/target/near/offmap.opt.wasm");
console.log("wasm", wasm.length, "bytes; ppids", config.approved_ppids.length);

if (process.argv.includes("--dry")) process.exit(0);
if (process.argv.includes("--code-only")) {
  const r = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [actionCreators.deployContract(wasm)] });
  console.log("code updated", r.transaction.hash, JSON.stringify(r.status).slice(0, 120));
  process.exit(0);
}
if (process.argv.includes("--set-config-legacy")) {
  // Only for the contract version before the timelock (set_config was removed in it).
  const r = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [actionCreators.functionCall("set_config", Buffer.from(JSON.stringify({ config })), 30_000_000_000_000n, 0n)] });
  console.log("set_config", r.transaction.hash, JSON.stringify(r.status).slice(0, 160));
  process.exit(0);
}
if (process.argv.includes("--propose-config")) {
  // Config changes are public first: anyone can apply this one after the contract's 24h notice period.
  const r = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [actionCreators.functionCall("propose_config", Buffer.from(JSON.stringify({ config })), 30_000_000_000_000n, 0n)] });
  console.log("propose_config", r.transaction.hash, JSON.stringify(r.status).slice(0, 160));
  process.exit(0);
}
if (process.argv.includes("--apply-config")) {
  const r = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [actionCreators.functionCall("apply_config", Buffer.from("{}"), 30_000_000_000_000n, 0n)] });
  console.log("apply_config", r.transaction.hash, JSON.stringify(r.status).slice(0, 160));
  process.exit(0);
}
if (process.argv.includes("--recreate")) throw new Error("never delete a named account: snipers take it (see memory)");
if (process.argv.includes("--recreate")) {
  // Deleting returns the storage NEAR to the build account; the account is created again below.
  const del = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [actionCreators.deleteAccount(cred.implicit_account_id)] });
  console.log("deleted", CONTRACT, del.transaction.hash);
}
const exists = await provider.query({ request_type: "view_account", finality: "final", account_id: CONTRACT }).then(() => true, () => false);
if (!exists) {
  const r = await builder.callFunction({ contractId: "near", methodName: "create_account", args: { new_account_id: CONTRACT, new_public_key: kp.getPublicKey().toString() },
    deposit: 8_700_000_000_000_000_000_000_000n, gas: 100_000_000_000_000n });
  console.log("created", CONTRACT, r);
}
const out = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [
  actionCreators.deployContract(wasm),
  actionCreators.functionCall("new", Buffer.from(JSON.stringify({ config })), 30_000_000_000_000n, 0n),
] });
console.log("deploy + new", out.transaction.hash, JSON.stringify(out.status).slice(0, 200));
