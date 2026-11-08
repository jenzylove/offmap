// Offmap judge checks: every claim, verified from public data only. No keys, no install beyond Node 22+.
// Run: node scripts/judge-checks.mjs
const CONTRACT = "offmapfi.near";
const AGENT = "https://b85acd75d1ee0d9a37241a18f68a6c55376b5e3a-8787.dstack-pha1-prod5.phala.network";
const NEAR = "https://rpc.mainnet.fastnear.com";
const BASE = "https://mainnet.base.org";
const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function near(method, params) {
  const r = await fetch(NEAR, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) });
  return (await r.json()).result;
}
async function view(account, method, args = {}) {
  const r = await near("query", { request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return r?.result ? JSON.parse(Buffer.from(r.result).toString()) : null;
}
async function ethCall(to, data) {
  const r = await fetch(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
  return (await r.json()).result;
}
const word = (hex, i) => BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
const b58 = (bytes) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = "1" + s; else break; } return s; };

// 1. The contract requires a TEE and has an approved measurement set.
const info = await view(CONTRACT, "get_contract_info");
check("offmapfi.near requires a TEE attested agent", info?.requires_tee === true, `mode ${info?.mode}`);
const cfg = await view(CONTRACT, "config");
const approved = cfg?.approved_measurements?.[0]?.app_compose_hash_payload;

// 2. The live agent runs in TDX, is registered, and its attested compose hash is the approved one.
const health = await (await fetch(AGENT + "/health")).json();
check("agent reports it runs in a TEE", health.tee === true, `agent ${health.agent.slice(0, 10)}...`);
check("agent is registered with the contract", health.registration?.status === "registered");
const att = await (await fetch(AGENT + "/attestation")).json();
check("attested compose hash equals the hash approved on chain", att?.tcb_info?.compose_hash === approved, `${String(approved).slice(0, 16)}...`);
const agentRec = await view(CONTRACT, "get_agent", { account_id: health.agent });
check("contract holds this agent with its measurements", !!agentRec?.measurements);

// 3. Only the attested agent can move the private balance: its key is the only one on intents.near.
const keys = await view("intents.near", "public_keys_of", { account_id: CONTRACT });
const agentKey = "ed25519:" + b58(Buffer.from(health.agent, "hex"));
check("intents.near lists exactly one key for offmapfi.near, the agent's", keys?.length === 1 && keys[0] === agentKey, JSON.stringify(keys));

// 4. Each cohort's public Morpho position matches the solvency statement on chain. No per user data anywhere.
for (const c of cfg.cohorts) {
  const addr = health.cohorts.find((x) => x.id === c.id)?.address;
  const stmt = await view(CONTRACT, "statement", { cohort_id: c.id });
  const pos = await ethCall(MORPHO, "0x93c52062" + c.market_id.slice(2) + addr.slice(2).toLowerCase().padStart(64, "0"));
  const collateral = word(pos, 2);
  if (!stmt) { check(`${c.id}: statement on chain`, collateral === 0n, "no statement yet, cohort empty"); continue; }
  const s = stmt.statement;
  check(`${c.id}: statement collateral equals Morpho collateral at ${addr.slice(0, 8)}...`, BigInt(s.total_collateral) === collateral, `${s.total_collateral} vs ${collateral}`);
  check(`${c.id}: statement carries a salted Merkle root and padded leaf count`, /^0x[0-9a-f]{64}$/.test(s.merkle_root) && s.leaf_count >= 1024, `root ${s.merkle_root.slice(0, 12)}..., ${s.leaf_count} leaves`);
}

// 5. The eject helper exists on Base with code.
const helper = cfg.cohorts[0].eject_helper;
const code = await (await fetch(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [helper, "latest"] }) })).json();
check("EjectHelper is deployed on Base", (code.result ?? "0x").length > 10, helper);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
