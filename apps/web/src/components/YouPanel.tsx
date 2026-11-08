"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { Fog } from "./Fog";

const ROWS = [
  ["Collateral", 9],
  ["Debt", 7],
  ["Health", 5],
  ["Liquidation price", 8],
  ["Note and Merkle proof", 11],
] as const;

/** "What you see": your own loan, fogged until you sign in on your view. */
export function YouPanel() {
  const { owner, token } = useSession();
  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="num text-[12px] uppercase tracking-[0.1em] text-ink">Your private loan</div>
        <div className="num text-[11px] uppercase tracking-[0.1em] text-ink-3">visible to: you</div>
      </div>
      <div className="mt-5">
        <Fog>
          <div className="px-6 py-10 sm:px-10">
            {ROWS.map(([k, w]) => (
              <div key={k} className="grid grid-cols-[1fr_auto] items-baseline gap-4 rule-t py-3 text-[14px] text-ink-2">
                <span>{k}</span>
                <span className="redact" style={{ width: `${w}ch` }} />
              </div>
            ))}
          </div>
        </Fog>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Link href="/app/position" className="btn">
          {owner ? (token ? "Open your view" : "Go to your view") : "Sign in to lift the fog"}
        </Link>
        <span className="text-[13px] text-ink-3">Not on Morpho, not on any explorer, not in any API. Only your signature opens it.</span>
      </div>
    </div>
  );
}
