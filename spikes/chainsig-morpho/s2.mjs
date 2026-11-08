import { api, accountId, signNep413, userSession, confidentialBalances } from "./intents.mjs";
import { account } from "./lib.mjs";
import { actionCreators } from "@near-js/transactions";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import fs from "node:fs";

const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const dl = () => new Date(Date.now() + 3600e3).toISOString();
const wait = async (dep, label) => {
  for (let i = 0; i < 60; i++) {
    const s = await api(`/v0/status?depositAddress=${dep}`);
    if (["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(s.status)) { console.log(label, s.status, JSON.stringify(s.swapDetails?.destinationChainTxHashes ?? [])); return s; }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(label + " timed out");
};
const out = { accountId, steps: [] };

// 1. shield: USDC on NEAR -> our confidential Intents balance
const q1 = (await api("/v0/quote", { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: `nep141:${USDC_NEAR}`, depositType: "ORIGIN_CHAIN",
  destinationAsset: `nep141:${USDC_NEAR}`, amount: "3000000", refundTo: accountId, refundType: "ORIGIN_CHAIN", recipient: accountId, recipientType: "CONFIDENTIAL_INTENTS", deadline: dl() })).quote;
const sb = await account.provider.callFunction(USDC_NEAR, "storage_balance_of", { account_id: q1.depositAddress });
if (!sb) await account.callFunction({ contractId: USDC_NEAR, methodName: "storage_deposit", args: { account_id: q1.depositAddress, registration_only: true }, deposit: 1_250_000_000_000_000_000_000n, gas: 30_000_000_000_000n });
const t1 = await account.signAndSendTransaction({ receiverId: USDC_NEAR, actions: [actionCreators.functionCall("ft_transfer", { receiver_id: q1.depositAddress, amount: q1.amountIn }, 30_000_000_000_000n, 1n)] });
out.steps.push({ step: "shield 3 USDC into confidential balance", nearTx: t1.transaction.hash, deposit: q1.depositAddress });
await wait(q1.depositAddress, "shield");

let sess = await userSession();
const b1 = await confidentialBalances(sess.accessToken);
console.log("confidential balance after shield", JSON.stringify(b1));
out.steps.push({ step: "read private balance (owner session only)", balances: b1 });

// 2. pay out 1.5 USDC from the confidential balance to a brand new Base wallet
const fresh = privateKeyToAccount(generatePrivateKey()).address;
const q2 = (await api("/v0/quote", { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: `nep141:${USDC_NEAR}`, depositType: "CONFIDENTIAL_INTENTS",
  destinationAsset: USDC_BASE, amount: "1500000", refundTo: accountId, refundType: "CONFIDENTIAL_INTENTS", recipient: fresh, recipientType: "DESTINATION_CHAIN", deadline: dl() })).quote;
const gen = await api("/v0/generate-intent", { type: "swap_transfer", standard: "nep413", signerId: accountId, depositAddress: q2.depositAddress });
const signedData = signNep413(gen.intent.payload);
const sub = await api("/v0/submit-intent", { type: "swap_transfer", signedData });
out.steps.push({ step: "pay 1.5 USDC from private balance to fresh Base wallet", freshWallet: fresh, intentHash: sub.intentHash, deposit: q2.depositAddress, quotedOut: q2.amountOutFormatted });
const s2 = await wait(q2.depositAddress, "payout");
out.steps.at(-1).baseTx = s2.swapDetails?.destinationChainTxHashes;

sess = await userSession();
const b2 = await confidentialBalances(sess.accessToken);
console.log("confidential balance after payout", JSON.stringify(b2));
out.steps.push({ step: "private balance after payout", balances: b2 });
fs.writeFileSync("s2-result.json", JSON.stringify(out, null, 1));
