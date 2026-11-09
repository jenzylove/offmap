"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ErrorLine } from "@/components/Bits";
import { borrowStage, DepositPanel, useOneClick, type Stage } from "@/components/DepositPanel";
import { agent, agentConfigured, type PositionResp } from "@/lib/agent";
import { short } from "@/lib/format";
import { fetchTokens } from "@/lib/oneclick";
import { evmProvider, useSession } from "@/lib/session";
import { useLive } from "@/lib/useLive";
import { BorrowSetup, type StartedDeposit } from "./BorrowSetup";
import { LoanView } from "./LoanView";

const STEPS = ["Connect", "Sign in", "Set up", "Deposit", "Your loan"];
const DKEY = "offmap.deposit";

function Stepper({ current }: { current: number }) {
  return (
    <div className="mb-12">
      {/* compact on phones */}
      <div className="md:hidden">
        <div className="flex items-baseline justify-between">
          <span className="num text-[12px] text-cold">
            Step {current + 1} of {STEPS.length}
          </span>
          <span className="text-[13px] text-ink-2">{current < STEPS.length - 1 ? `Next: ${STEPS[current + 1]}` : ""}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1 rounded-full transition-colors duration-500 ${i < current ? "bg-cold/70" : i === current ? "bg-cold" : "bg-white/10"}`} />
          ))}
        </div>
      </div>
      <ol className="hidden grid-cols-5 gap-3 md:grid" aria-label="Progress">
        {STEPS.map((s, i) => {
          const done = i < current;
          const on = i === current;
          return (
            <li key={s} aria-current={on ? "step" : undefined} className="min-w-0">
              <span className={`block h-[3px] rounded-full transition-colors duration-500 ${done ? "bg-cold/70" : on ? "bg-cold shadow-[0_0_14px_var(--cold)]" : "bg-white/10"}`} />
              <div className="mt-3 flex items-center gap-2">
                <span className={`num text-[11px] ${on ? "text-cold" : done ? "text-ink-2" : "text-ink-3"}`}>{done ? "✓" : String(i + 1).padStart(2, "0")}</span>
                <span className={`truncate text-[14px] ${on ? "text-ink" : done ? "text-ink-2" : "text-ink-3"}`}>{s}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-10">
      <h1 className="display rise text-[clamp(36px,5.4vw,72px)]">{title}</h1>
      {children && <div className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-2">{children}</div>}
    </div>
  );
}

function Shell({ step, children }: { step: number; children: ReactNode }) {
  return (
    <section className="gutter relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_60%_80%_at_70%_0%,rgba(127,233,255,0.07),transparent_70%)]" />
      <div className="wrap pb-28 pt-28 md:pt-36">
        <Stepper current={step} />
        <div key={step} className="rise">
          {children}
        </div>
      </div>
    </section>
  );
}

const BORROW_STAGES: Stage[] = [
  { key: "wait", label: "Waiting for your deposit", hint: "Send the amount to the address. This updates by itself." },
  { key: "in", label: "Deposit received", hint: "Seen on its chain. Converting it into your private balance." },
  { key: "supply", label: "Supplied to the pooled position", hint: "Joining the next batch on Morpho." },
  { key: "borrow", label: "USDC borrowed", hint: "Borrowing your USDC from Morpho in this batch." },
  { key: "paid", label: "Paid to your wallet", hint: "Paying out in round sized pieces after a random wait." },
];

function DepositStep({ d, positions, onLoan, onReset }: { d: StartedDeposit; positions: PositionResp["positions"] | undefined; onLoan: () => void; onReset: () => void }) {
  const oc = useOneClick(d.depositAddress);
  const s = oc.status?.status ?? "NOT_FOUND";
  const stage = borrowStage(s, positions, d.depositAddress, d.startedAt || null);
  const failed = ["REFUNDED", "FAILED"].includes(s)
    ? "This deposit could not be used and is going back to your refund address."
    : s === "INCOMPLETE_DEPOSIT"
      ? "Less than the quoted amount arrived. Send the rest or wait for a refund."
      : null;
  const hasLoan = positions?.some((p) => BigInt(p.debt) > 0n || BigInt(p.collateral) > 0n);
  return (
    <>
      <StepHead title="Send your deposit.">Your deposit goes into a private balance through NEAR Intents. From there it joins the next batch, and your USDC follows.</StepHead>
      <DepositPanel
        depositAddress={d.depositAddress}
        memo={d.depositMemo}
        amountLabel={d.label || undefined}
        deadline={d.deadline}
        stages={BORROW_STAGES}
        stage={stage}
        failed={failed}
        oneclick={oc}
      />
      <div className="mt-12 flex flex-wrap gap-3 rule-t pt-8">
        {(stage >= 3 || hasLoan) && (
          <button className="btn btn-primary" onClick={onLoan}>
            Go to your loan
          </button>
        )}
        <button className="btn" onClick={onReset}>
          {stage >= 4 ? "Done" : "Start a different loan"}
        </button>
      </div>
    </>
  );
}

export function AppFlow() {
  const s = useSession();
  const tokens = useLive(fetchTokens, [], 300_000);
  const pos = useLive(async () => (s.token ? agent<PositionResp>("/position", { token: s.token, timeoutMs: 30_000 }) : null), [s.token], 10_000);
  const [started, setStarted] = useState<StartedDeposit | null>(null);
  const [hasWallet, setHasWallet] = useState(true);
  useEffect(() => setHasWallet(!!evmProvider()), []);

  // resume a deposit from this tab, or from a ?deposit= link
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DKEY);
      const q = new URLSearchParams(window.location.search).get("deposit");
      const saved = raw ? (JSON.parse(raw) as StartedDeposit) : null;
      if (q) setStarted(saved?.depositAddress === q ? saved : { depositAddress: q, label: "", startedAt: 0, cohort: "" });
      else if (saved) setStarted(saved);
    } catch {
      /* storage blocked */
    }
  }, []);

  const start = useCallback((d: StartedDeposit) => {
    setStarted(d);
    try {
      sessionStorage.setItem(DKEY, JSON.stringify(d));
    } catch {
      /* storage blocked */
    }
    const u = new URL(window.location.href);
    u.searchParams.set("deposit", d.depositAddress);
    window.history.replaceState(null, "", u.toString());
  }, []);
  const clear = useCallback(() => {
    setStarted(null);
    try {
      sessionStorage.removeItem(DKEY);
    } catch {
      /* storage blocked */
    }
    window.history.replaceState(null, "", "/app");
  }, []);

  // the agent forgot this session: keep the wallet, ask for a new signature
  const expired = !!pos.error && /sign in first/i.test(pos.error);
  useEffect(() => {
    if (expired) s.expire();
  }, [expired, s]);

  if (!s.ready) return <Shell step={0}>{null}</Shell>;

  /* 1. connect */
  if (!s.owner)
    return (
      <Shell step={0}>
        <StepHead title="Connect your wallet.">
          Any browser wallet that works with Ethereum or Base, such as MetaMask, Rabby or Coinbase Wallet. Your loan belongs to this wallet, and it is where an eject would send your position.
        </StepHead>
        <div className="flex flex-wrap items-center gap-4">
          <button className="btn btn-primary" disabled={s.busy} onClick={() => void s.connect()} data-testid="connect">
            {s.busy ? "Opening your wallet…" : "Connect wallet"}
          </button>
          <span className="text-[14px] text-ink-3">Connecting only shares your address. Nothing is signed yet.</span>
        </div>
        {!hasWallet && (
          <p className="mt-6 max-w-xl text-[15px] text-ink-2">
            No browser wallet found in this browser. Install one such as{" "}
            <a className="ink-link" href="https://rabby.io" target="_blank" rel="noreferrer">
              Rabby
            </a>{" "}
            or{" "}
            <a className="ink-link" href="https://metamask.io" target="_blank" rel="noreferrer">
              MetaMask
            </a>
            , then come back.
          </p>
        )}
        {s.error && (
          <div className="mt-6">
            <ErrorLine>{s.error}</ErrorLine>
          </div>
        )}
        <Ahead />
      </Shell>
    );

  const wallet = s.owner.kind === "evm" ? s.owner.address : s.owner.accountId;

  /* 2. sign in */
  if (!s.token)
    return (
      <Shell step={1}>
        <StepHead title="Sign in with one signature.">Free, no gas, and it moves nothing. It proves to the Offmap agent that this wallet is yours, so it can open your private ledger.</StepHead>
        <div className="max-w-xl rounded-[24px] p-6 ring-1 ring-white/10">
          <div className="flex items-center justify-between gap-3">
            <span className="eyebrow">Connected</span>
            <span className="num flex items-center gap-2 text-[13px] text-ink">
              <span className="dot dot-off" />
              {short(wallet, 8, 6)}
            </span>
          </div>
          <div className="mt-5 rule-t pt-5">
            <div className="eyebrow">Your wallet will show</div>
            <div className="num mt-2 text-[13px] text-ink-2">offmap:auth:&lt;random nonce&gt;:&lt;expiry time&gt;</div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn btn-primary" disabled={s.busy || !agentConfigured} onClick={() => void s.signInEvm()} data-testid="sign-in">
              {s.busy ? "Waiting for your wallet…" : "Sign in"}
            </button>
            <button className="btn" onClick={s.signOut}>
              Use another wallet
            </button>
          </div>
        </div>
        {(s.error || s.note) && (
          <div className="mt-6 max-w-xl">
            <ErrorLine>{s.error ?? s.note}</ErrorLine>
          </div>
        )}
      </Shell>
    );

  /* waiting for the private ledger */
  if (!pos.data)
    return (
      <Shell step={2}>
        {pos.error && !expired ? (
          <>
            <StepHead title="The agent did not answer.">Your session is open, but the private ledger could not be read just now.</StepHead>
            <ErrorLine>{pos.error}</ErrorLine>
            <button className="btn mt-6" onClick={pos.reload}>
              Try again
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3 py-20 text-ink-2">
            <span className="h-4 w-4 rounded-full border-2 border-cold border-t-transparent spin" />
            <span className="num text-[13px]">Opening your private ledger…</span>
          </div>
        )}
      </Shell>
    );

  const positions = pos.data.positions;
  const loans = positions.filter((p) => BigInt(p.debt) > 0n || BigInt(p.collateral) > 0n);
  const pendingDeposit = positions.flatMap((p) => p.pending.filter((x) => x.kind === "deposit"))[0];

  /* 4. deposit in progress */
  const live = started ?? (loans.length === 0 && pendingDeposit ? { depositAddress: pendingDeposit.depositAddress, label: "", startedAt: 0, cohort: "" } : null);
  if (live)
    return (
      <Shell step={3}>
        <DepositStep d={live} positions={positions} onLoan={clear} onReset={clear} />
      </Shell>
    );

  /* 5. your loan */
  if (loans.length)
    return (
      <Shell step={4}>
        <StepHead title="Your loan.">
          Read from the private ledger for your signature only. Morpho and every explorer see one pooled borrower, never you.
        </StepHead>
        <div className="space-y-24">
          {loans.map((p) => (
            <LoanView key={p.cohort} p={p} token={s.token!} tokens={tokens.data ?? []} wallet={s.owner?.kind === "evm" ? s.owner.address : null} reload={pos.reload} />
          ))}
        </div>
        <p className="num mt-12 text-[11px] text-ink-3">Refreshes every 10 seconds from your agent session.</p>
      </Shell>
    );

  /* 3. set up a new loan */
  return (
    <Shell step={2}>
      <StepHead title="Set up your loan.">Pick your collateral, how much to deposit and how much USDC to borrow. You will see your liquidation price before anything is sent.</StepHead>
      <BorrowSetup token={s.token} wallet={wallet} tokens={tokens.data ?? []} tokensError={tokens.error} onStarted={start} />
    </Shell>
  );
}

function Ahead() {
  return (
    <div className="mt-20 rule-t pt-10">
      <div className="eyebrow mb-6">What happens next</div>
      <ol className="grid gap-6 md:grid-cols-4">
        {[
          ["Sign in", "One free signature."],
          ["Set up", "Collateral, amount, USDC to borrow."],
          ["Deposit", "From any chain, to a one time address."],
          ["Your loan", "USDC arrives. Only you can see the loan."],
        ].map(([t, d], i) => (
          <li key={t} className="text-[14px]">
            <span className="num text-[11px] text-ink-3">{String(i + 2).padStart(2, "0")}</span>
            <div className="mt-1 text-ink">{t}</div>
            <div className="text-ink-3">{d}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
