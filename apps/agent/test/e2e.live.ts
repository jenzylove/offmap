// Live end to end borrow against the running agent (dev mode, mainnet, small amounts).
// npx tsx test/e2e.live.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";

const AGENT = "http://localhost:8787";
const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_BASE_ID = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

const keyFile = path.join(os.tmpdir(), "offmap-e2e-user.key");
const pk = (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : (fs.writeFileSync(keyFile, generatePrivateKey()), fs.readFileSync(keyFile, "utf8").trim())) as `0x${string}`;
const user = privateKeyToAccount(pk);
console.log("user wallet", user.address);

const post = async (p: string, body: object, token?: string) => {
  const r = await fetch(AGENT + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${JSON.stringify(j)}`);
  return j;
};

const nonce = crypto.randomUUID();
const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
const signature = await user.signMessage({ message: `offmap:auth:${nonce}:${deadline}` });
const { token } = await post("/auth", { address: user.address, nonce, deadline, signature });

const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))!), "utf8"));
const funder = new Account(cred.implicit_account_id, new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" }), new KeyPairSigner(KeyPair.fromString(cred.private_key as KeyPairString)));

const q = await post("/quote/borrow", {
  cohort: "cbbtc-usdc", depositAsset: `nep141:${USDC_NEAR}`, depositAmount: "1400000", borrowUsdc: "500000",
  receiveAsset: USDC_BASE_ID, receiveAddress: user.address, refundTo: cred.implicit_account_id,
}, token);
console.log("borrow quote", q);

const sb = await funder.provider.callFunction(USDC_NEAR, "storage_balance_of", { account_id: q.depositAddress });
if (!sb) await funder.callFunction({ contractId: USDC_NEAR, methodName: "storage_deposit", args: { account_id: q.depositAddress, registration_only: true }, deposit: 1_250_000_000_000_000_000_000n, gas: 30_000_000_000_000n });
const t = await funder.signAndSendTransaction({ receiverId: USDC_NEAR, actions: [actionCreators.functionCall("ft_transfer", { receiver_id: q.depositAddress, amount: q.amountIn }, 30_000_000_000_000n, 1n)] });
console.log("deposit sent", t.transaction.hash);
fs.writeFileSync(path.join(os.tmpdir(), "offmap-e2e-token.txt"), token);
