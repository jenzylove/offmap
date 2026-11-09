import fs from "node:fs";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { actionCreators } from "@near-js/transactions";
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
  /** TEE only: wait until the agent account holds NEAR, then register with offmap.near using a real attestation. */
  register?: () => Promise<void>;
  /** TEE only: the dstack attestation (quote, tcb info, event log) bound to this agent account. */
  attestation?: () => Promise<unknown>;
  /** Registration state, shown on /health so a failure is never invisible. */
  registration: { status: "not_needed" | "waiting_for_funds" | "registering" | "registered" | "failed"; error?: string; at?: number };
}

/** Rotates to the next NEAR RPC only on transport trouble (rate limits, 5xx, timeouts); contract errors pass through untouched. */
class RotatingRpcProvider extends JsonRpcProvider {
  constructor(private urls: string[]) { super({ url: urls[0]! }); }
  async sendJsonRpc<T>(method: string, params: object): Promise<T> {
    let last: unknown;
    for (const url of this.urls) {
      (this as any).connection = { url };
      try { return await super.sendJsonRpc<T>(method, params); }
      catch (e) {
        const m = String((e as any)?.message ?? e);
        if (!/429|Rate limit|rate limit|50[0-9]|ETIMEDOUT|ECONNRESET|fetch failed|timeout|discontinued|Too Many/i.test(m)) throw e;
        last = e;
      }
    }
    throw last;
  }
}
const provider = () => new RotatingRpcProvider([config.nearRpc, ...config.nearRpcFallbacks]);

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
    registration: { status: "not_needed" },
  };
}

async function teeIdentity(): Promise<Identity> {
  if (!config.contractId) throw new Error("TEE mode needs OFFMAP_CONTRACT");
  const client = await ShadeClient.create({ networkId: config.network, agentContractId: config.contractId, rpc: provider() as any });
  // A stable agent key: derived from dstack's key service, so it is the same for this app across compose
  // updates (the account and its NEAR survive) and still only exists inside the TEE. The attestation that
  // registers it is real: ShadeClient quotes over whichever account id it holds.
  const { DstackClient } = await import("@phala/dstack-sdk");
  const seed = Buffer.from((await new DstackClient().getKey("offmap/agent-ed25519", "offmap")).key).subarray(0, 32);
  const { ed25519 } = await import("@noble/curves/ed25519");
  const pub = Buffer.from(ed25519.getPublicKey(seed));
  const kp = KeyPair.fromString(("ed25519:" + bs58.encode(Buffer.concat([seed, pub]))) as KeyPairString);
  const accountId = pub.toString("hex");
  (client as any).agentAccountId = accountId;
  (client as any).agentPrivateKeys = [kp.toString()];
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
    attestation: () => client.getAttestation(),
    registration: { status: "waiting_for_funds" },
    register: async function (this: Identity) {
      const reg = this.registration;
      // Retry forever with backoff; every failure is recorded and served on /health.
      for (let attempt = 0; ; attempt++) {
        try {
          if ((await client.balance()) < 0.05) {
            reg.status = "waiting_for_funds"; reg.at = Date.now();
            await new Promise((r) => setTimeout(r, 30_000));
            continue;
          }
          reg.status = "registering"; reg.at = Date.now();
          await client.register();
          reg.status = "registered"; reg.error = undefined; reg.at = Date.now();
          console.log("registered with", config.contractId);
          // Keep enough NEAR for gas and send the rest back to the contract it came from, so NEAR never
          // piles up on an agent account. (2.1 NEAR was stranded on earlier random key agents.)
          const bal = await client.balance();
          if (bal > KEEP_NEAR + 0.05) {
            const amount = BigInt(Math.floor((bal - KEEP_NEAR) * 1e6)) * 10n ** 18n;
            await new Account(accountId, provider(), new KeyPairSigner(kp)).signAndSendTransaction({ receiverId: config.contractId, actions: [actionCreators.transfer(amount)] })
              .then(() => console.log("returned", (bal - KEEP_NEAR).toFixed(3), "NEAR to", config.contractId))
              .catch((e) => { reg.error = `surplus return: ${String(e?.message ?? e)}`; });
          }
          setInterval(() => client.register().catch((e) => { reg.error = `re-register: ${String(e?.message ?? e)}`; }), 6 * 24 * 3600e3);
          return;
        } catch (e: any) {
          reg.status = "failed"; reg.error = String(e?.message ?? e).slice(0, 600); reg.at = Date.now();
          console.error("register attempt", attempt, reg.error);
          await new Promise((r) => setTimeout(r, Math.min(300_000, 15_000 * (attempt + 1))));
        }
      }
    },
  };
}

/** NEAR an agent keeps for gas: each 300 Tgas call needs about 0.31 NEAR available. */
const KEEP_NEAR = 0.45;

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();
