"use client";

import { useEffect, useState } from "react";

/** A real example of the sign in message, built the same way sign in builds it. */
export function SignMessage({ className = "" }: { className?: string }) {
  const [m, setM] = useState<{ nonce: string; deadline: string } | null>(null);
  useEffect(() => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    setM({
      nonce: Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""),
      deadline: new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.\d+Z$/, "Z"),
    });
  }, []);
  return (
    <div className={className}>
      <div className="num break-all text-[12px] leading-relaxed text-ink-2">
        offmap:auth:<span className="text-cold">{m?.nonce ?? "8f2c41d09ab37e65c1f04d9b2e7a5c36"}</span>:
        <span className="text-ink">{m?.deadline ?? "2026-11-14T12:00:00Z"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span><span className="text-cold">●</span> one time code, never reused</span>
        <span><span className="text-ink">●</span> expires 10 minutes later</span>
      </div>
    </div>
  );
}
