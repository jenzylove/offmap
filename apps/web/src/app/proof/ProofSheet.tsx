"use client";

import type { ReactNode } from "react";
import { ErrorLine, NotLive, Row, Source } from "@/components/Bits";
import { Statement } from "@/app/hunter/HunterView";
import { agent, agentConfigured, publicCohorts, type AgentHealth, type LeakResp } from "@/lib/agent";
import { AGENT_URL, COHORTS, CONTRACT_ID, basescanAddr, basescanTx, cohortById, nearblocksAddr } from "@/lib/config";
import { ago, short, units } from "@/lib/format";
import { contractState, view } from "@/lib/near";
import { PROOFS } from "@/lib/proofs";
import { useLive } from "@/lib/useLive";

function Block({ n, title, children, aside }: { n: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid gap-6 rule-t py-10 md:grid-cols-[180px_1fr] md:gap-10">
      <div>
        <div className="num text-[13px] text-accent">({n})</div>
        <h2 className="mt-2 font-serif text-[28px] leading-tight">{title}</h2>
        {aside && <div className="mt-2 text-[13px] text-ink-3">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}


function ContractBlock() {
  const st = useLive(() => contractState(), [], 60_000);
  const cfg = useLive(async () => {
    const s = await contractState();
    if (s.kind !== "live") return null;
    const [config, agentInfo, mode] = await Promise.all([
      view<Record<string, unknown>>("config").catch(() => null),
      view<{ account_id: string; validity: unknown }[]>("get_agents", {}).catch(() => null),
      view<string>("mode").catch(() => null),
    ]);
    return { config, agentInfo, mode };
  }, [], 60_000);

  if (st.error) return <ErrorLine>Could not reach NEAR RPC: {st.error}</ErrorLine>;
  if (!st.data) return <div className="num text-[12px] text-ink-3">Reading NEAR mainnet…</div>;
  const s = st.data;
  if (s.kind === "missing")
    return <NotLive title={`${CONTRACT_ID} is not deployed yet`}>The account does not exist on NEAR mainnet. Its code hash, access keys, attestation registry and statements appear here once it is.</NotLive>;
  if (s.kind === "no_code") return <NotLive title={`${CONTRACT_ID} has no code yet`}>The account exists but no contract is deployed to it.</NotLive>;
  if (s.kind === "error") return <ErrorLine>{s.message}</ErrorLine>;
  const approved = (cfg.data?.config?.approved_measurements as { app_compose_hash_payload?: string }[] | undefined) ?? [];
  const agents = cfg.data?.agentInfo ?? [];
  const valid = agents.filter((a) => a.validity === "Valid");
  const retired = agents.length - valid.length;
  return (
    <div>
      <Row k="Contract" v={CONTRACT_ID} href={nearblocksAddr(CONTRACT_ID)} />
      <Row k="Deployed code hash" v={short(s.codeHash, 10, 8)} sub="compare with the reproducible build in the repo" />
      <Row k="Access keys" v={<span className={s.accessKeys === 0 ? "text-good" : "text-bad"}>{s.accessKeys === 0 ? "none (nobody holds a key)" : `${s.accessKeys} key(s) present`}</span>} />
      <Row k="Mode" v={cfg.data?.mode ?? "n/a"} />
      <Row k="Accepted agent code" v={approved.length ? approved.map((m) => short(String(m.app_compose_hash_payload ?? ""), 10, 8)).join(", ") : "not readable"} sub="compose hash of the only image allowed to register" />
      <Row
        k="Registered agents"
        v={valid.length ? valid.map((a) => `${short(a.account_id, 8, 6)} valid`).join(", ") : "none valid"}
        sub={retired ? `${retired} earlier instance(s) retired: their code is no longer accepted` : undefined}
      />
    </div>
  );
}

function AttestationBlock() {
  const h = useLive(() => agent<AgentHealth>("/health"), [], 60_000);
  const att = useLive(() => agent<{ quote?: unknown[]; tcb_info?: { compose_hash?: string } }>("/attestation").catch(() => null), [], 300_000);
  if (!agentConfigured) return <NotLive title="The agent is not live yet">No agent is running, so there is no attestation to show.</NotLive>;
  if (h.error) return <ErrorLine>The agent at {AGENT_URL} did not answer: {h.error}</ErrorLine>;
  if (!h.data) return <div className="num text-[12px] text-ink-3">Asking the agent…</div>;
  const d = h.data;
  return (
    <div>
      {!d.tee && (
        <div className="mb-5">
          <NotLive title="Not in sealed hardware yet">
            The agent answering now runs as a development instance outside Intel TDX, so it has no attestation and {CONTRACT_ID} has not accepted a code hash. Its money moves are real and on chain; its privacy is not hardware backed until the TDX instance registers.
          </NotLive>
        </div>
      )}
      <Row k="Agent NEAR account" v={short(d.agent, 10, 8)} href={nearblocksAddr(d.agent)} />
      <Row k="Owner of the private Intents balance" v={d.intentsOwner ? short(d.intentsOwner, 10, 8) : "n/a"} />
      <Row
        k="Attestation"
        v={d.tee ? (att.data?.tcb_info?.compose_hash ? `Intel TDX quote · compose ${short(att.data.tcb_info.compose_hash, 8, 6)}` : "Intel TDX") : "none"}
        href={d.tee ? `${AGENT_URL}/attestation` : undefined}
        sub={d.tee ? "the full quote; its compose hash must equal the accepted agent code above" : undefined}
      />
      <Row k="Contract it reports to" v={d.contract ?? "none yet"} />
      {d.cohorts.map((c) => (
        <Row key={c.id} k={`Cohort ${c.id} on Base`} v={short(c.address)} href={basescanAddr(c.address)} sub="chain signatures address, no private key exists" />
      ))}
      <Row k="Last batch" v={d.lastBatch ? `#${d.lastBatch.batchId} · ${d.lastBatch.cohortId}` : "none"} sub={d.lastBatch ? ago(d.lastBatch.at) : undefined} />
    </div>
  );
}

function LedgerBlock() {
  const pc = useLive(() => publicCohorts(), [], 60_000);
  if (!agentConfigured) return null;
  if (pc.error) return <ErrorLine>Could not load the agent&apos;s published totals: {pc.error}</ErrorLine>;
  if (!pc.data) return <div className="num text-[12px] text-ink-3">Loading published totals…</div>;
  return (
    <div className="mt-10">
      <div className="eyebrow mb-2">Published by the agent, checked against Morpho</div>
      <div className="grid gap-10 md:grid-cols-2">
        {pc.data.cohorts.map((k) => {
          const c = cohortById(k.cohort);
          const dec = c?.collateralDecimals ?? 18;
          const sym = c?.collateralSymbol ?? "";
          return (
            <div key={k.cohort}>
              <div className="num text-[12px] text-ink">{c?.label ?? k.cohort}</div>
              <Row k="Morpho collateral" v={`${units(BigInt(k.morpho.collateral), dec, 8)} ${sym}`} href={basescanAddr(k.address)} />
              <Row k="Ledger collateral" v={`${units(BigInt(k.ledgerTotals.collateral), dec, 8)} ${sym}`} />
              <Row k="Morpho debt" v={`${units(BigInt(k.morpho.debt), 6, 6)} USDC`} />
              <Row k="Ledger debt" v={`${units(BigInt(k.ledgerTotals.debt), 6, 6)} USDC`} sub="runs slightly ahead: it includes the 1% spread" />
              <Row k="Reserve" v={`${units(BigInt(k.ledgerTotals.reserve), 6, 6)} USDC`} />
              <Row k="Last batch" v={k.lastBatch ? `#${k.lastBatch.batchId}` : "none"} sub={k.lastBatch ? ago(k.lastBatch.at) : undefined} />
              {k.lastBatch?.txs.map((t) => (
                <Row key={t} k="batch tx" v={short(t, 8, 6)} href={basescanTx(t)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeakBlock() {
  const l = useLive(() => agent<LeakResp>("/public/leak"), [], 120_000);
  const notRun = (
    <NotLive title="No leak study published yet">
      The study runs four linking heuristics (amount within 2%, payout within 1 hour, address reuse, pair rarity) over Offmap&apos;s own public deposits and payouts, from public chain data only. The level attack, which tries to estimate one user&apos;s liquidation price from public cohort data, is published alongside it. The agent reports it has not been run yet.
    </NotLive>
  );
  if (!agentConfigured) return notRun;
  if (l.error) return <ErrorLine>Could not load the leak study: {l.error}</ErrorLine>;
  if (!l.data) return <div className="num text-[12px] text-ink-3">Loading…</div>;
  if ("status" in l.data && typeof l.data.status === "string" && Object.keys(l.data).length === 1) return notRun;
  const d = l.data as Record<string, unknown>;
  const num = (v: unknown, kind: "n" | "pct" | "x" = "n") =>
    typeof v !== "number" ? "n/a" : kind === "pct" ? `${(v * 100).toFixed(0)}%` : kind === "x" ? v.toFixed(1) : v.toLocaleString("en-US");
  const bra = (d.borrowRatioAttack ?? {}) as Record<string, unknown>;
  const la = (d.levelAttack ?? {}) as Record<string, unknown>;
  return (
    <div>
      <div className="grid gap-10 md:grid-cols-3">
        <div>
          <div className="eyebrow mb-2">Linking deposits to payouts</div>
          <Row k="Deposits studied" v={num(d.deposits)} />
          <Row k="Payouts studied" v={num(d.payouts)} />
          <Row k="Uniquely linked" v={num(d.uniquelyLinked)} />
          <Row k="Correctly linked" v={num(d.correctlyLinked)} />
          <Row k="Linked fraction" v={num(d.linkedFraction, "pct")} />
          <Row k="Mean anonymity set" v={num(d.meanAnonymitySet, "x")} />
          <Row k="Linked by address reuse" v={num(d.recipientReuseLinks)} />
        </div>
        <div>
          <div className="eyebrow mb-2">Borrow ratio attack</div>
          <Row k="Uniquely linked" v={num(bra.uniquelyLinked)} />
          <Row k="Correctly linked" v={num(bra.correctlyLinked)} />
          <Row k="Linked fraction" v={<span className={typeof bra.linkedFraction === "number" && bra.linkedFraction > 0.5 ? "text-bad" : ""}>{num(bra.linkedFraction, "pct")}</span>} />
          <Row k="Mean anonymity set" v={num(bra.meanAnonymitySet, "x")} />
        </div>
        <div>
          <div className="eyebrow mb-2">Level attack</div>
          <Row k="Batches that moved" v={num(la.movingBatches)} />
          <Row k="Batches exposing one user" v={num(la.batchesExposingOneUser)} />
          <Row k="Batches unknown" v={num(la.batchesUnknown)} />
          <Row k="Exposed fraction" v={num(la.exposedFraction, "pct")} />
        </div>
      </div>
      {typeof d.note === "string" && <p className="mt-6 max-w-3xl text-[15px] text-ink-2">{d.note}</p>}
      <Source>
        {typeof d.method === "string" ? `Method: ${d.method}. ` : ""}
        {typeof d.ranAt === "string" ? `Run ${new Date(d.ranAt).toLocaleString()}. ` : ""}Served by the agent at /public/leak.{typeof d.deposits === "number" && d.deposits < 20 ? ` With only ${d.deposits} deposit${d.deposits === 1 ? "" : "s"} studied, the sample is too small to promise privacy; the numbers are shown as they are.` : ""}
      </Source>
    </div>
  );
}

export function ProofSheet() {
  return (
    <>
      <Block n="01" title="The contract" aside="Keyless NEAR contract that guards every signature.">
        <ContractBlock />
      </Block>
      <Block n="02" title="Sealed hardware" aside="Intel TDX attestation of the running agent.">
        <AttestationBlock />
      </Block>
      <Block n="03" title="Solvency statements" aside="Cohort totals, reserve and the salted Merkle root, per batch.">
        <div className="grid gap-10 md:grid-cols-2">
          {COHORTS.map((c) => (
            <div key={c.id}>
              <div className="eyebrow mb-2">{c.label}</div>
              <Statement c={c} />
            </div>
          ))}
        </div>
        <LedgerBlock />
      </Block>
      <Block n="04" title="Leak study and level attack" aside="How linkable is Offmap traffic, measured on itself.">
        <LeakBlock />
      </Block>
      <Block n="05" title="Runs already on chain" aside="The spikes the product stands on.">
        {PROOFS.map((p) => (
          <div key={p.id} className="rule-t py-5 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="num text-[13px] text-accent">{p.id}</span>
              <span className="font-serif text-[21px]">{p.title}</span>
              <span className="num text-[12px] text-good">{p.result}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {p.links.map((l) => (
                <a key={l.href} className="num ink-link text-[13px]" href={l.href} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ))}
              <a className="num ink-link text-[13px] text-ink-3" href={p.doc} target="_blank" rel="noreferrer">
                write up ↗
              </a>
            </div>
          </div>
        ))}
      </Block>
    </>
  );
}
