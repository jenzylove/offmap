import type { ReactNode } from "react";

/** Numbered section heading: a sheet number, a name, a big expanded title. */
export function SectionHead({ n, kicker, title, children }: { n: string; kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-4">
        <span className="num text-[12px] text-cold">{n}</span>
        <span className="h-px w-10 bg-[var(--rule)]" />
        <span className="eyebrow">{kicker}</span>
      </div>
      <h2 className="display mt-6 max-w-5xl text-[clamp(34px,5.6vw,80px)]">{title}</h2>
      {children && <div className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2 md:text-[19px]">{children}</div>}
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

/** A label / value pair laid out on a ruled line. */
export function Row({ k, v, href, sub }: { k: ReactNode; v: ReactNode; href?: string; sub?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 rule-t py-3">
      <div className="text-[14px] text-ink-2">
        {k}
        {sub && <div className="num mt-0.5 text-[11px] text-ink-3">{sub}</div>}
      </div>
      <div className="num min-w-0 max-w-[60vw] text-right text-[14px] text-ink sm:max-w-none">
        {href ? (
          <a className="ink-link break-all" href={href} target="_blank" rel="noreferrer">
            {v}
          </a>
        ) : (
          <span className="break-words">{v}</span>
        )}
      </div>
    </div>
  );
}

export function PageHead({ sheet, title, children }: { sheet: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pb-10 pt-32 md:pb-14 md:pt-40">
      <div className="eyebrow">{sheet}</div>
      <h1 className="display rise mt-5 max-w-5xl text-[clamp(38px,6.4vw,92px)]">{title}</h1>
      {children && <div className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2 md:text-[19px]">{children}</div>}
    </div>
  );
}

export function Source({ children }: { children: ReactNode }) {
  return <div className="num mt-3 text-[11px] leading-relaxed text-ink-3">{children}</div>;
}

/** Raw values live behind this. Closed by default. */
export function Details({ label = "Details", children, open = false }: { label?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group mt-6 rule-t" open={open}>
      <summary className="flex min-h-12 items-center justify-between gap-4 py-3">
        <span className="num text-[11px] uppercase tracking-[0.16em] text-ink-2 transition-colors group-hover:text-ink">{label}</span>
        <span className="faq-mark num text-[18px] text-ink-3">+</span>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}
