import fs from "node:fs";
import os from "node:os";
import { encodeFunctionData, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sendFromDerived, baseAddress } from "./lib.mjs";
const AGENT = "https://b85acd75d1ee0d9a37241a18f68a6c55376b5e3a-8787.dstack-pha1-prod5.phala.network";
const kf = os.homedir() + "/.offmap-secrets/demo-user.key";
if (!fs.existsSync(kf)) fs.writeFileSync(kf, generatePrivateKey(), { mode: 0o600 });
const user = privateKeyToAccount(fs.readFileSync(kf, "utf8").trim());
const post = async (p, b, t) => { const r = await fetch(AGENT + p, { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(p + " " + JSON.stringify(j)); return j; };
const nonce = crypto.randomUUID(), deadline = new Date(Date.now() + 600e3).toISOString();
const { token } = await post("/auth", { address: user.address, nonce, deadline, signature: await user.signMessage({ message: `offmap:auth:${nonce}:${deadline}` }) });
fs.writeFileSync(os.homedir() + "/.offmap-secrets/demo-user.token", token, { mode: 0o600 });
const spike = await baseAddress();
const q = await post("/quote/borrow", { cohort: "cbbtc-usdc", depositAsset: "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", depositAmount: "6300", borrowUsdc: "1500000",
  receiveAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", receiveAddress: user.address, refundTo: spike }, token);
console.log("demo user", user.address, "quote", JSON.stringify(q));
const tx = await sendFromDerived({ to: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", data: encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [q.depositAddress, 6300n] }) });
console.log("deposit sent", tx);
