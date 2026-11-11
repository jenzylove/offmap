"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import type { TerrainPhase } from "@/components/ThermalTerrain";
import { compactUsd } from "@/lib/format";
import { loadTerrain } from "@/lib/terrain";
import { useLive } from "@/lib/useLive";

const ThermalTerrain = dynamic(() => import("@/components/ThermalTerrain").then((m) => m.ThermalTerrain), { ssr: false });

const STORY: { phase: TerrainPhase[]; text: string }[] = [
  { phase: ["drop", "target"], text: "A new loan lands on the public map. Its liquidation price glows for anyone to read." },
  { phase: ["cool"], text: "Offmap takes it into one pooled position. The loan goes cold." },
  { phase: ["gone"], text: "Gone from the map. The world sees one borrower: the cohort." },
];

export function Hero() {
  const data = useLive(() => loadTerrain(400), [], 180_000);
  const [phase, setPhase] = useState<TerrainPhase>("drop");
  const step = STORY.findIndex((s) => s.phase.includes(phase));

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden">
      <ThermalTerrain
        className="absolute inset-0 -z-10"
        points={data.data?.points ?? null}
        cohortRatio={data.data?.cohortRatio ?? null}
        onPhase={setPhase}
      />
      {/* legibility: a cold shadow behind the words, a fade into the page */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_18%_30%,rgba(11,12,14,0.92)_0%,rgba(11,12,14,0.55)_45%,rgba(11,12,14,0)_75%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[var(--paper)] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-[var(--paper)] to-transparent" />

      <div className="gutter flex min-h-[100svh] flex-col">
        <div className="wrap w-full flex-1 pt-28 md:pt-36">
          <div className="rise flex items-center gap-3">
            <span className="dot dot-cold breathe" />
            <span className="eyebrow text-ink-2">Private borrowing on Morpho, live on Base</span>
          </div>
          <h1 className="display rise mt-6 max-w-[15ch] text-[clamp(40px,6.4vw,100px)]" style={{ animationDelay: "80ms" }}>
            Borrow without becoming a <span className="text-heat-grad">target.</span>
          </h1>
          <p className="rise mt-7 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 md:text-[19px]" style={{ animationDelay: "160ms" }}>
            Deposit Bitcoin or ETH and borrow USDC from Morpho&apos;s lenders. Your loan, your collateral and your liquidation price never appear on the public map: only one pooled borrower does, and every new borrower blurs it further.
          </p>
          <div className="rise mt-9 flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
            <Link href="/app" className="btn btn-primary">
              Start borrowing
            </Link>
            <Link href="/hunter" className="btn btn-heat">
              See what hunters see
            </Link>
          </div>
        </div>

        <div className="wrap w-full pb-8 md:pb-10">
          <div className="grid items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-md" aria-live="polite">
              <div className="flex gap-1.5">
                {STORY.map((s, i) => (
                  <span key={i} className={`h-[3px] w-8 rounded-full transition-colors duration-700 ${i === step ? (i === 0 ? "bg-heat" : "bg-cold") : "bg-white/10"}`} />
                ))}
              </div>
              <p key={step} className="rise mt-3 min-h-[3.2em] text-[15px] leading-snug text-ink">
                {STORY[Math.max(0, step)]!.text}
              </p>
            </div>
            <div className="num text-[11px] text-ink-3 md:text-right">
              <div className="mb-2 flex items-center gap-3 md:justify-end">
                <span className="text-cold">private</span>
                <span className="heat-scale block h-1 w-28 rounded-full" />
                <span className="text-heat">exposed</span>
              </div>
              {data.data ? (
                <span>
                  Plotted live: the {data.data.mapped.toLocaleString("en-US")} largest of {data.data.borrowers.toLocaleString("en-US")} public loans, {compactUsd(data.data.publicDebtUsd)} borrowed
                  <br className="hidden md:block" /> on Morpho&apos;s cbBTC and WETH markets on Base. Placed by liquidation price.
                </span>
              ) : data.error ? (
                <span>The Morpho public API did not answer, so the map is empty right now.</span>
              ) : (
                <span>Reading every public loan on Morpho, Base…</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
