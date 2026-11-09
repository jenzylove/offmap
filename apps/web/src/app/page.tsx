import Link from "next/link";
import { SectionHead } from "@/components/Bits";
import { Reveal } from "@/components/Reveal";
import { BeforeAfter } from "@/components/landing/BeforeAfter";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Faq, FocusList, type FocusItem } from "@/components/landing/Lists";
import { ProblemNumber } from "@/components/landing/Problem";

const TRUST: FocusItem[] = [
  {
    t: "No public record names your loan.",
    d: "Morpho, the Base explorers and the NEAR contract hold only pooled totals and a salted fingerprint of every loan. Nobody can open it by guessing amounts.",
    href: "/proof#solvency",
  },
  {
    t: "The agent runs in sealed hardware.",
    d: "The ledger lives inside an Intel TDX machine. The NEAR contract only works with an agent whose hardware report matches the approved code, and anyone can fetch that report.",
    href: "/proof#hardware",
  },
  {
    t: "Every batch is published and checked.",
    d: "After each batch the agent writes the pooled totals and the reserve to NEAR. You can hold them up against the real Morpho position on Base at any time.",
    href: "/proof#solvency",
  },
  {
    t: "You can leave without asking anyone.",
    d: "Your latest note is all you need. The NEAR contract moves your share into a Morpho position at your own wallet, even if the agent is offline.",
    href: "/proof#contract",
  },
  {
    t: "We measure how linkable we are.",
    d: "We run the same tricks a snoop would on our own deposits and payouts, and publish the result as it is.",
    href: "/proof#leak",
  },
];

const NEAR: FocusItem[] = [
  {
    tag: "NEAR Intents",
    t: "Any chain in, any chain out.",
    d: "Deposits from Bitcoin, Ethereum, Solana and other chains are converted through NEAR Intents into a private balance. Your USDC leaves the same way, to the chain you pick.",
    href: "/proof",
    cta: "See it live",
  },
  {
    tag: "Chain signatures",
    t: "A NEAR account holds the Morpho position.",
    d: "No private key exists for the pooled position on Base. NEAR's signer network signs each Morpho call, and only when the contract allows it.",
    href: "/proof#hardware",
    cta: "See it live",
  },
  {
    tag: "offmapfi.near",
    t: "A contract that checks the hardware.",
    d: "The contract signs only for an agent whose Intel TDX attestation matches approved code. It also signs your eject, with or without the agent.",
    href: "/proof#contract",
    cta: "See it live",
  },
];

const FAQ: [string, string][] = [
  ["Who lends me the money?", "Morpho Blue's existing lenders on Base. Offmap borrows from the same markets everyone uses, through one pooled position per market. It does not run a pool of its own."],
  ["Who can see my loan?", "Only you. The agent keeps the ledger inside sealed hardware and shows your loan only to a session opened with your own wallet signature. Morpho, explorers and APIs see the pooled total."],
  ["When does my loan get liquidated?", "If your loan reaches 70% of your collateral's value, Offmap privately sells just enough collateral to bring it back to 60%. Your loan page shows the exact price. Nobody else can see it."],
  ["What does it cost?", "Morpho's live borrow rate plus 1% a year. The 1% funds a reserve that absorbs losses first. You see the full rate before you borrow."],
  ["What if Offmap disappears?", "Eject. Paste your latest note, sign two Morpho authorizations with your wallet, and the NEAR contract moves your share into a Morpho position you own. No agent needed."],
  ["How private is it today?", "Privacy grows with every user. While a pooled position holds only a few loans, its total says a lot about each one. The proof page publishes our own leak study with the real numbers."],
  ["What if a private liquidation cannot cover a loan?", "The gap comes from that borrower first, then the reserve, then shared across that one pooled position only. Other positions are never touched."],
  ["Is it audited?", "No. This is a hackathon build running on mainnet with caps on every loan. Borrow only what you are willing to test with."],
];

function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`gutter relative rule-t ${className}`}>
      <div className="wrap py-24 md:py-36">{children}</div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Hero />

      <Section id="problem">
        <Reveal>
          <SectionHead n="01" kicker="The problem" title="Public loans are targets." />
        </Reveal>
        <Reveal className="mt-14">
          <ProblemNumber />
        </Reveal>
      </Section>

      <Section id="how">
        <Reveal>
          <SectionHead n="02" kicker="How it works" title="Four steps off the map.">
            From your wallet to USDC in your hand, with nothing public tied to you on the way.
          </SectionHead>
        </Reveal>
        <HowItWorks />
      </Section>

      <Section id="see">
        <Reveal>
          <SectionHead n="03" kicker="Before and after" title="Same loan. Two views.">
            Read live from Base and from your own session. Flip between them.
          </SectionHead>
        </Reveal>
        <BeforeAfter />
      </Section>

      <Section id="trust">
        <Reveal>
          <SectionHead n="04" kicker="Why you can trust it" title="Promises you can check." />
        </Reveal>
        <FocusList items={TRUST} />
      </Section>

      <Section id="near">
        <Reveal>
          <SectionHead n="05" kicker="Built on NEAR" title="Three NEAR pieces do the heavy lifting." />
        </Reveal>
        <FocusList items={NEAR} tone="near" />
      </Section>

      <Section id="faq">
        <Reveal>
          <SectionHead n="06" kicker="Questions" title="Asked along the way." />
        </Reveal>
        <Faq items={FAQ} />
      </Section>

      <section className="gutter relative overflow-hidden rule-t">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(127,233,255,0.16)_0%,rgba(127,233,255,0.04)_40%,transparent_70%)]" />
        <div className="wrap relative py-32 text-center md:py-44">
          <Reveal>
            <div className="flex items-center justify-center gap-4">
              <span className="num text-[12px] text-cold">07</span>
              <span className="h-px w-10 bg-[var(--rule)]" />
              <span className="eyebrow">Go cold</span>
            </div>
            <h2 className="display mx-auto mt-8 max-w-5xl text-[clamp(40px,7.5vw,112px)]">
              Take your loan <span className="text-cold-grad">off the map.</span>
            </h2>
            <p className="mx-auto mt-7 max-w-lg text-[18px] text-ink-2">Connect a wallet, sign once, deposit. The rest happens where nobody can watch.</p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link href="/app" className="btn btn-primary">
                Start borrowing
              </Link>
              <Link href="/proof" className="btn">
                Check the proof
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
