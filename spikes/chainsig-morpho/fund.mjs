import { account, accountId, baseAddress } from "./lib.mjs";
const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const to = await baseAddress();
const deadline = new Date(Date.now() + 3 * 3600e3).toISOString();
async function quote(destinationAsset, amount) {
  const r = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: `nep141:${USDC_NEAR}`,
      depositType: "ORIGIN_CHAIN", destinationAsset, amount, refundTo: accountId, refundType: "ORIGIN_CHAIN",
      recipient: to, recipientType: "DESTINATION_CHAIN", deadline }),
  });
  const j = await r.json();
  if (!j.quote) throw new Error(JSON.stringify(j));
  return j.quote;
}
async function send(q) {
  const dep = q.depositAddress;
  const sb = await account.provider.callFunction(USDC_NEAR, "storage_balance_of", { account_id: dep });
  if (!sb) await account.callFunction({ contractId: USDC_NEAR, methodName: "storage_deposit", args: { account_id: dep, registration_only: true }, deposit: 1_250_000_000_000_000_000_000n, gas: 30_000_000_000_000n });
  const out = await account.signAndSendTransaction({ receiverId: USDC_NEAR, actions: [
    (await import("@near-js/transactions")).actionCreators.functionCall("ft_transfer", { receiver_id: dep, amount: q.amountIn }, 30_000_000_000_000n, 1n)] });
  return { dep, tx: out.transaction.hash, out: q.amountOutFormatted };
}
const gas = await quote("nep141:base.omft.near", "2500000");
const coll = await quote("nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", "5000000");
console.log("eth", JSON.stringify(await send(gas)));
console.log("cbbtc", JSON.stringify(await send(coll)));
