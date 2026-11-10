"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicLevel } from "@/lib/morpho";
import { compactUsd, usd } from "@/lib/format";

export interface MapMarker {
  label: string;
  price: number;
  tone: "cohort" | "you";
}

const BINS = 72;

/**
 * The hunter's map: every public borrower's liquidation price on one axis, glowing where debt piles up.
 * x runs from far below today's price (left) to today's price (right).
 */
export function HunterMap({
  levels,
  priceUsd,
  markers = [],
  height = 220,
  floor = 0.45,
  symbol,
}: {
  levels: PublicLevel[];
  priceUsd: number;
  markers?: MapMarker[];
  height?: number;
  floor?: number;
  symbol: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 600 ? Math.round(height * 0.85) : height;
  const lo = priceUsd * floor;
  const hi = priceUsd * 1.02;
  const x = (p: number) => ((p - lo) / (hi - lo)) * W;
  const [hover, setHover] = useState<number | null>(null);

  const { bins, smooth, max, total } = useMemo(() => {
    const bins = new Array<number>(BINS).fill(0);
    let total = 0;
    for (const l of levels) {
      if (l.liquidationPrice < lo || l.liquidationPrice > hi) continue;
      const i = Math.min(BINS - 1, Math.max(0, Math.floor(((l.liquidationPrice - lo) / (hi - lo)) * BINS)));
      bins[i]! += l.debtUsd;
      total += l.debtUsd;
    }
    const smooth = bins.map((_, i) => {
      let s = 0;
      let w = 0;
      for (let d = -3; d <= 3; d++) {
        const j = i + d;
        if (j < 0 || j >= BINS) continue;
        const k = Math.exp(-(d * d) / 3);
        s += Math.sqrt(bins[j]!) * k;
        w += k;
      }
      return s / w;
    });
    const max = Math.max(1e-9, ...smooth);
    return { bins, smooth, max, total };
  }, [levels, lo, hi]);

  const ground = H - 44;
  const relief = H - 78;
  const bw = W / BINS;
  const ridge = (scale: number) => {
    let d = `M0,${ground}`;
    smooth.forEach((v, i) => {
      const cx = i * bw + bw / 2;
      d += `L${cx.toFixed(1)},${(ground - (v / max) * relief * scale).toFixed(1)}`;
    });
    return d + `L${W},${ground}`;
  };

  const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1].filter((t) => t >= floor);
  const binLo = (i: number) => lo + ((hi - lo) * i) / BINS;

  return (
    <figure ref={ref} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Liquidation levels of public ${symbol} borrowers`}>
        <defs>
          <linearGradient id="heatfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--heat)" stopOpacity="0.6" />
            <stop offset="0.5" stopColor="var(--heat-2)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--heat-2)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="heatline" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--heat-2)" />
            <stop offset="1" stopColor="var(--heat)" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* relief: nested ridge lines like a cross section through contours */}
        <path d={ridge(1) + "Z"} fill="url(#heatfill)" />
        {[1, 0.78, 0.58, 0.4, 0.24, 0.12].map((s, i) => (
          <path key={s} d={ridge(s)} fill="none" stroke={i === 0 ? "url(#heatline)" : "rgba(255,91,31,0.16)"} strokeWidth={i === 0 ? 1.6 : 0.9} vectorEffect="non-scaling-stroke" />
        ))}

        {/* heat strip on the ground line */}
        <g filter="url(#glow)">
          {bins.map((v, i) => {
            const t = Math.sqrt(v) / Math.sqrt(Math.max(...bins, 1e-9));
            if (t < 0.04) return null;
            return (
              <rect
                key={i}
                x={i * bw}
                y={ground - 4}
                width={bw + 1}
                height={18}
                fill={t > 0.6 ? "var(--heat)" : "var(--heat-2)"}
                opacity={Math.min(1, 0.15 + t)}
                className={t > 0.35 ? "shimmer" : undefined}
                style={t > 0.35 ? { animationDelay: `${(i * 0.37) % 3}s` } : undefined}
              />
            );
          })}
        </g>
        {bins.map((v, i) => (
          <rect
            key={`h${i}`}
            x={i * bw}
            y={0}
            width={bw}
            height={ground + 14}
            fill={hover === i ? "var(--heat-soft)" : "transparent"}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        <line x1="0" x2={W} y1={ground + 14} y2={ground + 14} stroke="var(--rule)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(priceUsd * t)} x2={x(priceUsd * t)} y1={ground + 14} y2={ground + 20} stroke="var(--ink-3)" />
            <text x={x(priceUsd * t)} y={ground + 32} textAnchor="middle" className="num" fontSize="11" fill="var(--ink-3)">
              {t === 1 ? "now" : `↓${Math.round((1 - t) * 100)}%`}
            </text>
          </g>
        ))}

        {/* price now */}
        <line x1={x(priceUsd)} x2={x(priceUsd)} y1={6} y2={ground + 14} stroke="var(--ink)" strokeWidth="1.2" />
        <text x={x(priceUsd) - 8} y={18} textAnchor="end" className="num" fontSize="12" fill="var(--ink)">
          {symbol} {usd(priceUsd, 0)}
        </text>

        {markers.map((m, i) => {
          if (m.price > hi) return null;
          if (m.price < lo)
            return (
              <text key={i} x={4} y={40 + i * 18} className="num" fontSize="11" fill="var(--ink)">
                ← {m.label} at {usd(m.price, 0)}, far below this window
              </text>
            );
          const mx = x(m.price);
          const col = "var(--cold)";
          return (
            <g key={i}>
              <line x1={mx} x2={mx} y1={30 + i * 18} y2={ground + 14} stroke={col} strokeDasharray="3 4" strokeWidth="1.2" />
              <circle cx={mx} cy={ground + 5} r="11" fill="var(--cold)" opacity="0.18" className="breathe" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
              <circle cx={mx} cy={ground + 5} r="5" fill="var(--cold)" stroke="var(--paper)" strokeWidth="1.6" />
              <text x={mx + 8} y={40 + i * 18} className="num" fontSize="11" fill={col}>
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex min-h-[20px] flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12px] text-ink-3 num">
        {hover !== null ? (
          <span className="text-ink">
            {compactUsd(bins[hover]!)} of loans liquidate if {symbol} falls to {usd(binLo(hover), 0)} to {usd(binLo(hover + 1), 0)}
          </span>
        ) : (
          <span>{compactUsd(total)} of public debt shown. Left means a bigger fall is needed. Hover to read a level.</span>
        )}
      </figcaption>
    </figure>
  );
}
