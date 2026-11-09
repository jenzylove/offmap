"use client";

import { useEffect, useRef, useState } from "react";
import { COHORTS } from "@/lib/config";
import { readLevels } from "@/lib/morpho";
import { useLive } from "@/lib/useLive";

function useCountUp(target: number | null, ms = 1600) {
  const [v, setV] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (target === null) return;
    const el = ref.current;
    if (!el) return;
    const run = () => {
      if (started.current) {
        setV(target);
        return;
      }
      started.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        setV(target * (1 - Math.pow(1 - k, 4)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (run(), io.disconnect()), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [target, ms]);
  return { v, ref };
}

export function ProblemNumber() {
  const live = useLive(async () => {
    const all = await Promise.all(COHORTS.map((c) => readLevels(c, 1)));
    return { borrowers: all.reduce((n, x) => n + x.borrowers, 0), debt: all.reduce((n, x) => n + x.borrowUsd, 0) };
  }, [], 300_000);
  const { v, ref } = useCountUp(live.data ? live.data.debt / 1e6 : null);
  return (
    <div ref={ref}>
      <div className="flex items-center gap-3">
        <span className="dot dot-hot shimmer" />
        <span className="eyebrow">Live from Morpho on Base</span>
      </div>
      <div className="display mt-5 text-[clamp(64px,15vw,220px)] leading-[0.85] tracking-[-0.05em]">
        {live.data ? (
          <span className="text-heat-grad">
            ${v >= 1000 ? (v / 1000).toFixed(2) : v.toFixed(1)}
            <span className="text-[0.5em]">{v >= 1000 ? "B" : "M"}</span>
          </span>
        ) : live.error ? (
          <span className="text-ink-3">n/a</span>
        ) : (
          <span className="shimmer text-white/10">$…</span>
        )}
      </div>
      <p className="mt-8 max-w-3xl text-[clamp(20px,2.4vw,30px)] leading-snug text-ink">
        {live.data ? (
          <>
            borrowed by <span className="num text-heat">{live.data.borrowers.toLocaleString("en-US")}</span> open loans on Morpho&apos;s cbBTC and WETH markets, and anyone can read the exact price where each one gets liquidated. Hunters push the price into those levels, then buy the forced selling.
          </>
        ) : live.error ? (
          <>The Morpho public API did not answer just now. On a normal day it lists every open loan on these markets, each with the exact price where it gets liquidated.</>
        ) : (
          <>Counting every public loan on Morpho&apos;s cbBTC and WETH markets on Base…</>
        )}
      </p>
    </div>
  );
}
