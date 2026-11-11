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
  registration: { status: "not_needed" | "waiting_for_funds" | "registering" | "registered" | "failed"; error?: string; at?: number; surplus?: string };
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
      toRsv(await client.call({ methodName: "request_signature", args: { cohort_id: cohortId, payload_hex: Buffer.from(hash).toString("hex") }, gas: SIGN_GAS })),
    callContract: (method, args, gas = CALL_GAS, deposit = 0n) => client.call({ methodName: method, args, gas, deposit } as any),
    viewContract: (method, args) => client.view({ methodName: method, args: args as Record<string, unknown> }),
    mpcPredecessor: config.contractId,
    tee: true,
    attestation: () => client.getAttestation(),
    registration: { status: "waiting_for_funds" },
    register: async function (this: Identity) {
      const reg = this.registration;
      // NEAR reserves a call's whole prepaid gas up front, so every call here prepays only what it uses.
      const rawBalance = async () => {
        const r = await fetch(config.nearRpc, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }) });
        const j: any = await r.json();
        if (!j?.result?.amount) throw new Error(`balance read failed: ${JSON.stringify(j?.error ?? j).slice(0, 200)}`);
        return Number(BigInt(j.result.amount) / 10n ** 18n) / 1e6;
      };
      // Registration verifies a TDX quote on chain (about 184 Tgas, 0.018 NEAR): only when needed.
      const ownRecord = async () => {
        const agents = ((await client.view({ methodName: "get_agents", args: {} })) ?? []) as any[];
        return agents.find((x) => x.account_id === accountId);
      };
      const needsRegistration = async () => {
        const me = await ownRecord();
        return !me || me.validity !== "Valid" || Number(me.valid_until_ms) < Date.now() + 36 * 3600e3;
      };
      const registerOnce = async () => {
        const attestation = await client.getAttestation();
        const deposit = (await ownRecord()) ? 0n : 5_000_000_000_000_000_000n;
        await client.call({ methodName: "register_agent", args: { attestation }, deposit, gas: REGISTER_GAS } as any);
      };
      // Keep enough NEAR for gas and send the rest back to the contract it came from, so NEAR never
      // piles up on an agent account (2.1 NEAR was stranded on earlier random key agents).
      const sweepSurplus = async () => {
        try {
          const bal = await rawBalance();
          reg.surplus = `balance ${bal.toFixed(3)} NEAR, keeps ${KEEP_NEAR}`;
          if (bal <= KEEP_NEAR + 0.02) return;
          const amount = BigInt(Math.floor((bal - KEEP_NEAR) * 1e6)) * 10n ** 18n;
          const acc = new Account(accountId, new JsonRpcProvider({ url: config.nearRpc }), new KeyPairSigner(kp));
          const r: any = await Promise.race([
            acc.signAndSendTransaction({ receiverId: config.contractId, actions: [actionCreators.transfer(amount)] }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 90s")), 90_000)),
          ]);
          reg.surplus = `returned ${(bal - KEEP_NEAR).toFixed(3)} NEAR to ${config.contractId}, tx ${r?.transaction?.hash}`;
        } catch (e: any) { reg.surplus = `return failed: ${String(e?.message ?? e).slice(0, 300)}`; }
      };
      // Retry forever with backoff; every failure is recorded and served on /health.
      for (let attempt = 0; ; attempt++) {
        try {
          const must = await needsRegistration();
          if (must && (await rawBalance()) < 0.25) {
            reg.status = "waiting_for_funds"; reg.at = Date.now();
            await new Promise((r) => setTimeout(r, 30_000));
            continue;
          }
          if (must) {
            reg.status = "registering"; reg.at = Date.now();
            await registerOnce();
          }
          reg.status = "registered"; reg.error = undefined; reg.at = Date.now();
          console.log("registered with", config.contractId);
          void sweepSurplus();
          setInterval(() => void sweepSurplus(), 3600e3);
          // Renew before the attestation expires; checked hourly, registers only inside the last 36 hours.
          setInterval(() => void needsRegistration().then((n) => (n ? registerOnce() : undefined)).catch((e) => { reg.error = `re-register: ${String(e?.message ?? e)}`; }), 3600e3);
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

/** Prepaid gas per call. NEAR reserves it all up front (about 0.1 NEAR per 100 Tgas), so each is sized to use. */
const SIGN_GAS = 60_000_000_000_000n; // request_signature forwards 15 Tgas to the MPC signer plus a 10 Tgas callback
const CALL_GAS = 30_000_000_000_000n; // statements and the batch lock
const REGISTER_GAS = 220_000_000_000_000n; // on chain TDX quote verification uses about 184 Tgas
/** NEAR an agent keeps: enough to renew its registration (0.22 reserved) with room for a week of batches. */
const KEEP_NEAR = 0.27;

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();
