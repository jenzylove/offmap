import Link from "next/link";
import { Contours } from "@/components/Contours";
import { LegendItem, SectionHead } from "@/components/Bits";
import { LiveCount } from "@/components/LiveCount";
import { WorldPanel } from "@/components/WorldPanel";
import { YouPanel } from "@/components/YouPanel";
import { PROOFS } from "@/lib/proofs";

const ROUTE = [
  {
    k: "A",
    t: "Deposit from any chain",
    d: "Send ETH, BTC, SOL or another listed asset from the chain you hold it on. NEAR Intents converts it and lands it in a private balance, not in a public wallet tied to you.",
  },
  {
    k: "B",
    t: "Join a pooled position",
    d: "Your collateral joins a capped cohort on Morpho Blue on Base. Morpho's existing lenders fund the loan. The market sees one borrower per cohort, never you.",
  },
  {
    k: "C",
    t: "A private ledger in sealed hardware",
    d: "Your collateral, debt and liquidation price live only inside an agent running in sealed hardware. If your loan gets unhealthy it sells a little of your collateral privately. No public liquidation names you.",
  },
  {
    k: "D",
    t: "A solvency proof after every batch",
    d: "The agent publishes cohort totals, the reserve and a salted Merkle root of every position to a NEAR contract. Your note proves your loan is counted. Nobody else can confirm it.",
  },
  {
    k: "E",
    t: "Eject whenever you want",
    d: "Your latest note moves your share into a Morpho position at your own wallet, in one transaction, through the contract. It works even if the agent is down. You give up privacy to get out, and you never need anyone's permission.",
  },
];

const TRUST = [
  ["You trust the sealed agent while it runs", "The agent in sealed hardware runs the pooled positions and holds the private balance, so while it is up you rely on that hardware and its approved code. If it stops, eject works through the contract without it."],
  ["The operator can ship new code", "Agent updates go through the hosting dashboard and keep the same keys. Every update changes the attested code hash, and the proof page and the judge checks compare it with the one approved on chain, so a swap shows up in public."],
  ["Privacy grows with volume", "With few users, the crowd you hide in is small. The leak study on the proof page shows the real number, not a promise."],
  ["Cohort positions are public", "Each pooled position's total size and health are visible by design. Individual loans inside it are not."],
  ["Losses can be shared inside a cohort", "If a private liquidation cannot cover a loan, the gap comes from that borrower first, then the cohort reserve, then pro rata inside that cohort only. Other cohorts are never touched. You see this before every borrow."],
  ["Few markets at launch", "One Morpho market per cohort on Base: cbBTC/USDC and WETH/USDC."],
  ["Unaudited hackathon build", "Per loan and per cohort caps are enforced in code and shown on the site. Borrow only what you are willing to test with."],
];

const FAQ = [
  ["Who lends me the money?", "Morpho Blue's existing lenders on Base. Offmap borrows from the same markets everyone uses, through a few pooled positions. It does not recruit lenders or run its own pool."],
  ["Who can see my loan?", "You. The agent holds the ledger inside sealed hardware and shows your position only to a session you open with your own wallet signature. Morpho, explorers and APIs see only the cohort totals."],
  ["What is my liquidation price, and who knows it?", "Your loan is privately liquidated at 70% loan to value, back down to 60%. You see the exact price on your view. Nobody else can, because no public position carries your numbers."],
  ["What does it cost?", "Morpho's live borrow rate plus 1% a year. The 1% funds the cohort reserve that absorbs losses before anyone else does. The full rate shows before you borrow."],
  ["What if Offmap disappears?", "Eject. Paste your latest note, sign two Morpho authorizations with your own wallet, and the NEAR contract moves your share into a Morpho position you own. No agent needed."],
  ["Can I check the numbers myself?", "Yes. The proof page links every statement, the contract and the real mainnet transactions. Your note's Merkle proof checks against the root stored on NEAR, right in your browser."],
  ["Is it live?", "Yes, on mainnet with small amounts. The first private loan ran end to end: a deposit from NEAR, a pooled Morpho position on Base, and a payout to the borrower's own wallet after a random delay (see Proof). The agent runs in Intel TDX on Phala and the contract offmapfi.near only signs for an agent whose attestation it checked. Nothing on this site is simulated."],
];

export default function Home() {
  return (
    <>
      {/* (01) Hero */}
      <section className="gutter relative overflow-hidden">
        <Contours seed={11} peaks={5} className="opacity-90" />
        <div className="wrap relative pb-16 pt-14 md:pb-24 md:pt-24">
          <div className="flex items-center justify-between">
            <div className="num text-[13px] text-accent">(01)</div>
            <div className="eyebrow hidden sm:block">Sheet 01 · Base 8453 · Morpho Blue</div>
          </div>
          <h1 className="display rise mt-6 max-w-5xl text-[clamp(48px,9vw,132px)]">
            Borrow without becoming a <em className="italic-serif text-accent">target.</em>
          </h1>
          <div className="mt-8 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
            <p className="max-w-xl text-[18px] text-ink-2 md:text-[20px]">
              Borrow USDC against your crypto on real Morpho liquidity. Nobody can see your loan, your collateral or the price where you get liquidated.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/app" className="btn btn-primary">
                Borrow off the map
              </Link>
              <Link href="/hunter" className="btn">
                See what a hunter sees
              </Link>
            </div>
          </div>

          <div className="mt-16 grid gap-12 rule-t pt-8 lg:grid-cols-2 lg:gap-0">
            <div className="lg:pr-10">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="font-serif text-[28px]">What the world sees</h3>
                <span className="eyebrow">live · Base</span>
              </div>
              <WorldPanel compact />
            </div>
            <div className="lg:rule-l lg:pl-10">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="font-serif text-[28px]">What you see</h3>
                <span className="eyebrow">private · sealed</span>
              </div>
              <YouPanel />
            </div>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 rule-t pt-5">
            <span className="eyebrow">Legend</span>
            <LegendItem swatch={<span className="block h-2 w-6 bg-accent shimmer" />}>Public liquidation levels, hot where debt piles up</LegendItem>
            <LegendItem swatch={<span className="dot dot-hot" />}>An Offmap cohort, one public borrower for many</LegendItem>
            <LegendItem swatch={<span className="block h-3 w-5 border border-dashed border-[var(--ink-3)]" />}>Uncharted: your loan</LegendItem>
          </div>
        </div>
      </section>

      {/* (02) Problem */}
      <section className="gutter relative rule-t">
        <div className="wrap py-20 md:py-28">
          <SectionHead n="02" kicker="The problem" title={<>Public levels get hunted.</>}>
            On Morpho&apos;s two Base markets for cbBTC and WETH alone, <LiveCount /> sit on a public map right now. Anyone can read the exact price where each one gets liquidated.
          </SectionHead>

          <div className="mt-14 grid gap-0 md:ml-[220px] md:grid-cols-3">
            {[
              ["Your position is public", "On every lending market, anyone can read your size, your collateral and your liquidation price. Tools draw these as liquidation maps."],
              ["Levels get pushed", "Traders and bots read those maps and push price into the levels where liquidations cluster, then buy the forced selling."],
              ["Hiding your name is not enough", "Private accounts can hold loans today, but the position and its level stay public on the market. Hunters do not need your name. They need your level."],
            ].map(([t, d], i) => (
              <div key={t} className={`rule-t py-6 md:pr-8 ${i > 0 ? "md:rule-l md:pl-8" : ""}`}>
                <div className="num text-[12px] text-ink-3">0{i + 1}</div>
                <h3 className="mt-2 font-serif text-[26px] leading-tight">{t}</h3>
                <p className="mt-3 text-ink-2">{d}</p>
              </div>
            ))}
          </div>

          <blockquote className="mt-14 md:ml-[220px]">
            <p className="italic-serif max-w-3xl text-[clamp(24px,3vw,36px)] leading-snug">
              In 2025, one of the most watched traders on a public perps venue was reported &ldquo;hunted twice in one day&rdquo;, losing about $14.3M, and was later reported fully liquidated for about $99M.
            </p>
            <footer className="mt-4 max-w-2xl text-[14px] text-ink-3">
              As reported at the time. That case comes from perps, where the strongest public evidence is. Lending positions sit on the same kind of public map.
            </footer>
          </blockquote>
        </div>
      </section>

      {/* (03) How it works */}
      <section className="gutter relative overflow-hidden rule-t">
        <Contours seed={23} peaks={3} className="opacity-60" />
        <div className="wrap relative py-20 md:py-28">
          <SectionHead n="03" kicker="How it works" title={<>The route off the map.</>}>
            Five waypoints from your wallet to a private loan, and one exit that is always open.
          </SectionHead>

          <ol className="relative mt-16 md:ml-[220px]">
            <svg aria-hidden="true" className="absolute left-[15px] top-2 h-[calc(100%-16px)] w-2" preserveAspectRatio="none" viewBox="0 0 2 100">
              <line x1="1" y1="0" x2="1" y2="100" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            </svg>
            {ROUTE.map((r, i) => (
              <li key={r.k} className="relative grid grid-cols-[32px_1fr] gap-5 pb-12 last:pb-0 md:grid-cols-[32px_minmax(0,320px)_1fr] md:gap-10">
                <div className="relative z-10 grid h-8 w-8 place-items-center rounded-full border border-[var(--ink)] bg-paper num text-[12px]">
                  {r.k}
                </div>
                <div>
                  <div className="num text-[11px] uppercase tracking-[0.12em] text-ink-3">Waypoint {i + 1}</div>
                  <h3 className="mt-1 font-serif text-[28px] leading-tight">{r.t}</h3>
                </div>
                <p className="col-start-2 text-ink-2 md:col-start-3 md:pt-5">{r.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* (04) Proof */}
      <section className="gutter relative rule-t">
        <div className="wrap py-20 md:py-28">
          <SectionHead n="04" kicker="Proof" title={<>Already run, on chain.</>}>
            Each piece Offmap stands on was run for real before the product was built. Every line below links to the chain.
          </SectionHead>
          <div className="mt-14 md:ml-[220px]">
            {PROOFS.map((p) => (
              <div key={p.id} className="grid gap-4 rule-t py-7 md:grid-cols-[70px_1fr_minmax(0,260px)]">
                <div className="num text-[13px] text-accent">{p.id}</div>
                <div>
                  <h3 className="font-serif text-[24px] leading-tight">{p.title}</h3>
                  <p className="mt-2 text-[15px] text-ink-2">{p.what}</p>
                  <div className="num mt-3 text-[11px] uppercase tracking-[0.1em] text-ink-3">
                    {p.network} · {p.date} ·{" "}
                    <a className="ink-link" href={p.doc} target="_blank" rel="noreferrer">
                      write up
                    </a>
                  </div>
                </div>
                <div>
                  <div className="num text-[12px] text-good">{p.result}</div>
                  <ul className="mt-2 space-y-1.5">
                    {p.links.map((l) => (
                      <li key={l.href}>
                        <a className="num ink-link text-[13px]" href={l.href} target="_blank" rel="noreferrer">
                          {l.label} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
            <div className="rule-t pt-6">
              <Link className="ink-link num text-[13px] uppercase tracking-[0.1em]" href="/proof">
                Open the live proof sheet →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* (05) Trust */}
      <section className="gutter relative rule-t bg-paper-2/60">
        <div className="wrap py-20 md:py-28">
          <SectionHead n="05" kicker="What it asks you to trust" title={<>The fine print, in plain words.</>} />
          <dl className="mt-14 md:ml-[220px]">
            {TRUST.map(([t, d], i) => (
              <div key={t} className="grid gap-2 rule-t py-5 md:grid-cols-[48px_minmax(0,320px)_1fr] md:gap-8">
                <div className="num text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</div>
                <dt className="font-serif text-[21px] leading-snug">{t}</dt>
                <dd className="text-ink-2">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* (06) FAQ */}
      <section className="gutter relative rule-t">
        <div className="wrap py-20 md:py-28">
          <SectionHead n="06" kicker="Questions" title={<>Asked along the way.</>} />
          <div className="mt-14 md:ml-[220px]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rule-t">
                <summary className="flex min-h-14 items-center justify-between gap-6 py-4">
                  <span className="font-serif text-[22px] leading-snug">{q}</span>
                  <span className="faq-mark num text-[22px] text-accent">+</span>
                </summary>
                <p className="max-w-2xl pb-6 text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="gutter relative overflow-hidden rule-t">
        <Contours seed={41} peaks={4} strong />
        <div className="wrap relative py-24 text-center md:py-32">
          <h2 className="display mx-auto max-w-4xl text-[clamp(40px,7vw,104px)]">
            Take your loan <em className="italic-serif text-accent">off the map.</em>
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="/app" className="btn btn-primary">
              Start a private loan
            </Link>
            <Link href="/proof" className="btn">
              Check the proof
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
