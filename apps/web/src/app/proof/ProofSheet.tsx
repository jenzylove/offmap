"use client";

import type { ReactNode } from "react";
import { Details, ErrorLine, NotLive, Row, Source } from "@/components/Bits";
import { Reveal } from "@/components/Reveal";
import { loadWorld } from "@/lib/world";
import { Statement } from "@/app/hunter/HunterView";
import { agent, agentConfigured, publicCohorts, type AgentHealth, type LeakResp } from "@/lib/agent";
import { AGENT_URL, COHORTS, CONTRACT_ID, basescanAddr, basescanTx, cohortById, nearblocksAddr } from "@/lib/config";
import { ago, short, units } from "@/lib/format";
import { contractState, readStatement, view } from "@/lib/near";
import { PROOFS } from "@/lib/proofs";
import { useLive } from "@/lib/useLive";

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
      <Row k="Access keys" v={<span className={s.fullAccessKeys === 0 ? "text-good" : "text-bad"}>{s.fullAccessKeys > 0 ? `${s.fullAccessKeys} full access key: the owner can still replace the code` : s.accessKeys === 0 ? "none (nobody holds a key)" : "no full access key; one restricted key for config proposals and sweep"}</span>} sub="config changes wait 24 hours in public; the agent signs only inside a batch lock" />
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

type Tone = "pass" | "wait" | "fail" | "load";

function Light({ tone }: { tone: Tone }) {
  const cls = tone === "pass" ? "bg-cold shadow-[0_0_22px_var(--cold)]" : tone === "fail" ? "bg-heat-2 shadow-[0_0_22px_var(--heat-2)]" : tone === "wait" ? "bg-warn" : "bg-white/15 shimmer";
  return (
    <span className="relative grid h-12 w-12 flex-none place-items-center rounded-full ring-1 ring-white/10">
      {tone === "pass" && <span className="absolute inset-0 rounded-full ring-1 ring-cold/60 pulse-ring" />}
      <span className={`h-3.5 w-3.5 rounded-full ${cls}`} />
    </span>
  );
}

function Check({ id, n, title, plain, tone, verdict, children }: { id: string; n: string; title: string; plain: ReactNode; tone: Tone; verdict: ReactNode; children: ReactNode }) {
  return (
    <Reveal as="section">
      <div id={id} className="scroll-mt-28 rule-t py-14 md:py-20">
        <div className="grid gap-8 md:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
          <div className="num text-[13px] text-cold">{n}</div>
          <div>
            <h2 className="wide text-[clamp(26px,3.2vw,42px)] font-semibold leading-[1.05]">{title}</h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink-2">{plain}</p>
          </div>
          <div className="flex items-start gap-5">
            <Light tone={tone} />
            <div className="min-w-0 pt-1.5">
              <div className={`text-[18px] leading-snug ${tone === "pass" ? "text-cold" : tone === "fail" ? "text-bad" : "text-ink"}`}>{verdict}</div>
            </div>
          </div>
        </div>
        <div className="md:ml-[130px]">
          <Details label="See the data">{children}</Details>
        </div>
      </div>
    </Reveal>
  );
}

interface Verdict {
  tone: Tone;
  text: string;
}

function useContractCheck() {
  return useLive<Verdict>(async () => {
    const s = await contractState();
    if (s.kind !== "live") return { tone: "fail", text: s.kind === "error" ? `Could not read ${CONTRACT_ID}.` : `${CONTRACT_ID} is not deployed.` };
    if (s.fullAccessKeys > 0) return { tone: "wait", text: `${CONTRACT_ID} is live, but an owner key can still replace its code.` };
    return { tone: "pass", text: `${CONTRACT_ID} is live on NEAR mainnet and nobody holds a key that can replace its code.` };
  }, [], 60_000);
}

function useHardwareCheck() {
  return useLive<Verdict>(async () => {
    if (!agentConfigured) return { tone: "fail", text: "No agent is configured." };
    const [h, agents] = await Promise.all([agent<AgentHealth>("/health"), view<{ account_id: string; validity: unknown }[]>("get_agents", {}).catch(() => [])]);
    const valid = agents.filter((a) => a.validity === "Valid").length;
    if (!h.tee) return { tone: "wait", text: "The agent answering now is not running in sealed hardware." };
    return valid > 0
      ? { tone: "pass", text: "The agent answers from Intel TDX, and the contract lists it as a valid, attested agent." }
      : { tone: "wait", text: "The agent runs in Intel TDX, but the contract lists no valid agent right now." };
  }, [], 60_000);
}

function useSolvencyCheck() {
  return useLive<Verdict>(async () => {
    const worlds = await Promise.all(COHORTS.map((c) => loadWorld(c)));
    const pubs = worlds.flatMap((w) => w.positions.filter((p) => p.kind === "cohort" && p.published));
    if (!pubs.length) return { tone: "wait", text: "The agent has not published pooled totals yet." };
    const ok = pubs.every((p) => BigInt(p.published!.ledgerTotals.collateral) === p.pos.collateral);
    const statements = await Promise.all(COHORTS.map((c) => readStatement(c.id).catch(() => null)));
    const n = statements.filter(Boolean).length;
    return ok
      ? { tone: "pass", text: `The private ledger's collateral equals the Morpho positions on Base exactly. ${n} of ${COHORTS.length} markets have a statement on NEAR.` }
      : { tone: "fail", text: "The private ledger and the Morpho position disagree right now." };
  }, [], 60_000);
}

function useLeakCheck() {
  return useLive<Verdict>(async () => {
    if (!agentConfigured) return { tone: "wait", text: "Not published." };
    const d = (await agent<LeakResp>("/public/leak")) as Record<string, unknown>;
    if (typeof d.linkedFraction !== "number") return { tone: "wait", text: "The agent has not published a leak study yet." };
    const deposits = typeof d.deposits === "number" ? d.deposits : null;
    const small = deposits !== null && deposits < 20;
    return {
      tone: small ? "wait" : "pass",
      text: `Published. ${(d.linkedFraction * 100).toFixed(0)}% of deposits could be linked to a payout${deposits !== null ? `, across ${deposits} deposit${deposits === 1 ? "" : "s"} studied` : ""}.${small ? " That sample is too small to promise privacy yet." : ""}`,
    };
  }, [], 120_000);
}

const verdictOf = (x: { data: Verdict | null; error: string | null }): Verdict =>
  x.data ?? (x.error ? { tone: "fail", text: `Could not check: ${x.error}` } : { tone: "load", text: "Checking live…" });

export function ProofSheet() {
  const c = verdictOf(useContractCheck());
  const h = verdictOf(useHardwareCheck());
  const s = verdictOf(useSolvencyCheck());
  const l = verdictOf(useLeakCheck());
  const lights = [c, h, s, l];
  const passing = lights.filter((x) => x.tone === "pass").length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 pb-6">
        <div className="flex gap-2">
          {lights.map((x, i) => (
            <span key={i} className={`h-2 w-10 rounded-full transition-colors duration-700 ${x.tone === "pass" ? "bg-cold shadow-[0_0_12px_var(--cold)]" : x.tone === "fail" ? "bg-heat-2" : x.tone === "wait" ? "bg-warn" : "bg-white/10 shimmer"}`} />
          ))}
        </div>
        <span className="num text-[13px] text-ink-2">{lights.some((x) => x.tone === "load") ? "Running the checks live…" : `${passing} of ${lights.length} checks passing right now`}</span>
      </div>

      <Check id="contract" n="01" title="The contract cannot be swapped." plain={<>The NEAR contract decides who may sign for the pooled positions, and it signs your eject. If nobody holds a full key, nobody can quietly change those rules.</>} tone={c.tone} verdict={c.text}>
        <ContractBlock />
      </Check>
      <Check id="hardware" n="02" title="The agent runs in sealed hardware." plain={<>Your ledger lives inside an Intel TDX machine. The contract only accepts an agent whose hardware report matches the approved code. Anyone can fetch that report.</>} tone={h.tone} verdict={h.text}>
        <AttestationBlock />
      </Check>
      <Check id="solvency" n="03" title="The books match the chain." plain={<>After every batch the agent publishes pooled totals and writes a statement to NEAR. Here they are held up against the real Morpho positions on Base.</>} tone={s.tone} verdict={s.text}>
        <div className="grid gap-10 md:grid-cols-2">
          {COHORTS.map((k) => (
            <div key={k.id}>
              <div className="eyebrow mb-2">{k.label}</div>
              <Statement c={k} />
            </div>
          ))}
        </div>
        <LedgerBlock />
      </Check>
      <Check id="leak" n="04" title="We measure our own leaks." plain={<>We run the tricks a snoop would use on our own deposits and payouts, from public chain data only, and publish what they find.</>} tone={l.tone} verdict={l.text}>
        <LeakBlock />
      </Check>

      <Reveal as="section">
        <div id="runs" className="scroll-mt-28 rule-t py-14 md:py-20">
          <div className="grid gap-8 md:grid-cols-[90px_minmax(0,1fr)] md:gap-10">
            <div className="num text-[13px] text-cold">05</div>
            <div>
              <h2 className="wide text-[clamp(26px,3.2vw,42px)] font-semibold leading-[1.05]">Already run on chain.</h2>
              <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-2">Every piece Offmap stands on was run for real first. Each run links to its transactions.</p>
              <div className="mt-10">
                {PROOFS.map((p) => (
                  <details key={p.id} className="group rule-t">
                    <summary className="flex min-h-16 items-center justify-between gap-6 py-5">
                      <span className="flex items-baseline gap-4">
                        <span className="num text-[12px] text-ink-3">{p.id}</span>
                        <span className="text-[18px] text-ink">{p.title}</span>
                      </span>
                      <span className="num hidden text-[12px] text-cold sm:block">{p.result}</span>
                    </summary>
                    <div className="pb-8 sm:pl-10">
                      <p className="max-w-2xl text-[15px] text-ink-2">{p.what}</p>
                      <div className="num mt-3 text-[11px] uppercase tracking-[0.12em] text-ink-3">
                        {p.network} · {p.date}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                        {p.links.map((x) => (
                          <a key={x.href} className="num ink-link text-[13px]" href={x.href} target="_blank" rel="noreferrer">
                            {x.label} ↗
                          </a>
                        ))}
                        <a className="num ink-link text-[13px] text-ink-3" href={p.doc} target="_blank" rel="noreferrer">
                          write up ↗
                        </a>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </>
  );
}
