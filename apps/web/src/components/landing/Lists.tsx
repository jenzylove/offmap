"use client";

import Link from "next/link";
import { useFocusIndex } from "@/components/Reveal";

export interface FocusItem {
  t: string;
  d: string;
  href?: string;
  cta?: string;
  tag?: string;
}

/** A vertical list where the row nearest the middle of the screen is in focus and the rest step back. */
export function FocusList({ items, tone = "cold" }: { items: FocusItem[]; tone?: "cold" | "near" }) {
  const { active, bind } = useFocusIndex(items.length);
  return (
    <ol className="mt-14">
      {items.map((it, i) => {
        const on = i === active;
        return (
          <li
            key={it.t}
            ref={bind(i)}
            className={`grid gap-4 rule-t py-9 transition-all duration-500 md:grid-cols-[90px_minmax(0,1fr)_minmax(0,0.9fr)] md:gap-10 md:py-12 ${on ? "opacity-100" : "opacity-35"}`}
          >
            <div className={`num text-[13px] transition-colors duration-500 ${on ? "text-cold" : "text-ink-3"}`}>{String(i + 1).padStart(2, "0")}</div>
            <div>
              {it.tag && <div className="eyebrow mb-3">{it.tag}</div>}
              <h3 className="wide text-[clamp(22px,2.6vw,34px)] font-semibold leading-[1.1]">{it.t}</h3>
            </div>
            <div>
              <p className="text-[16px] leading-relaxed text-ink-2 md:text-[17px]">{it.d}</p>
              {it.href && (
                <Link href={it.href} className={`num mt-5 inline-flex min-h-11 items-center gap-2 text-[12px] uppercase tracking-[0.14em] ${tone === "near" ? "text-ink" : "text-cold"} hover:underline`}>
                  {it.cta ?? "Verify"} <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Faq({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-14">
      {items.map(([q, a], i) => (
        <details key={q} className="group rule-t" open={i === 0}>
          <summary className="flex min-h-16 items-center justify-between gap-6 py-6">
            <span className="wide text-[clamp(18px,2vw,24px)] font-medium leading-snug transition-colors group-open:text-cold">{q}</span>
            <span className="faq-mark num grid h-10 w-10 flex-none place-items-center rounded-full text-[20px] text-ink-2 ring-1 ring-white/10">+</span>
          </summary>
          <p className="max-w-3xl pb-8 text-[17px] leading-relaxed text-ink-2">{a}</p>
        </details>
      ))}
    </div>
  );
}
