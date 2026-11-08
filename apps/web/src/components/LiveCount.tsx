"use client";

import { COHORTS } from "@/lib/config";
import { compactUsd } from "@/lib/format";
import { readLevels } from "@/lib/morpho";
import { useLive } from "@/lib/useLive";

/** Live count of open borrowers whose level anyone can read, across the two cohort markets. */
export function LiveCount() {
  const live = useLive(async () => {
    const all = await Promise.all(COHORTS.map((c) => readLevels(c, 1)));
    return { borrowers: all.reduce((n, x) => n + x.borrowers, 0), debt: all.reduce((n, x) => n + x.borrowUsd, 0) };
  });
  if (live.error) return <span className="text-ink-3">(could not reach the Morpho API just now)</span>;
  if (!live.data) return <span className="num text-ink-3">counting…</span>;
  return (
    <>
      <span className="num text-accent">{live.data.borrowers.toLocaleString("en-US")}</span> open loans worth{" "}
      <span className="num text-accent">{compactUsd(live.data.debt)}</span>
    </>
  );
}
