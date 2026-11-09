"use client";

import dynamic from "next/dynamic";
import { Details, ErrorLine, NotLive, Row, SectionHead, Source } from "@/components/Bits";
import { HunterMap } from "@/components/HunterMap";
import { lookupRoot } from "@/components/NoteCheck";
import { Reveal } from "@/components/Reveal";
import { PositionLines } from "@/components/WorldPanel";
import { COHORTS, CONTRACT_ID, morphoMarketUrl, nearblocksAddr, type CohortDef } from "@/lib/config";
import { ago, compactUsd, pct, short, units, usd } from "@/lib/format";
import { readStatement } from "@/lib/near";
import { loadTerrain } from "@/lib/terrain";
import { useLive } from "@/lib/useLive";
import { loadLevels, loadWorld } from "@/lib/world";

const ThermalTerrain = dynamic(() => import("@/components/ThermalTerrain").then((m) => m.ThermalTerrain), { ssr: false });

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

function MarketStory({ c, i }: { c: CohortDef; i: number }) {
  const world = useLive(() => loadWorld(c), [c.id], 60_000);
  const levels = useLive(() => loadLevels(c), [c.id], 120_000);
  const m = world.data?.market;
  const price = m?.priceUsd ?? levels.data?.priceUsd ?? 0;
  const near = levels.data && price ? levels.data.levels.filter((l) => l.liquidationPrice >= price * 0.8 && l.liquidationPrice <= price).reduce((n, l) => n + l.debtUsd, 0) : null;
  const cohorts = (world.data?.positions ?? []).filter((p) => p.pos.liquidationPrice);
  return (
    <div className="rule-t py-16 md:py-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:gap-16">
        <div>
          <div className="num text-[12px] text-heat">{String(i + 1).padStart(2, "0")}</div>
          <h2 className="wide mt-3 text-[clamp(28px,3.4vw,46px)] font-semibold leading-[1.02]">{c.label}</h2>
          <div className="display mt-8 text-[clamp(44px,6vw,80px)] leading-none">
            {near !== null ? <span className="text-heat-grad">{compactUsd(near)}</span> : <span className="shimmer text-white/10">$…</span>}
          </div>
          <p className="mt-4 max-w-sm text-[16px] leading-relaxed text-ink-2">
            of loans get liquidated if {c.collateralSymbol} drops 20% from {price ? usd(price, 0) : "today's price"}. A hunter knows exactly where to push.
          </p>
          <a className="num mt-6 inline-flex min-h-11 items-center text-[12px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink" href={morphoMarketUrl(c.marketId)} target="_blank" rel="noreferrer">
            Open the market on Morpho ↗
          </a>
        </div>
        <div className="min-w-0">
          {levels.data && price > 0 ? (
            <HunterMap
              levels={levels.data.levels}
              priceUsd={price}
              symbol={c.collateralSymbol}
              height={280}
              markers={cohorts.map((p) => ({ label: p.kind === "spike" ? "test position" : "Offmap cohort", price: p.pos.liquidationPrice!, tone: "cohort" as const }))}
            />
          ) : levels.error ? (
            <ErrorLine>Could not read the Morpho public API: {levels.error}</ErrorLine>
          ) : (
            <div className="num grid h-[240px] place-items-center text-[12px] text-ink-3">Reading every public loan…</div>
          )}
          <Source>
            Morpho public API, {levels.data ? `the ${levels.data.levels.length} largest of ${levels.data.borrowers.toLocaleString("en-US")} open loans` : "loading"}. Each loan sits at the oracle price divided by its health factor.
          </Source>
        </div>
      </div>

      <Details label="See the data">
        <div className="grid gap-12 pt-4 lg:grid-cols-3">
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
                <Row k="Market id" v={short(c.marketId, 8, 6)} href={morphoMarketUrl(c.marketId)} />
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
              </p>
            )}
          </div>
          <div>
            <div className="eyebrow mb-2">Latest statement on {CONTRACT_ID}</div>
            <Statement c={c} />
          </div>
        </div>
      </Details>
    </div>
  );
}

export function HunterView() {
  const t = useLive(() => loadTerrain(400), [], 180_000);
  return (
    <>
      <section className="relative isolate min-h-[88svh] overflow-hidden">
        <ThermalTerrain className="absolute inset-0 -z-10" points={t.data?.points ?? null} cohortRatio={t.data?.cohortRatio ?? null} animate={false} />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_18%_30%,rgba(11,12,14,0.9)_0%,rgba(11,12,14,0.5)_45%,rgba(11,12,14,0)_75%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[var(--paper)] to-transparent" />
        <div className="gutter">
          <div className="wrap pb-16 pt-32 md:pt-40">
            <div className="flex items-center gap-3">
              <span className="dot dot-hot shimmer" />
              <span className="eyebrow text-ink-2">Public data only</span>
            </div>
            <h1 className="display rise mt-6 max-w-[12ch] text-[clamp(40px,7.4vw,112px)]">
              This is what a <span className="text-heat-grad">hunter</span> sees.
            </h1>
            <p className="rise mt-7 max-w-xl text-[17px] leading-relaxed text-ink-2 md:text-[19px]">
              Every glow is a live loan on Morpho, Base, placed at the price where it gets liquidated. Taller means more debt waiting there. The one cold point is Offmap: all of its users, seen as one borrower.
            </p>
            {t.data && (
              <div className="rise num mt-10 grid max-w-xl grid-cols-2 gap-6 text-[13px]">
                <div className="rule-t pt-3">
                  <div className="eyebrow">Open public loans</div>
                  <div className="mt-1 text-[22px] text-heat">{t.data.borrowers.toLocaleString("en-US")}</div>
                </div>
                <div className="rule-t pt-3">
                  <div className="eyebrow">Offmap users you can find</div>
                  <div className="mt-1 text-[22px] text-cold">0</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="gutter">
        <div className="wrap">
          <Reveal>
            <SectionHead n="01" kicker="Where the debt piles up" title="Pick a market. Read the levels.">
              The same chart a liquidation hunter reads. Hover to see how much debt is forced to sell at each price.
            </SectionHead>
          </Reveal>
          <div className="mt-10">
            {COHORTS.map((c, i) => (
              <MarketStory key={c.id} c={c} i={i} />
            ))}
          </div>

          <div className="rule-t py-20 md:py-28">
            <Reveal>
              <SectionHead n="02" kicker="Now look for an Offmap user" title="You will find one cold point.">
                Not on Morpho, not on Base, not on NEAR, not in any API. Each market shows Offmap as one borrower. The contract stores totals and a salted root that cannot be opened by guessing amounts.
              </SectionHead>
              <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-3">
                One honest caveat: while a pooled position holds a single loan, its total is that loan. The crowd you hide in grows with every user, and the leak study on the proof page shows the live number.
              </p>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
