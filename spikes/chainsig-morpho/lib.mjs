import { chainAdapters, contracts } from "chainsig.js";
import { KeyPair } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".near-credentials", "implicit");
const cred = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".json"))), "utf8"));
export const accountId = cred.implicit_account_id;
export const PATH = "offmap-spike-base-1";
const provider = new JsonRpcProvider({ url: "https://rpc.mainnet.fastnear.com" });
export const account = new Account(accountId, provider, new KeyPairSigner(KeyPair.fromString(cred.private_key)));

export const contract = new contracts.ChainSignatureContract({ networkId: "mainnet", contractId: "v1.signer" });
export const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
export const evm = new chainAdapters.evm.EVM({ publicClient, contract });

export async function baseAddress() {
  const { address } = await evm.deriveAddressAndPublicKey(accountId, PATH);
  return address;
}

/** Ask NEAR's MPC network (v1.signer) to sign a 32 byte hash for our derived key. Returns {r,s,v}. */
export async function mpcSign(hashBytes) {
  const hex = Buffer.from(hashBytes).toString("hex");
  const res = await account.callFunction({
    contractId: "v1.signer",
    methodName: "sign",
    args: { request: { payload_v2: { Ecdsa: hex }, path: PATH, domain_id: 0 } },
    deposit: 1n,
    gas: 300_000_000_000_000n,
  });
  const r = res.big_r.affine_point.slice(2);
  const s = res.s.scalar;
  return { r, s, v: res.recovery_id + 27 };
}

/** Prepare, MPC sign, and broadcast an EVM tx from the derived Base address. */
export async function sendFromDerived(tx) {
  const from = await baseAddress();
  const { transaction, hashesToSign } = await evm.prepareTransactionForSigning({ from, ...tx });
  const sig = await mpcSign(hashesToSign[0]);
  const signed = evm.finalizeTransactionSigning({ transaction, rsvSignatures: [sig] });
  const { hash } = await evm.broadcastTx(signed);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
