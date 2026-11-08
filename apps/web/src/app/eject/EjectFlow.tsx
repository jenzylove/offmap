"use client";

import { leafHash, type Note } from "@offmap/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAddress, recoverTransactionAddress, type Address, type Hex } from "viem";
import { ErrorLine, NotLive, Row } from "@/components/Bits";
import { NoteVerdict } from "@/components/NoteCheck";
import { agentConfigured, publicCohorts } from "@/lib/agent";
import { CONTRACT_ID, MORPHO, basescanAddr, basescanTx, cohortById, nearblocksTx } from "@/lib/config";
import {
  AUTH_TYPES,
  assembleSigned,
  buildEjectArgs,
  morphoDomain,
  parseEjectOutcome,
  payloadHash,
  splitSig,
  txHashOf,
  unsignedEjectTx,
  userIdForEvm,
  type Authorization,
  type CohortConfigWire,
  type ContractConfigWire,
  type EjectCallArgs,
  type EjectOutcome,
  type EjectPreview,
  type SignatureArg,
  type StoredStatementWire,
} from "@/lib/eject";
import { short, units } from "@/lib/format";
import { baseClient, morphoAbi } from "@/lib/morpho";
import { contractState, readConfig, readStoredStatement, view, type ContractState } from "@/lib/near";
import { parseNote } from "@/lib/notes";
import { evmWallet, nearConnectorInstance } from "@/lib/session";
import { NEAR_RPC } from "@/lib/config";

const errText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e));

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-5 pb-14 last:pb-0">
      <div className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border num text-[12px] ${done ? "border-[var(--good)] bg-[var(--good)] text-paper" : "border-[var(--ink)] bg-paper"}`}>
        {done ? "✓" : n}
      </div>
      <div className="min-w-0">
        <h2 className="font-serif text-[28px] leading-tight">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </li>
  );
}

interface Ctx {
  contract: ContractState;
  config: ContractConfigWire | null;
  cohort: CohortConfigWire | null;
  stored: StoredStatementWire | null;
  why: string | null;
}

/** Everything the eject needs from NEAR and the agent, or a plain reason it is missing. */
async function loadCtx(cohortId: string): Promise<Ctx> {
  const contract = await contractState();
  if (contract.kind !== "live") {
    const why =
      contract.kind === "missing" ? `${CONTRACT_ID} is not deployed on NEAR mainnet yet.` : contract.kind === "no_code" ? `${CONTRACT_ID} has no contract code yet.` : `Could not read ${CONTRACT_ID}: ${contract.message}`;
    return { contract, config: null, cohort: null, stored: null, why };
  }
  const [config, stored] = await Promise.all([readConfig(), readStoredStatement(cohortId)]);
  const cohort = config.cohorts.find((c) => c.id === cohortId) ?? null;
  const why = !cohort ? `${CONTRACT_ID} has no cohort ${cohortId}.` : !stored ? `${CONTRACT_ID} has no statement for ${cohortId} yet.` : null;
  return { contract, config, cohort, stored, why };
}

interface TxParams {
  nonce: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasLimit: bigint;
}

/** Nonce and fees for the eject tx, sent FROM the cohort address, clamped to the contract's bounds. */
async function readTxParams(cohortAddress: Address, cfg: ContractConfigWire): Promise<TxParams> {
  const [nonce, block, prio] = await Promise.all([
    baseClient.getTransactionCount({ address: cohortAddress, blockTag: "pending" }),
    baseClient.getBlock(),
    baseClient.estimateMaxPriorityFeePerGas().catch(() => 1_000_000n),
  ]);
  const cap = BigInt(cfg.eject_max_fee_per_gas);
  const base = block.baseFeePerGas ?? 0n;
  let maxFee = base * 2n + prio;
  if (maxFee > cap) maxFee = cap;
  const maxPriority = prio > maxFee ? maxFee : prio;
  const lo = BigInt(cfg.eject_min_gas_limit);
  const hi = BigInt(cfg.eject_max_gas_limit);
  let gas = 900_000n; // the fork test used about 470k
  if (gas < lo) gas = lo;
  if (gas > hi) gas = hi;
  return { nonce: BigInt(nonce), maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority, gasLimit: gas };
}

async function fetchNearTx(hash: string, sender: string) {
  const r = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "offmap", method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.data ?? j.error.message);
  return j.result;
}

interface StoredEject {
  leaf_hash: string;
  signed_tx: string;
  tx_nonce: string;
}

export function EjectFlow() {
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [manualCohort, setManualCohort] = useState("");
  const [prior, setPrior] = useState<StoredEject | null>(null);

  const [user, setUser] = useState<Address | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [auths, setAuths] = useState<{ grant: Authorization; grantSig: SignatureArg; revoke: Authorization; revokeSig: SignatureArg } | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const [txp, setTxp] = useState<TxParams | null>(null);
  const [txpErr, setTxpErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ remote: EjectPreview | null; err: string | null } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [nearTx, setNearTx] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EjectOutcome | null>(null);
  const [signed, setSigned] = useState<Hex | null>(null);
  const [signedCheck, setSignedCheck] = useState<string | null>(null);
  const [broadcast, setBroadcast] = useState<{ hash: Hex; note?: string; status?: string } | null>(null);
  const [bcErr, setBcErr] = useState<string | null>(null);

  // Load NEAR and agent context for the note's cohort.
  useEffect(() => {
    if (!note) return;
    let live = true;
    setCtx(null);
    setCtxErr(null);
    setPrior(null);
    loadCtx(note.cohortId)
      .then(async (c) => {
        if (!live) return;
        setCtx(c);
        if (c.contract.kind === "live") {
          const lh = leafHash(note).toLowerCase();
          const done = await view<boolean>("ejected", { leaf_hash: lh }).catch(() => false);
          if (done) {
            const list = await view<StoredEject[]>("ejects", { cohort_id: note.cohortId, from_index: 0, limit: 1000 }).catch(() => []);
            const rec = list.find((e) => e.leaf_hash.toLowerCase() === lh);
            if (live && rec) setPrior(rec);
          }
        }
      })
      .catch((e) => live && setCtxErr(errText(e)));
    return () => {
      live = false;
    };
  }, [note]);

  useEffect(() => {
    setAuths(null);
    setPreview(null);
  }, [note, user]);

  // The cohort's Base address, published by the agent. Loaded on its own so a slow or absent agent blocks nothing.
  const [agentCohort, setAgentCohort] = useState<{ address: Address | null; done: boolean }>({ address: null, done: false });
  useEffect(() => {
    if (!note) return;
    let live = true;
    setAgentCohort({ address: null, done: !agentConfigured });
    if (!agentConfigured) return;
    publicCohorts()
      .then((pc) => {
        const a = pc.cohorts.find((c) => c.cohort === note.cohortId)?.address;
        if (live) setAgentCohort({ address: a ? getAddress(a.toLowerCase()) : null, done: true });
      })
      .catch(() => live && setAgentCohort({ address: null, done: true }));
    return () => {
      live = false;
    };
  }, [note]);

  const cohortAddress: Address | null = useMemo(() => {
    if (agentCohort.address) return agentCohort.address;
    return /^0x[0-9a-fA-F]{40}$/.test(manualCohort.trim()) ? getAddress(manualCohort.trim().toLowerCase()) : null;
  }, [agentCohort.address, manualCohort]);

  const helper: Address | null = ctx?.cohort && /^0x[0-9a-fA-F]{40}$/.test(ctx.cohort.eject_helper) ? getAddress(ctx.cohort.eject_helper.toLowerCase()) : null;
  const owns = note && user ? userIdForEvm(user) === note.userId.toLowerCase() : null;
  const rootMatches = note && ctx?.stored ? note.root.toLowerCase() === ctx.stored.statement.merkle_root.toLowerCase() : null;
  const cdef = note ? cohortById(note.cohortId) : undefined;

  // Tx params from Base once the cohort address and config are known.
  useEffect(() => {
    if (!cohortAddress || !ctx?.config) return;
    let live = true;
    setTxpErr(null);
    readTxParams(cohortAddress, ctx.config)
      .then((p) => live && setTxp(p))
      .catch((e) => live && setTxpErr(errText(e)));
    return () => {
      live = false;
    };
  }, [cohortAddress, ctx?.config]);

  const args: EjectCallArgs | null = useMemo(() => {
    if (!note || !user || !auths || !txp || !ctx?.stored) return null;
    return buildEjectArgs({ cohortId: note.cohortId, note, user: user.toLowerCase(), statement: ctx.stored.statement, ...auths, tx: txp });
  }, [note, user, auths, txp, ctx?.stored]);

  const localUnsigned = useMemo(() => (args && ctx?.cohort ? unsignedEjectTx(ctx.cohort, args) : null), [args, ctx?.cohort]);
  const localPayload = localUnsigned ? payloadHash(localUnsigned) : null;

  // Ask the contract to run every check on these exact arguments, without signing.
  useEffect(() => {
    if (!args || ctx?.contract.kind !== "live") return;
    let live = true;
    setPreview(null);
    view<EjectPreview>("eject_tx_preview", { ...args, as_account: null })
      .then((p) => live && setPreview({ remote: p, err: null }))
      .catch((e) => live && setPreview({ remote: null, err: errText(e).replace(/^.*Smart contract panicked: /, "") }));
    return () => {
      live = false;
    };
  }, [args, ctx?.contract.kind]);

  const sign = async () => {
    if (!user || !helper || !ctx?.cohort) return;
    setSigning(true);
    setSignErr(null);
    try {
      const { client, address } = await evmWallet();
      if (address.toLowerCase() !== user.toLowerCase()) throw new Error("The wallet switched accounts. Connect again.");
      await client.switchChain({ id: ctx.cohort.base_chain_id }).catch(() => undefined);
      const nonce = await baseClient.readContract({ address: MORPHO, abi: morphoAbi, functionName: "nonce", args: [user] });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 86400);
      const domain = morphoDomain(ctx.cohort.base_chain_id, MORPHO);
      const grant: Authorization = { authorizer: user, authorized: helper, isAuthorized: true, nonce, deadline };
      const revoke: Authorization = { authorizer: user, authorized: helper, isAuthorized: false, nonce: nonce + 1n, deadline };
      const gs = await client.signTypedData({ account: user, domain, types: AUTH_TYPES, primaryType: "Authorization", message: grant });
      const rs = await client.signTypedData({ account: user, domain, types: AUTH_TYPES, primaryType: "Authorization", message: revoke });
      setAuths({ grant, grantSig: splitSig(gs), revoke, revokeSig: splitSig(rs) });
    } catch (e) {
      setSignErr(errText(e));
    } finally {
      setSigning(false);
    }
  };

  /** Rebuilds the signed tx here from our own unsigned tx and the MPC signature, and checks it against the contract's. */
  const finish = async (o: EjectOutcome) => {
    setOutcome(o);
    if (!o.signature || !o.signed_tx) throw new Error("The MPC network did not sign. The contract released your leaf, so you can try again.");
    if (!args || !ctx?.cohort) {
      setSigned(o.signed_tx as Hex);
      return;
    }
    const mine = assembleSigned(ctx.cohort, args, o.signature);
    const from = await recoverTransactionAddress({ serializedTransaction: mine as `0x02${string}` });
    const okFrom = cohortAddress ? from.toLowerCase() === cohortAddress.toLowerCase() : true;
    setSignedCheck(
      `${mine.toLowerCase() === o.signed_tx.toLowerCase() ? "Rebuilt in this browser, identical to the contract's." : "Rebuilt in this browser; differs from the contract's copy, using the browser build."} Signed by ${short(from)}${okFrom ? ", the cohort address." : ", which is NOT the cohort address."}`,
    );
    if (!okFrom) throw new Error("The signature does not come from the cohort address. Not broadcasting.");
    setSigned(mine);
  };

  const submit = async () => {
    if (!args) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const connector = await nearConnectorInstance();
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts();
      const res = await wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [{ type: "FunctionCall", params: { methodName: "eject", args, gas: "300000000000000", deposit: "0" } }],
      });
      const hash = res?.transaction?.hash ?? (res as { transaction_outcome?: { id?: string } })?.transaction_outcome?.id ?? null;
      setNearTx(hash);
      let o: EjectOutcome;
      try {
        o = parseEjectOutcome(res as Parameters<typeof parseEjectOutcome>[0]);
      } catch (e) {
        if (!hash || !accounts[0]) throw e;
        o = parseEjectOutcome(await fetchNearTx(hash, accounts[0].accountId));
      }
      await finish(o);
    } catch (e) {
      setSubmitErr(errText(e));
    } finally {
      setSubmitting(false);
    }
  };

  const send = async (raw: Hex) => {
    setBcErr(null);
    const hash = txHashOf(raw);
    try {
      await baseClient.sendRawTransaction({ serializedTransaction: raw });
      setBroadcast({ hash, status: "sent" });
    } catch (e) {
      const m = errText(e);
      if (/already known|nonce too low|already imported/i.test(m)) setBroadcast({ hash, note: "Base already has this transaction; someone broadcast it first.", status: "known" });
      else {
        setBcErr(m);
        return;
      }
    }
    try {
      const r = await baseClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      setBroadcast({ hash, status: r.status === "success" ? "confirmed" : "reverted" });
    } catch {
      /* still pending; the link shows it */
    }
  };

  const contractLive = ctx?.contract.kind === "live";

  return (
    <ol className="relative">
      <svg aria-hidden="true" className="absolute left-[15px] top-2 h-[calc(100%-16px)] w-2" preserveAspectRatio="none" viewBox="0 0 2 100">
        <line x1="1" y1="0" x2="1" y2="100" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>

      <Step n={1} title="Paste your latest note" done={!!note}>
        <p className="max-w-xl text-ink-2">Your note holds your share, the salt for your leaf, and your Merkle proof. Save it from your view after each batch.</p>
        <textarea className="field mt-4 min-h-32 resize-y font-mono text-[13px]" placeholder='{"cohortId":"cbbtc-usdc", …}' value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <button
          className="btn mt-4"
          disabled={!text.trim()}
          onClick={() => {
            try {
              setNote(parseNote(text));
              setNoteErr(null);
            } catch (e) {
              setNote(null);
              setNoteErr(errText(e));
            }
          }}
        >
          Read note
        </button>
        {noteErr && <div className="mt-4"><ErrorLine>{noteErr}</ErrorLine></div>}
        {note && (
          <div className="mt-8">
            {!cdef && <ErrorLine>Unknown cohort {note.cohortId}.</ErrorLine>}
            <NoteVerdict note={note} />
            {ctxErr && <div className="mt-4"><ErrorLine>{ctxErr}</ErrorLine></div>}
            {ctx?.why && <div className="mt-6"><NotLive title="Eject cannot be signed yet">{ctx.why} Everything below can be prepared; the contract call stays off until it can be checked.</NotLive></div>}
            {prior && (
              <div className="mt-6 border-l-4 border-accent py-1 pl-4">
                <div className="font-serif text-[20px]">This note was already ejected.</div>
                <p className="mt-1 text-[14px] text-ink-2">The contract holds the signed transaction (Base nonce {prior.tx_nonce}). Anyone can broadcast it.</p>
                <button className="btn btn-primary mt-3" onClick={() => void send(prior.signed_tx as Hex)}>
                  Broadcast the signed eject
                </button>
              </div>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title="Connect the wallet that receives your position" done={!!user && owns === true}>
        <p className="max-w-xl text-ink-2">Your Base wallet. It must be the wallet your loan belongs to: the contract checks that the note was issued to exactly this address.</p>
        <button
          className="btn mt-4"
          disabled={!note}
          onClick={async () => {
            setWalletErr(null);
            try {
              setUser((await evmWallet()).address);
            } catch (e) {
              setWalletErr(errText(e));
            }
          }}
        >
          {user ? `Connected ${short(user)}` : "Connect EVM wallet"}
        </button>
        {walletErr && <div className="mt-4"><ErrorLine>{walletErr}</ErrorLine></div>}
        {owns === false && <div className="mt-4"><ErrorLine>This wallet is not the owner named in the note. Connect the wallet you signed in with when you borrowed.</ErrorLine></div>}
        {owns === true && <p className="mt-4 text-good">This wallet owns the note.</p>}
      </Step>

      <Step n={3} title="Sign two Morpho authorizations" done={!!auths}>
        <p className="max-w-xl text-ink-2">
          One lets the immutable eject helper open the position at your wallet; the second takes that permission back in the same transaction, so the helper keeps no access. Signing is free and moves nothing on its own.
        </p>
        {note && ctx && !helper && (
          <div className="mt-4">
            <NotLive title="Eject helper not known yet">{contractLive ? `${CONTRACT_ID} has no eject helper for ${note.cohortId}.` : `The helper address comes from ${CONTRACT_ID}, which is not deployed yet.`} Signing stays off so nothing is signed for the wrong contract.</NotLive>
          </div>
        )}
        {helper && <p className="num mt-3 text-[12px] text-ink-3">Helper {helper} · Morpho {short(MORPHO)} · chain {ctx?.cohort?.base_chain_id}</p>}
        <button className="btn mt-4" disabled={!owns || !helper || signing} onClick={sign}>
          {signing ? "Waiting for signatures…" : auths ? "Signed. Sign again" : "Sign authorizations"}
        </button>
        {signErr && <div className="mt-4"><ErrorLine>{signErr}</ErrorLine></div>}
      </Step>

      <Step n={4} title={`Check it with ${CONTRACT_ID}`} done={!!preview?.remote && preview.remote.payload_hash === localPayload}>
        <p className="max-w-xl text-ink-2">
          The transaction is sent from the cohort&apos;s Base address, so its nonce and fees are read from that address. The contract then runs every eject check on these exact arguments without signing anything.
        </p>
        <div className="mt-4">
          {note && !agentCohort.address && !agentCohort.done && <div className="num py-2 text-[12px] text-ink-3">Asking the agent for the cohort address…</div>}
          {note && agentCohort.done && !agentCohort.address && (
            <label className="mb-4 block max-w-xl">
              <span className="text-[13px] text-ink-2">Cohort address on Base (the agent did not answer; copy it from the hunter view or Basescan)</span>
              <input className="field" value={manualCohort} onChange={(e) => setManualCohort(e.target.value)} placeholder="0x…" spellCheck={false} />
            </label>
          )}
          {cohortAddress && <Row k="Sent from (cohort)" v={short(cohortAddress)} href={basescanAddr(cohortAddress)} />}
          {txp && (
            <>
              <Row k="Base nonce" v={txp.nonce.toString()} />
              <Row k="Max fee" v={`${units(txp.maxFeePerGas, 9, 4)} gwei`} sub={ctx?.config ? `contract cap ${units(BigInt(ctx.config.eject_max_fee_per_gas), 9, 4)} gwei` : undefined} />
              <Row k="Priority fee" v={`${units(txp.maxPriorityFeePerGas, 9, 4)} gwei`} />
              <Row k="Gas limit" v={txp.gasLimit.toLocaleString("en-US")} sub={ctx?.config ? `allowed ${ctx.config.eject_min_gas_limit} to ${ctx.config.eject_max_gas_limit}` : undefined} />
            </>
          )}
          {txpErr && <ErrorLine>Could not read Base: {txpErr}</ErrorLine>}
          {args && (
            <>
              <Row k="Debt shares repaid" v={args.eject_args.borrow_shares} sub="your pro rata share of the cohort's Morpho borrow shares, rounded up" />
              <Row k="Flash loan" v={`${units(BigInt(args.eject_args.flash_assets), 6, 6)} USDC`} sub="your debt plus 1%" />
              <Row k="Payload hash, this browser" v={short(localPayload!, 10, 8)} />
              <Row
                k="Payload hash, contract preview"
                v={preview?.remote ? <span className={preview.remote.payload_hash === localPayload ? "text-good" : "text-bad"}>{short(preview.remote.payload_hash, 10, 8)} {preview.remote.payload_hash === localPayload ? "✓ match" : "✗ differs"}</span> : preview?.err ? <span className="text-bad">refused</span> : "checking…"}
              />
              {preview?.err && <ErrorLine>The contract would refuse this eject: {preview.err}</ErrorLine>}
            </>
          )}
          {rootMatches === false && <div className="mt-3"><ErrorLine>Your note&apos;s root is not the latest statement root. Get your latest note first.</ErrorLine></div>}
        </div>
      </Step>

      <Step n={5} title="Submit, then broadcast to Base" done={broadcast?.status === "confirmed"}>
        <p className="max-w-xl text-ink-2">
          Any NEAR account can submit. The contract verifies your leaf, marks it spent and has the NEAR signer network sign the transaction with the cohort&apos;s key. This page then rebuilds the signed transaction, checks who signed it, and broadcasts it to Base.
        </p>
        {args && (
          <details className="mt-4">
            <summary className="num text-[12px] uppercase tracking-[0.1em] text-ink-2">Show the exact call</summary>
            <pre className="num mt-3 max-h-72 overflow-auto bg-paper-2 p-4 text-[11px] leading-relaxed text-ink-2">{`${CONTRACT_ID}.eject(${JSON.stringify(args, null, 2)})\ngas 300 Tgas · deposit 0`}</pre>
          </details>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="btn btn-primary" disabled={!args || !contractLive || !preview?.remote || preview.remote.payload_hash !== localPayload || submitting || !!signed} onClick={submit}>
            {submitting ? "Waiting for NEAR wallet…" : "Submit with NEAR wallet"}
          </button>
          {args && (
            <button className="btn" onClick={() => void navigator.clipboard.writeText(JSON.stringify(args))}>
              Copy arguments
            </button>
          )}
        </div>
        {!contractLive && ctx && <p className="mt-3 text-[13px] text-ink-3">Off until {CONTRACT_ID} is live.</p>}
        {submitErr && <div className="mt-4"><ErrorLine>{submitErr}</ErrorLine></div>}
        {nearTx && <Row k="NEAR transaction" v={short(nearTx, 8, 6)} href={nearblocksTx(nearTx)} />}
        {outcome && <Row k="Leaf marked spent" v={short(outcome.leaf_hash, 10, 8)} />}
        {signedCheck && <p className="mt-3 text-[14px] text-ink-2">{signedCheck}</p>}
        {signed && !broadcast && (
          <button className="btn btn-primary mt-5" onClick={() => void send(signed)}>
            Broadcast to Base
          </button>
        )}
        {bcErr && <div className="mt-4"><ErrorLine>Base refused the transaction: {bcErr}</ErrorLine></div>}
        {broadcast && (
          <div className="mt-5">
            <Row
              k="Base transaction"
              v={short(broadcast.hash, 10, 8)}
              href={basescanTx(broadcast.hash)}
              sub={broadcast.status === "confirmed" ? "confirmed: the position is now at your wallet" : broadcast.status === "reverted" ? "reverted on Base" : "waiting for Base"}
            />
            {broadcast.note && <p className="mt-2 text-[13px] text-ink-3">{broadcast.note}</p>}
          </div>
        )}
      </Step>
    </ol>
  );
}
