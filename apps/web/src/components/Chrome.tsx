"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { REPO_URL } from "@/lib/config";

const NAV = [
  { href: "/app", label: "Borrow" },
  { href: "/app/position", label: "Your view" },
  { href: "/hunter", label: "Hunter view" },
  { href: "/proof", label: "Proof" },
  { href: "/eject", label: "Eject" },
];

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
      <circle cx="16" cy="16" r="3.2" fill="var(--accent)" />
      <path d="M16 0v6M16 26v6M0 16h6M26 16h6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") setTheme(t);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("offmap.theme", next);
    } catch {
      /* storage blocked */
    }
    setTheme(next);
  };
  return (
    <button
      onClick={flip}
      className="grid h-11 w-11 place-items-center text-ink-2 transition-colors hover:text-accent"
      aria-label={theme === "dark" ? "Switch to chart paper (light)" : "Switch to night survey (dark)"}
      title={theme === "dark" ? "Chart paper" : "Night survey"}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </svg>
    </button>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="gutter sticky top-0 z-40 rule-b bg-paper/85 backdrop-blur-md">
      <div className="wrap flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="Offmap home">
          <Mark />
          <span className="font-serif text-[23px] tracking-tight" style={{ fontVariationSettings: '"opsz" 72' }}>
            Offmap
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const on = n.href === "/app" ? path === "/app" : path?.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`num px-3 py-2 text-[12px] uppercase tracking-[0.1em] transition-colors ${on ? "text-accent" : "text-ink-2 hover:text-ink"}`}
              >
                {n.label}
              </Link>
            );
          })}
          <ThemeToggle />
        </nav>
        <div className="flex items-center md:hidden">
          <ThemeToggle />
          <button className="grid h-11 w-11 place-items-center" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d={open ? "M5 5l14 14M19 5L5 19" : "M3 7h18M3 12h18M3 17h12"} stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="wrap pb-4 md:hidden" aria-label="Main mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="num flex min-h-11 items-center rule-t text-[13px] uppercase tracking-[0.1em] text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="gutter relative rule-t">
      <div className="wrap grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Mark size={26} />
            <span className="font-serif text-[28px]">Offmap</span>
          </div>
          <p className="mt-4 max-w-sm text-ink-2">Borrow off the map. Private loans on real Morpho liquidity, with an exit that works without us.</p>
          <p className="num mt-6 text-[12px] text-ink-3">Built at NEAR HACKATHON, November 2026. Unaudited hackathon build.</p>
        </div>
        <div>
          <div className="eyebrow mb-3">Sheets</div>
          <ul className="space-y-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link className="ink-link" href={n.href}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-3">Source</div>
          <ul className="space-y-2">
            <li>
              <a className="ink-link" href={REPO_URL} target="_blank" rel="noreferrer">
                github.com/jenzylove/offmap
              </a>
            </li>
            <li>
              <a className="ink-link" href="https://nearhackathon.com" target="_blank" rel="noreferrer">
                NEAR HACKATHON
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
