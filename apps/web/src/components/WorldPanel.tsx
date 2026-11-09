"use client";

import { useState } from "react";
import { COHORTS, basescanAddr, morphoMarketUrl, type CohortDef } from "@/lib/config";
import { ago, compactUsd, pct, short, units, usd } from "@/lib/format";
import { useLive } from "@/lib/useLive";
import { loadLevels, loadWorld, type WorldPosition } from "@/lib/world";
import { HunterMap, type MapMarker } from "./HunterMap";
import { ErrorLine, NotLive, Source } from "./Bits";

export function CohortTabs({ value, onChange }: { value: CohortDef; onChange: (c: CohortDef) => void }) {
  return (
    <div role="tablist" aria-label="Cohort market" className="flex gap-5">
      {COHORTS.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={value.id === c.id}
          onClick={() => onChange(c)}
          className={`num min-h-11 border-b-2 text-[12px] uppercase tracking-[0.1em] transition-colors ${value.id === c.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function PositionLines({ c, p }: { c: CohortDef; p: WorldPosition }) {
  return (
    <div className="rule-t py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-[14px]">
          <span className={p.kind === "spike" ? "dot dot-off" : "dot dot-cold"} />
          <span className="text-ink">{p.label}</span>
        </div>
        <a className="num ink-link text-[12px] text-ink-2" href={basescanAddr(p.pos.address)} target="_blank" rel="noreferrer">
          {short(p.pos.address)}
        </a>
      </div>
      <dl className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Collateral</dt>
          <dd>
            {units(p.pos.collateral, c.collateralDecimals, 8)} {c.collateralSymbol}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Debt</dt>
          <dd>{units(p.pos.borrowAssets, 6, 2)} USDC</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Loan to value</dt>
          <dd>{p.pos.ltv === null ? "none" : pct(p.pos.ltv)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-accent">Liquidation price</dt>
          <dd className="text-accent">{p.pos.liquidationPrice === null ? "none" : usd(p.pos.liquidationPrice, 0)}</dd>
        </div>
      </dl>
      {p.published && <LedgerMatch c={c} p={p} />}
    </div>
  );
}

/** The agent's published ledger totals beside what Morpho holds. They should agree within interest rounding. */
function LedgerMatch({ c, p }: { c: CohortDef; p: WorldPosition }) {
  const pub = p.published!;
  const lc = BigInt(pub.ledgerTotals.collateral);
  const ld = BigInt(pub.ledgerTotals.debt);
  const collOk = lc === p.pos.collateral;
  const diff = ld > p.pos.borrowAssets ? ld - p.pos.borrowAssets : p.pos.borrowAssets - ld;
  // Ledger debt includes the 1% spread, so it runs slightly ahead of Morpho. Allow 1% or 100 units.
  const debtOk = diff <= 100n || diff * 100n <= (p.pos.borrowAssets || 1n);
  const lb = pub.lastBatch;
  return (
    <div className="num mt-3 border-l-2 border-[var(--rule)] pl-3 text-[12px] text-ink-2">
      <div>
        <span className={collOk && debtOk ? "text-good" : "text-bad"}>{collOk && debtOk ? "✓" : "✗"}</span> Private ledger total (published by the agent):{" "}
        {units(lc, c.collateralDecimals, 8)} {c.collateralSymbol} · {units(ld, 6, 6)} USDC · reserve {units(BigInt(pub.ledgerTotals.reserve), 6, 6)} USDC
      </div>
      <div className="text-ink-3">
        {collOk && debtOk ? "Equals the Morpho position above, within interest rounding." : "Differs from the Morpho position above."}
        {lb ? ` Last batch ${lb.batchId}, ${ago(lb.at)}.` : ""} No individual loan appears in either.
      </div>
    </div>
  );
}

/** "What the world sees": public levels on the market plus the cohort positions, read live. */
export function WorldPanel({ compact = false, initial = COHORTS[0]! }: { compact?: boolean; initial?: CohortDef }) {
  const [c, setC] = useState<CohortDef>(initial);
  const world = useLive(() => loadWorld(c), [c.id], 60_000);
  const levels = useLive(() => loadLevels(c), [c.id], 120_000);

  const price = world.data?.market.priceUsd ?? levels.data?.priceUsd ?? 0;
  const markers: MapMarker[] = (world.data?.positions ?? [])
    .filter((p) => p.pos.liquidationPrice !== null)
    .map((p) => ({ label: p.kind === "spike" ? "spike (test)" : "Offmap cohort", price: p.pos.liquidationPrice!, tone: "cohort" as const }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CohortTabs value={c} onChange={setC} />
        <a className="num ink-link text-[11px] uppercase tracking-[0.1em] text-ink-3" href={morphoMarketUrl(c.marketId)} target="_blank" rel="noreferrer">
          Morpho market {short(c.marketId, 6, 4)}
        </a>
      </div>

      <div className="mt-5 min-h-[180px]">
        {levels.data && price > 0 ? (
          <HunterMap levels={levels.data.levels} priceUsd={price} markers={markers} symbol={c.collateralSymbol} height={compact ? 190 : 230} />
        ) : levels.error ? (
          <ErrorLine>Could not read the public level map from Morpho: {levels.error}</ErrorLine>
        ) : (
          <div className="num grid h-[180px] place-items-center text-[12px] text-ink-3">Surveying Morpho on Base…</div>
        )}
      </div>

      {levels.data && (
        <div className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] text-ink-2 sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Public borrowers</div>
            {levels.data.borrowers.toLocaleString("en-US")}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Borrowed</div>
            {compactUsd(levels.data.borrowUsd)}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Borrow rate</div>
            {pct(levels.data.borrowApy, 2)}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Mapped here</div>
            top {levels.data.levels.length}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="eyebrow mb-1">Offmap on this market</div>
        {world.error && <ErrorLine>Could not read Base: {world.error}</ErrorLine>}
        {!world.data && !world.error && <div className="num py-3 text-[12px] text-ink-3">Reading the cohort positions on Base…</div>}
        {world.data?.positions.map((p) => <PositionLines key={p.pos.address} c={c} p={p} />)}
        {world.data && world.data.positions.length === 0 && (
          <NotLive title="No cohort on this market yet">The agent has not opened the {c.label} cohort, so there is nothing to show here.</NotLive>
        )}
        {world.data && world.data.agent.kind !== "live" && (
          <p className="mt-3 text-[13px] text-ink-3">
            {world.data.agent.kind === "not_configured"
              ? "The Offmap agent is not live yet, so cohort addresses are not published."
              : `The Offmap agent did not answer (${world.data.agent.message}).`}
            {c.id === "cbbtc-usdc" && " Shown instead: the real test position from spike S1, run through NEAR chain signatures."}
          </p>
        )}
      </div>
      <Source>
        Positions read live from Morpho Blue on Base{world.data ? ` at block ${world.data.market.block.toLocaleString("en-US")}` : ""}. Level map from the
        Morpho public API: the {levels.data?.levels.length ?? "largest"} biggest borrowers, liquidation price = price ÷ health factor.
      </Source>
    </div>
  );
}
