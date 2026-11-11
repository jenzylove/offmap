"use client";

import type { ReactNode } from "react";
import { useFocusIndex } from "@/components/Reveal";
import { SignMessage } from "@/components/SignMessage";

const STEPS: { t: string; d: string; tag: string; visual: () => ReactNode }[] = [
  {
    t: "Connect your wallet and sign in",
    tag: "free, no gas",
    d: "Any browser wallet on an EVM chain. You sign one short message so the agent knows the loan is yours. It costs nothing and moves nothing.",
    visual: () => <SignVisual />,
  },
  {
    t: "Deposit Bitcoin or ETH",
    tag: "through NEAR Intents",
    d: "Send BTC, cbBTC or WBTC from Bitcoin, Base or Ethereum, or WETH on Base. It lands in a private balance, not in a public wallet tied to you.",
    visual: () => <DepositVisual />,
  },
  {
    t: "USDC arrives after a short private delay",
    tag: "from Morpho's lenders",
    d: "Your collateral joins one pooled Morpho position with everyone else's. The next batch borrows your USDC and pays it to your wallet in round sized pieces after a random wait, so nobody can match it to your deposit.",
    visual: () => <PayoutVisual />,
  },
  {
    t: "Manage your loan, or eject any time",
    tag: "no permission needed",
    d: "Repay, borrow more or withdraw from your loan page. If you ever want out on your own terms, eject moves your share into a Morpho position at your own wallet through the NEAR contract. It works even if Offmap is down.",
    visual: () => <ManageVisual />,
  },
];

export function HowItWorks() {
  const { active, bind } = useFocusIndex(STEPS.length);
  return (
    <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      {/* the visual stays put while the steps scroll past it */}
      <div className="hidden lg:block">
        <div className="sticky top-[18vh] h-[64vh] min-h-[440px]">
          <div className="relative h-full overflow-hidden rounded-[28px] bg-[radial-gradient(ellipse_at_50%_40%,#141a1f_0%,#0d0f12_70%)] ring-1 ring-white/[0.06]">
            {STEPS.map((s, i) => (
              <div key={s.t} className={`absolute inset-0 grid place-items-center p-10 transition-all duration-700 ${i === active ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}>
                <div key={String(i === active)} className="grid w-full place-items-center">
                  {s.visual()}
                </div>
              </div>
            ))}
            <div className="num absolute bottom-5 left-6 text-[11px] uppercase tracking-[0.16em] text-ink-3">
              step {active + 1} of {STEPS.length}
            </div>
          </div>
        </div>
      </div>
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.t} ref={bind(i)} className={`flex min-h-[46vh] flex-col justify-center rule-t py-10 transition-opacity duration-500 lg:min-h-[64vh] ${i === active ? "opacity-100" : "lg:opacity-30"}`}>
            <div className="flex items-center gap-4">
              <span className={`num grid h-9 w-9 place-items-center rounded-full text-[13px] ring-1 transition-colors duration-500 ${i === active ? "bg-cold text-[var(--accent-ink)] ring-cold" : "text-ink-2 ring-white/15"}`}>{i + 1}</span>
              <span className="eyebrow">{s.tag}</span>
            </div>
            <h3 className="wide mt-6 text-[clamp(26px,3vw,40px)] font-semibold leading-[1.05]">{s.t}</h3>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink-2">{s.d}</p>
            <div className="mt-8 h-[300px] overflow-hidden rounded-[24px] bg-[#0f1215] ring-1 ring-white/[0.06] lg:hidden">
              <div className="grid h-full place-items-center p-6">{s.visual()}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- step visuals: drawn from what the product really does ---------- */

function SignVisual() {
  return (
    <div className="w-full max-w-[340px]">
      <div className="rounded-2xl bg-[#15191d] p-5 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Signature request</span>
          <span className="num text-[10px] text-cold">0 gas</span>
        </div>
        <SignMessage className="mt-4 rounded-xl bg-black/40 p-4" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <span className="num rounded-full py-2 text-center text-[11px] uppercase tracking-[0.1em] text-ink-3 ring-1 ring-white/10">Cancel</span>
          <span className="num rounded-full bg-cold py-2 text-center text-[11px] uppercase tracking-[0.1em] text-[var(--accent-ink)]">Sign</span>
        </div>
      </div>
      <p className="mt-5 text-center text-[13px] text-ink-3">What your wallet shows. A signature, not a transaction: no gas, nothing moves.</p>
    </div>
  );
}

function DepositVisual() {
  const from = ["Bitcoin", "cbBTC · Base", "cbBTC · Ethereum", "WBTC · Ethereum", "WETH · Base"];
  return (
    <div className="relative grid w-full max-w-[420px] grid-cols-[1fr_auto_1fr] items-center gap-4">
      <ul className="space-y-2">
        {from.map((c, i) => (
          <li key={c} className="num flex items-center gap-2 text-[12px] text-ink-2" style={{ animation: `rise .6s ${i * 90}ms both` }}>
            <span className="dot dot-hot" style={{ opacity: 0.5 + i * 0.08 }} />
            {c}
          </li>
        ))}
      </ul>
      <svg width="80" height="190" viewBox="0 0 80 190" aria-hidden="true">
        {from.map((_, i) => (
          <path key={i} d={`M0 ${12 + i * 33} C 40 ${12 + i * 33}, 40 95, 80 95`} fill="none" stroke="url(#dv)" strokeWidth="1.2" strokeDasharray="3 5">
            <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1.2s" repeatCount="indefinite" />
          </path>
        ))}
        <defs>
          <linearGradient id="dv" x1="0" x2="1">
            <stop offset="0" stopColor="var(--heat)" />
            <stop offset="1" stopColor="var(--cold)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="rounded-2xl bg-[#11191c] p-4 ring-1 ring-cold/30">
        <span className="dot dot-cold" />
        <div className="wide mt-3 text-[15px] font-semibold">Private balance</div>
        <div className="num mt-1 text-[11px] text-ink-3">held as cbBTC or WETH</div>
      </div>
    </div>
  );
}

function PayoutVisual() {
  const rows = ["Deposit received", "Supplied to the pooled position", "USDC borrowed in the next batch", "Random wait", "USDC in your wallet"];
  return (
    <ol className="w-full max-w-[360px]">
      {rows.map((r, i) => (
        <li key={r} className="relative flex items-center gap-4 pb-5 last:pb-0" style={{ animation: `rise .6s ${i * 160}ms both` }}>
          {i < rows.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-gradient-to-b from-cold/60 to-cold/10" />}
          <span className={i === rows.length - 1 ? "dot dot-cold breathe" : "dot dot-cold"} style={{ width: 11, height: 11 }} />
          <span className={`text-[15px] ${i === rows.length - 1 ? "text-cold" : "text-ink-2"}`}>{r}</span>
        </li>
      ))}
    </ol>
  );
}

function ManageVisual() {
  return (
    <div className="w-full max-w-[360px] space-y-3">
      {[
        ["Repay", "in USDC from six chains"],
        ["Borrow more or withdraw", "within 60% of your collateral"],
        ["Eject", "to a Morpho position at your own wallet"],
      ].map(([a, b], i) => (
        <div key={a} className={`flex items-center justify-between rounded-2xl px-5 py-4 ring-1 ${i === 2 ? "bg-[#11191c] ring-cold/40" : "bg-[#15191d] ring-white/10"}`} style={{ animation: `rise .6s ${i * 140}ms both` }}>
          <div>
            <div className="wide text-[15px] font-semibold">{a}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{b}</div>
          </div>
          <span className={i === 2 ? "text-cold" : "text-ink-3"}>→</span>
        </div>
      ))}
    </div>
  );
}
