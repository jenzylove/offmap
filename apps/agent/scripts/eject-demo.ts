// Runs a real eject for the demo wallet, the same path the /eject page takes: note from the agent,
// Morpho grant and revoke signed by the wallet, offmapfi.near verifies the leaf and MPC signs, broadcast to Base.
// Run from apps/agent: npx tsx scripts/eject-demo.ts [--go]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicClient, http, parseAbi, recoverTransactionAddress, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { parseNote } from "../../web/src/lib/notes";
import { AUTH_TYPES, assembleSigned, buildEjectArgs, morphoDomain, splitSig, type Authorization, type ContractConfigWire, type StoredStatementWire } from "../../web/src/lib/eject";

const AGENT = "https://b85acd75d1ee0d9a37241a18f68a6c55376b5e3a-8787.dstack-pha1-prod5.phala.network";
const CONTRACT = "offmapfi.near";
const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as Address;
const NEAR_RPC = "https://rpc.mainnet.fastnear.com";
const secrets = path.join(os.homedir(), ".offmap-secrets");
const key = fs.readFileSync(path.join(secrets, "demo-user.key"), "utf8").trim();
const wallet = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const token = fs.readFileSync(path.join(secrets, "demo-user.token"), "utf8").trim();
const baseClient = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const provider = new JsonRpcProvider({ url: NEAR_RPC });
const view = async <T>(method: string, args: object = {}): Promise<T> => (await provider.callFunction(CONTRACT, method, args as Record<string, unknown>)) as T;

const pos: any = await (await fetch(`${AGENT}/position`, { headers: { authorization: `Bearer ${token}` } })).json();
const entry = (pos.positions ?? pos).find?.((p: any) => p.cohort === "cbbtc-usdc" && p.note);
if (!entry) throw new Error("no note for cbbtc-usdc: " + JSON.stringify(pos).slice(0, 200));
const note = parseNote(entry.note);
const cfg = await view<ContractConfigWire>("config");
const cohort = cfg.cohorts.find((c) => c.id === "cbbtc-usdc")!;
const stored = await view<StoredStatementWire>("statement", { cohort_id: "cbbtc-usdc" });
const health: any = await (await fetch(`${AGENT}/health`)).json();
const cohortAddress = health.cohorts.find((c: any) => c.id === "cbbtc-usdc").address as Address;
console.log("note batch", note.batchId, "collateral", note.collateral.toString(), "debt", note.debt.toString(), "statement batch", stored.statement.batch_id);

// Eject tx params, sent from the cohort address, inside the contract's bounds.
const [nonce, block, prio] = await Promise.all([
  baseClient.getTransactionCount({ address: cohortAddress, blockTag: "latest" }),
  baseClient.getBlock(),
  baseClient.estimateMaxPriorityFeePerGas().catch(() => 1_000_000n),
]);
const cap = BigInt(cfg.eject_max_fee_per_gas);
let maxFee = (block.baseFeePerGas ?? 0n) * 3n + prio;
if (maxFee > cap) maxFee = cap;
const tx = { nonce: BigInt(nonce), maxFeePerGas: maxFee, maxPriorityFeePerGas: prio > maxFee ? maxFee : prio, gasLimit: 900_000n };

// The wallet's one time Morpho authorization of the helper, and its revocation.
const mNonce = await baseClient.readContract({ address: MORPHO, abi: parseAbi(["function nonce(address) view returns (uint256)"]), functionName: "nonce", args: [wallet.address] });
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 86400);
const helper = cohort.eject_helper as Address;
const domain = morphoDomain(base.id, MORPHO);
const grant: Authorization = { authorizer: wallet.address, authorized: helper, isAuthorized: true, nonce: mNonce, deadline };
const revoke: Authorization = { authorizer: wallet.address, authorized: helper, isAuthorized: false, nonce: mNonce + 1n, deadline };
const grantSig = splitSig(await wallet.signTypedData({ domain, types: AUTH_TYPES, primaryType: "Authorization", message: grant }));
const revokeSig = splitSig(await wallet.signTypedData({ domain, types: AUTH_TYPES, primaryType: "Authorization", message: revoke }));
const args = buildEjectArgs({ cohortId: "cbbtc-usdc", note, user: wallet.address.toLowerCase(), statement: stored.statement, grant, grantSig, revoke, revokeSig, tx });

const preview = await view<any>("eject_tx_preview", { ...args, as_account: null });
console.log("contract preview ok, leaf", preview.leaf_hash.slice(0, 18));
if (!process.argv.includes("--go")) { console.log("dry run: nothing sent"); process.exit(0); }

const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const caller = new Account(cred.implicit_account_id, provider, new KeyPairSigner(KeyPair.fromString(cred.private_key as KeyPairString)));
const res: any = await caller.signAndSendTransaction({ receiverId: CONTRACT, actions: [actionCreators.functionCall("eject", Buffer.from(JSON.stringify(args)), BigInt(process.env.EJECT_TGAS ?? "100") * 1_000_000_000_000n, 20_000_000_000_000_000_000_000n)] });
console.log("NEAR eject tx", res.transaction.hash);
const ok = res.status?.SuccessValue;
const outcome = JSON.parse(Buffer.from(ok, "base64").toString());
if (!outcome.signature) throw new Error("MPC did not sign; the contract released the leaf");
const signed = assembleSigned(cohort, args, outcome.signature) as Hex;
const from = await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` });
if (from.toLowerCase() !== cohortAddress.toLowerCase()) throw new Error(`signed by ${from}, not the cohort`);
const hash = await baseClient.sendRawTransaction({ serializedTransaction: signed }).catch(async (e) => {
  if (/already known|nonce too low/i.test(String(e))) return (await import("viem")).keccak256(signed);
  throw e;
});
const rc = await baseClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
console.log("Base eject tx", hash, rc.status);
