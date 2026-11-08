import type { ReactNode } from "react";

/** Numbered section heading, like a sheet number on a survey atlas. */
export function SectionHead({ n, kicker, title, children }: { n: string; kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[180px_1fr] md:gap-10">
      <div className="flex items-baseline gap-3 md:block">
        <div className="num text-[13px] text-accent">({n})</div>
        <div className="eyebrow md:mt-2">{kicker}</div>
      </div>
      <div>
        <h2 className="display text-[clamp(36px,5.2vw,72px)]">{title}</h2>
        {children && <div className="mt-5 max-w-2xl text-[17px] text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

/** A plain statement of what is not live yet. Never a fake number. */
export function NotLive({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3 border-l-2 border-[var(--ink-3)] py-1 pl-4">
      <div>
        <div className="num text-[12px] uppercase tracking-[0.12em] text-ink-2">{title}</div>
        {children && <div className="mt-1 text-[15px] text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-[var(--bad)] py-1 pl-4 text-[15px] text-bad" role="alert">
      {children}
    </div>
  );
}

/** Legend row: a swatch and a meaning, like the key on a map. */
export function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-[13px] text-ink-2">
      <span className="grid w-6 place-items-center">{swatch}</span>
      <span>{children}</span>
    </div>
  );
}

/** A label / value pair laid out on a ruled line. */
export function Row({ k, v, href, sub }: { k: ReactNode; v: ReactNode; href?: string; sub?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 rule-t py-3">
      <div className="text-[14px] text-ink-2">
        {k}
        {sub && <div className="num mt-0.5 text-[11px] text-ink-3">{sub}</div>}
      </div>
      <div className="num min-w-0 text-right text-[15px] text-ink">
        {href ? (
          <a className="ink-link break-all" href={href} target="_blank" rel="noreferrer">
            {v}
          </a>
        ) : (
          v
        )}
      </div>
    </div>
  );
}

export function PageHead({ sheet, title, children }: { sheet: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pb-10 pt-14 md:pb-14 md:pt-20">
      <div className="eyebrow">{sheet}</div>
      <h1 className="display mt-4 text-[clamp(40px,6.5vw,88px)]">{title}</h1>
      {children && <div className="mt-6 max-w-2xl text-[18px] text-ink-2">{children}</div>}
    </div>
  );
}

export function Source({ children }: { children: ReactNode }) {
  return <div className="num mt-3 text-[11px] leading-relaxed text-ink-3">{children}</div>;
}
