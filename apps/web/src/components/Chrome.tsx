"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONTRACT_ID, REPO_URL, nearblocksAddr } from "@/lib/config";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";

const NAV = [
  { href: "/app", label: "Borrow" },
  { href: "/hunter", label: "Hunter view" },
  { href: "/proof", label: "Proof" },
  { href: "/eject", label: "Eject" },
];

/** Contour rings opened at one point: a hot point left behind on the map, the cold center kept. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 5a11 11 0 1 1 -10.4 7.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 10a6 6 0 1 1 -5.6 3.9" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.6" fill="var(--cold)" />
      <circle cx="6.6" cy="9.4" r="1.6" fill="var(--heat)" />
    </svg>
  );
}

/** One wallet state for the whole site: connect, then sign in, then your loan. */
export function WalletButton({ compact = false }: { compact?: boolean }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);

  if (!s.ready) return <div className="h-9 w-[132px]" aria-hidden="true" />;

  const addr = s.owner ? (s.owner.kind === "evm" ? short(s.owner.address, 6, 4) : s.owner.accountId) : null;

  if (!s.owner)
    return (
      <div className="relative">
        <button className="btn btn-primary btn-sm" disabled={s.busy} onClick={() => void s.signInEvm()} data-testid="nav-connect">
          {s.busy ? "Check your wallet" : "Connect wallet"}
        </button>
        {s.error && (
          <div className="glass absolute right-0 top-12 z-50 w-[280px] rounded-2xl p-4 text-[13px] text-ink-2" role="alert">
            {s.error}
          </div>
        )}
      </div>
    );

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-sm gap-2.5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="nav-wallet"
        title={s.token ? "Signed in" : "Connected, not signed in"}
      >
        <span className={s.token ? "dot dot-cold" : "dot dot-off"} />
        <span className="num normal-case tracking-normal">{addr}</span>
        {!compact && !s.token && <span className="text-ink-3">· locked</span>}
      </button>
      {open && (
        <div className="glass absolute right-0 top-12 z-50 w-[260px] rounded-2xl p-2">
          <div className="px-3 py-2">
            <div className="eyebrow">{s.token ? "Signed in" : "Connected"}</div>
            <div className="num mt-1 break-all text-[12px] text-ink">{s.owner.kind === "evm" ? s.owner.address : s.owner.accountId}</div>
          </div>
          {!s.token && (
            <button className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[14px] text-cold hover:bg-white/5" disabled={s.busy} onClick={() => void s.signInEvm()}>
              {s.busy ? "Check your wallet" : "Sign to open your loan"}
            </button>
          )}
          <Link href="/app" className="flex min-h-11 items-center rounded-xl px-3 text-[14px] hover:bg-white/5">
            Your loan
          </Link>
          <button className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[14px] text-ink-2 hover:bg-white/5" onClick={s.signOut}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3 md:px-6 md:pt-4">
      <div
        className={`pointer-events-auto mx-auto flex h-14 max-w-[1240px] items-center justify-between gap-3 rounded-full pl-4 pr-2 transition-all duration-500 md:pl-5 ${
          scrolled || open ? "glass shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]" : "border border-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="Offmap home">
          <Mark />
          <span className="wide text-[17px] font-semibold tracking-tight">Offmap</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const on = path === n.href || path?.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative rounded-full px-4 py-2 text-[14px] transition-colors ${on ? "bg-white/[0.06] text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <WalletButton compact />
          <button className="grid h-11 w-11 place-items-center md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 8h16M4 16h10"} stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="glass pointer-events-auto mx-auto mt-2 max-w-[1240px] rounded-3xl p-2 md:hidden" aria-label="Main mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="flex min-h-12 items-center rounded-2xl px-4 text-[16px] text-ink hover:bg-white/5">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

const FOOT = [
  {
    t: "Product",
    links: [
      { href: "/app", label: "Borrow USDC" },
      { href: "/app", label: "Your loan" },
      { href: "/eject", label: "Eject without us" },
    ],
  },
  {
    t: "See for yourself",
    links: [
      { href: "/hunter", label: "What hunters see" },
      { href: "/proof", label: "Live proof" },
      { href: nearblocksAddr(CONTRACT_ID), label: "The NEAR contract", ext: true },
    ],
  },
  {
    t: "Code and docs",
    links: [
      { href: REPO_URL, label: "Source on GitHub", ext: true },
      { href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`, label: "Architecture", ext: true },
      { href: `${REPO_URL}/blob/main/docs/BUILD_LOG.md`, label: "Build log", ext: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-10 overflow-hidden rule-t">
      <div className="gutter">
        <div className="wrap grid gap-12 pb-10 pt-16 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Mark size={28} />
              <span className="wide text-[20px] font-semibold">Offmap</span>
            </div>
            <p className="mt-5 max-w-xs text-[15px] text-ink-2">Private loans on public liquidity. Your loan stays cold while the market runs hot.</p>
            <div className="mt-6 flex items-center gap-3">
              <span className="heat-scale block h-1.5 w-40 rounded-full" />
            </div>
            <div className="num mt-2 flex w-40 justify-between text-[10px] uppercase tracking-[0.14em] text-ink-3">
              <span className="text-cold">you</span>
              <span className="text-heat">them</span>
            </div>
          </div>
          {FOOT.map((col) => (
            <div key={col.t}>
              <div className="eyebrow mb-4">{col.t}</div>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.ext ? (
                      <a className="text-[15px] text-ink-2 transition-colors hover:text-cold" href={l.href} target="_blank" rel="noreferrer">
                        {l.label} <span className="text-ink-3">↗</span>
                      </a>
                    ) : (
                      <Link className="text-[15px] text-ink-2 transition-colors hover:text-cold" href={l.href}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="gutter">
        <div className="wrap flex flex-wrap items-baseline justify-between gap-3 rule-t py-5 text-[13px] text-ink-3">
          <span>Built on NEAR, borrowing on Morpho Blue on Base. Made for NEAR HACKATHON, November 2026.</span>
          <span className="num">Live on mainnet</span>
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none select-none overflow-hidden">
        <div className="display footer-word whitespace-nowrap text-center leading-[0.78]">OFFMAP</div>
      </div>
      <style>{`
        .footer-word{font-size:clamp(64px,17vw,300px);font-weight:800;letter-spacing:-0.06em;
          background:linear-gradient(180deg,rgba(236,238,240,.10) 0%,rgba(127,233,255,.16) 45%,rgba(11,12,14,0) 92%);
          -webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:-0.12em}
      `}</style>
    </footer>
  );
}
