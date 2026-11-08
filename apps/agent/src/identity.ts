import fs from "node:fs";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { ShadeClient } from "@neardefi/shade-agent-js";
import { config } from "./config.js";

/**
 * Who the agent is. In the TEE the key comes from shade-agent-js (random, attested) and every
 * chain signature goes through offmap.near, which only signs for a registered agent.
 * In dev (no contract yet) a local key stands in and signs directly with v1.signer.
 */
export interface Identity {
  /** The agent's own NEAR account (ephemeral implicit account in the TEE). */
  accountId: string;
  /** Owner of the confidential Intents balance: offmap.near in production, the dev account otherwise. */
  intentsSigner: string;
  publicKey: string;
  /** ed25519 signature over a 32 byte hash, base58 with prefix. */
  signHash(hash: Uint8Array): string;
  /** MPC signature for one cohort's Base address. Returns r, s (hex) and v (27 or 28). */
  mpcSign(cohortId: string, hash: Uint8Array): Promise<{ r: string; s: string; v: number }>;
  /** Call a method on offmap.near as the agent. */
  callContract(method: string, args: object, gas?: bigint, deposit?: bigint): Promise<unknown>;
  viewContract(method: string, args: object): Promise<unknown>;
  /** NEAR account that the MPC derives cohort addresses from. */
  mpcPredecessor: string;
  tee: boolean;
}

const provider = () => new JsonRpcProvider({ url: config.nearRpc });

function toRsv(res: any) {
  return { r: res.big_r.affine_point.slice(2), s: res.s.scalar, v: res.recovery_id + 27 };
}

export async function loadIdentity(): Promise<Identity> {
  if (config.devKeyFile) return devIdentity();
  return teeIdentity();
}

function devIdentity(): Identity {
  const cred = JSON.parse(fs.readFileSync(config.devKeyFile, "utf8"));
  const accountId: string = cred.implicit_account_id ?? cred.account_id;
  const kp = KeyPair.fromString(cred.private_key as KeyPairString);
  const account = new Account(accountId, provider(), new KeyPairSigner(kp));
  const contract = config.contractId;
  return {
    accountId,
    intentsSigner: contract || accountId,
    publicKey: kp.getPublicKey().toString(),
    signHash: (hash) => "ed25519:" + bs58.encode(Buffer.from(kp.sign(hash).signature)),
    mpcSign: async (cohortId, hash) => {
      if (contract) {
        const res = await account.callFunction({ contractId: contract, methodName: "request_signature", args: { cohort_id: cohortId, payload_hex: Buffer.from(hash).toString("hex") }, gas: 300_000_000_000_000n });
        return toRsv(res);
      }
      const res = await account.callFunction({ contractId: config.mpcContract, methodName: "sign", args: { request: { payload_v2: { Ecdsa: Buffer.from(hash).toString("hex") }, path: `cohort:${cohortId}`, domain_id: 0 } }, deposit: 1n, gas: 300_000_000_000_000n });
      return toRsv(res);
    },
    callContract: (method, args, gas = 100_000_000_000_000n, deposit = 0n) => account.callFunction({ contractId: contract, methodName: method, args, gas, deposit }),
    viewContract: (method, args) => provider().callFunction(contract, method, args as Record<string, unknown>),
    mpcPredecessor: contract || accountId,
    tee: false,
  };
}

async function teeIdentity(): Promise<Identity> {
  if (!config.contractId) throw new Error("TEE mode needs OFFMAP_CONTRACT");
  const client = await ShadeClient.create({ networkId: config.network, agentContractId: config.contractId });
  const accountId = client.accountId();
  const keys = await client.getPrivateKeys({ acknowledgeRisk: true });
  const kp = KeyPair.fromString(keys[0] as KeyPairString);
  return {
    accountId,
    intentsSigner: config.contractId,
    publicKey: kp.getPublicKey().toString(),
    signHash: (hash) => "ed25519:" + bs58.encode(Buffer.from(kp.sign(hash).signature)),
    mpcSign: async (cohortId, hash) =>
      toRsv(await client.call({ methodName: "request_signature", args: { cohort_id: cohortId, payload_hex: Buffer.from(hash).toString("hex") }, gas: 300_000_000_000_000n })),
    callContract: (method, args, gas = 100_000_000_000_000n, deposit = 0n) => client.call({ methodName: method, args, gas, deposit } as any),
    viewContract: (method, args) => client.view({ methodName: method, args: args as Record<string, unknown> }),
    mpcPredecessor: config.contractId,
    tee: true,
  };
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();
