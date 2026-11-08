"use client";

import { ErrorLine, NotLive, Row, Source } from "@/components/Bits";
import { HunterMap } from "@/components/HunterMap";
import { PositionLines } from "@/components/WorldPanel";
import { COHORTS, CONTRACT_ID, morphoMarketUrl, nearblocksAddr, type CohortDef } from "@/lib/config";
import { ago, compactUsd, pct, short, units, usd } from "@/lib/format";
import { lookupRoot } from "@/components/NoteCheck";
import { readStatement } from "@/lib/near";
import { useLive } from "@/lib/useLive";
import { loadLevels, loadWorld } from "@/lib/world";

export function Statement({ c }: { c: CohortDef }) {
  const st = useLive(async () => {
    const l = await lookupRoot(c.id);
    if (!l.root) return { why: l.why, s: null };
    return { why: null, s: await readStatement(c.id) };
  }, [c.id], 60_000);
  if (st.error) return <ErrorLine>Could not read {CONTRACT_ID}: {st.error}</ErrorLine>;
  if (!st.data) return <div className="num text-[12px] text-ink-3">Reading {CONTRACT_ID}…</div>;
  if (!st.data.s) return <NotLive title="No solvency statement on chain yet">{st.data.why}</NotLive>;
  const s = st.data.s;
  return (
    <div>
      <Row k="Batch" v={String(s.batch_id)} sub={`${ago(Number(s.timestamp_ms))}`} />
      <Row k="Total collateral" v={`${units(BigInt(s.total_collateral), c.collateralDecimals, 8)} ${c.collateralSymbol}`} />
      <Row k="Total debt" v={`${units(BigInt(s.total_debt), 6, 2)} USDC`} />
      <Row k="Reserve" v={`${units(BigInt(s.reserve), 6, 2)} USDC`} />
      <Row k="Merkle root" v={short(s.merkle_root, 10, 8)} sub={`${s.leaf_count} padded leaves`} href={nearblocksAddr(CONTRACT_ID)} />
    </div>
  );
}

function CohortSheet({ c, i }: { c: CohortDef; i: number }) {
  const world = useLive(() => loadWorld(c), [c.id], 60_000);
  const levels = useLive(() => loadLevels(c), [c.id], 120_000);
  const m = world.data?.market;
  const price = m?.priceUsd ?? levels.data?.priceUsd ?? 0;
  return (
    <div className="rule-t pb-16 pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="display text-[clamp(32px,4.4vw,56px)]">
          <span className="num mr-3 align-middle text-[13px] text-accent">({String(i + 1).padStart(2, "0")})</span>
          {c.label}
        </h2>
        <a className="num ink-link text-[12px] text-ink-2" href={morphoMarketUrl(c.marketId)} target="_blank" rel="noreferrer">
          Morpho market {short(c.marketId, 8, 6)} ↗
        </a>
      </div>

      <div className="mt-8">
        <div className="eyebrow mb-3">The hunter&apos;s map: every big borrower&apos;s liquidation level</div>
        {levels.data && price > 0 ? (
          <HunterMap
            levels={levels.data.levels}
            priceUsd={price}
            symbol={c.collateralSymbol}
            markers={(world.data?.positions ?? [])
              .filter((p) => p.pos.liquidationPrice)
              .map((p) => ({ label: p.kind === "spike" ? "spike (test)" : "Offmap cohort", price: p.pos.liquidationPrice!, tone: "cohort" as const }))}
          />
        ) : levels.error ? (
          <ErrorLine>Could not read the Morpho public API: {levels.error}</ErrorLine>
        ) : (
          <div className="num grid h-[200px] place-items-center text-[12px] text-ink-3">Surveying…</div>
        )}
        <Source>
          Morpho public API, {levels.data ? `${levels.data.levels.length} largest of ${levels.data.borrowers.toLocaleString("en-US")} open borrowers` : "loading"}. Each borrower&apos;s level is the oracle price divided by their health factor.
        </Source>
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-3">
        <div>
          <div className="eyebrow mb-2">Market, live from Base</div>
          {world.error && <ErrorLine>Could not read Base: {world.error}</ErrorLine>}
          {m && (
            <>
              <Row k={`${c.collateralSymbol} oracle price`} v={usd(m.priceUsd, 0)} />
              <Row k="Supplied" v={compactUsd(Number(m.totalSupplyAssets) / 1e6)} />
              <Row k="Borrowed" v={compactUsd(Number(m.totalBorrowAssets) / 1e6)} />
              <Row k="Utilization" v={pct(Number(m.totalBorrowAssets) / Number(m.totalSupplyAssets))} />
              <Row k="Morpho liquidates at" v={pct(Number(m.lltv) / 1e18, 0)} sub="loan to value" />
              <Source>Morpho Blue market() and oracle price() at block {m.block.toLocaleString("en-US")}.</Source>
            </>
          )}
        </div>
        <div>
          <div className="eyebrow mb-2">Offmap positions on this market</div>
          {world.data?.positions.map((p) => <PositionLines key={p.pos.address} c={c} p={p} />)}
          {world.data && world.data.positions.length === 0 && <NotLive title="No cohort here yet">The agent has not published a {c.label} cohort address.</NotLive>}
          {world.data && world.data.agent.kind !== "live" && (
            <p className="mt-3 text-[13px] text-ink-3">
              {world.data.agent.kind === "not_configured" ? "The agent is not live, so cohort addresses come from no published list yet." : `The agent did not answer: ${world.data.agent.message}.`}
              {c.id === "cbbtc-usdc" && " The spike position above is the real test loan from spike S1, held by a NEAR chain signatures address."}
            </p>
          )}
        </div>
        <div>
          <div className="eyebrow mb-2">Latest statement on {CONTRACT_ID}</div>
          <Statement c={c} />
        </div>
      </div>
    </div>
  );
}

export function HunterView() {
  return (
    <>
      <div className="mb-14 grid gap-6 border-l-4 border-accent py-2 pl-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="font-serif text-[clamp(24px,3vw,34px)] leading-tight">No per user data exists anywhere public.</div>
          <p className="mt-2 max-w-2xl text-ink-2">
            Not on Morpho, not on Base, not on NEAR, not in any API. Each cohort shows up as one borrower. The contract stores only totals and a salted root that cannot be opened by guessing amounts.
          </p>
        </div>
        <div className="num text-[12px] uppercase tracking-[0.12em] text-ink-3">by design</div>
      </div>
      {COHORTS.map((c, i) => (
        <CohortSheet key={c.id} c={c} i={i} />
      ))}
    </>
  );
}
