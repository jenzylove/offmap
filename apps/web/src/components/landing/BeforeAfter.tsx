"use client";

import { PRICE_SCALE } from "@offmap/core";
import Link from "next/link";
import { useState } from "react";
import { HunterMap } from "@/components/HunterMap";
import { agent, type PositionResp } from "@/lib/agent";
import { COHORTS, cohortById } from "@/lib/config";
import { pct, units, usd } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLive } from "@/lib/useLive";
import { loadLevels, loadWorld } from "@/lib/world";

function useWorld() {
  return useLive(async () => {
    const worlds = await Promise.all(COHORTS.map(async (c) => ({ c, w: await loadWorld(c) })));
    // the cohort that holds loans right now, else the first one
    const pick = worlds.find((x) => x.w.positions.some((p) => p.kind === "cohort" && p.pos.collateral > 0n)) ?? worlds[0]!;
    const levels = await loadLevels(pick.c);
    return { ...pick, levels };
  }, [], 120_000);
}

export function BeforeAfter() {
  const [side, setSide] = useState<"world" | "you">("world");
  return (
    <div className="mt-14">
      <div role="tablist" aria-label="Who is looking" className="inline-flex rounded-full p-1 ring-1 ring-white/10">
        {(
          [
            ["world", "What the world sees"],
            ["you", "What you see"],
          ] as const
        ).map(([v, t]) => (
          <button
            key={v}
            role="tab"
            aria-selected={side === v}
            onClick={() => setSide(v)}
            className={`min-h-11 rounded-full px-4 text-[14px] transition-all duration-300 sm:px-6 ${
              side === v ? (v === "world" ? "bg-heat/15 text-heat ring-1 ring-heat/40" : "bg-cold/15 text-cold ring-1 ring-cold/40") : "text-ink-2 hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="relative mt-10 min-h-[460px]">
        {side === "world" ? <WorldSide /> : <YouSide />}
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "heat" | "cold" }) {
  return (
    <div className="rule-t py-4">
      <div className="eyebrow">{k}</div>
      <div className={`num mt-2 text-[clamp(20px,2.2vw,28px)] ${tone === "heat" ? "text-heat" : tone === "cold" ? "text-cold" : "text-ink"}`}>{v}</div>
    </div>
  );
}

function WorldSide() {
  const w = useWorld();
  if (w.error) return <p className="text-ink-2">Could not read Base just now: {w.error}</p>;
  if (!w.data) return <p className="num text-[13px] text-ink-3">Reading Morpho on Base…</p>;
  const { c, w: world, levels } = w.data;
  const cohort = world.positions.find((p) => p.kind === "cohort") ?? world.positions[0];
  const price = world.market.priceUsd;
  return (
    <div className="rise grid gap-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <HunterMap
          levels={levels.levels}
          priceUsd={price}
          symbol={c.collateralSymbol}
          height={260}
          markers={cohort?.pos.liquidationPrice ? [{ label: "Offmap cohort", price: cohort.pos.liquidationPrice, tone: "cohort" }] : []}
        />
      </div>
      <div>
        <p className="text-[19px] leading-snug text-ink">
          Every glow on the left is someone&apos;s loan. Offmap is <span className="text-cold">one borrower</span> among them, holding everyone&apos;s loans in a single position.
        </p>
        <div className="mt-6">
          <Stat k={`Offmap cohort, ${c.label}`} v="1 borrower on Morpho" tone="cold" />
          {cohort && <Stat k="Its collateral and debt, all users together" v={`${units(cohort.pos.collateral, c.collateralDecimals, 6)} ${c.collateralSymbol} · ${units(cohort.pos.borrowAssets, 6, 2)} USDC`} />}
          <Stat k="Any single user inside it" v="not on any public record" />
        </div>
      </div>
    </div>
  );
}

function YouSide() {
  const s = useSession();
  const pos = useLive(async () => (s.token ? agent<PositionResp>("/position", { token: s.token, timeoutMs: 30_000 }) : null), [s.token], 60_000);
  const p = pos.data?.positions.find((x) => BigInt(x.debt) > 0n || BigInt(x.collateral) > 0n);
  const c = p ? cohortById(p.cohort) : undefined;

  if (s.token && p && c) {
    const liq = p.liquidationPrice ? Number(p.liquidationPrice) / Number(PRICE_SCALE) : null;
    const price = Number(p.price) / Number(PRICE_SCALE);
    return (
      <div className="rise grid gap-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="rounded-[28px] bg-[radial-gradient(ellipse_at_30%_20%,rgba(127,233,255,0.12),transparent_60%)] p-8 ring-1 ring-cold/20 md:p-12">
          <div className="eyebrow">Your liquidation price, {c.collateralSymbol}</div>
          <div className="display mt-4 text-[clamp(48px,8vw,104px)] text-cold-grad">{liq ? usd(liq, 0) : "none"}</div>
          <div className="num mt-3 text-[13px] text-ink-3">
            {c.collateralSymbol} now {usd(price, 0)} · loan to value {pct(Number(p.ltvBps) / 10_000)}
          </div>
        </div>
        <div>
          <p className="text-[19px] leading-snug text-ink">This is your loan, read from the private ledger for your signature only.</p>
          <div className="mt-6">
            <Stat k="Collateral" v={`${units(BigInt(p.collateral), c.collateralDecimals, 8)} ${c.collateralSymbol}`} />
            <Stat k="Debt" v={`${units(BigInt(p.debt), 6, 4)} USDC`} />
            <Stat k="Who else can see this" v="nobody" tone="cold" />
          </div>
          <Link href="/app" className="btn btn-primary mt-6">
            Open your loan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rise grid gap-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="relative overflow-hidden rounded-[28px] p-8 ring-1 ring-cold/20 md:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(127,233,255,0.10),transparent_60%)]" />
        <div className="relative">
          <div className="eyebrow">Your liquidation price</div>
          <div className="mt-5 h-[clamp(48px,8vw,96px)] w-[70%] rounded-xl bg-[repeating-linear-gradient(90deg,rgba(127,233,255,0.18)_0_3px,transparent_3px_7px)]" />
          {["Collateral", "Debt", "Health"].map((k, i) => (
            <div key={k} className="mt-6 flex items-center justify-between rule-t pt-4 text-[14px] text-ink-2">
              <span>{k}</span>
              <span className="redact" style={{ width: `${9 - i * 2}ch` }} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[19px] leading-snug text-ink">
          Your collateral, your debt and the price where you get liquidated live only in a private ledger. It opens for one person: whoever signs with the wallet that owns the loan.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/app" className="btn btn-primary">
            {s.owner ? "Sign in to see yours" : "Connect and see yours"}
          </Link>
        </div>
        {s.token && pos.data && !p && <p className="mt-4 text-[14px] text-ink-3">This wallet has no loan yet.</p>}
      </div>
    </div>
  );
}
