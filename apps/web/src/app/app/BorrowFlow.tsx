"use client";

import { useEffect, useMemo, useState } from "react";
import { DepositTracker } from "@/components/DepositTracker";
import { ErrorLine, NotLive, PageHead, Source } from "@/components/Bits";
import { agent, agentConfigured, AgentError, type BorrowQuoteResp } from "@/lib/agent";
import { AGENT_URL, COHORTS, LIQ_LTV, OPEN_LTV, SPREAD_APR, type CohortDef } from "@/lib/config";
import { pct, toUnits, usd } from "@/lib/format";
import { readLevels } from "@/lib/morpho";
import { addressLooksValid, CHAIN_NAMES, collateralAssets, fetchTokens, usdcTargets, type OneClickToken } from "@/lib/oneclick";
import { useLive } from "@/lib/useLive";
import { useSession } from "@/lib/session";

const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();

function LtvGauge({ ltv }: { ltv: number }) {
  const max = 0.9;
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const over = ltv > OPEN_LTV;
  return (
    <div className="relative mt-4 pb-9 pt-2">
      <div className="relative h-3 w-full bg-paper-3">
        <div className="absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: at(ltv), background: over ? "var(--bad)" : "var(--ink)" }} />
        <div className="absolute inset-y-[-6px] w-px bg-[var(--ink)]" style={{ left: at(OPEN_LTV) }} />
        <div className="absolute inset-y-[-6px] w-px bg-accent" style={{ left: at(LIQ_LTV) }} />
        <div className="absolute inset-y-[-6px] w-px bg-[var(--ink-3)]" style={{ left: at(0.86) }} />
      </div>
      <div className="num absolute top-6 -translate-x-1/2 text-[10px] text-ink-2" style={{ left: at(OPEN_LTV) }}>
        60% max
      </div>
      <div className="num absolute top-6 -translate-x-1/2 whitespace-nowrap text-[10px] text-accent" style={{ left: at(LIQ_LTV) }}>
        70% private
      </div>
      <div className="num absolute top-6 hidden -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-3 sm:block" style={{ left: at(0.86) }}>
        86% Morpho
      </div>
    </div>
  );
}

export function BorrowFlow() {
  const session = useSession();
  const tokens = useLive(fetchTokens, [], 120_000);
  const [cohort, setCohort] = useState<CohortDef>(COHORTS[0]!);
  const market = useLive(() => readLevels(cohort, 1), [cohort.id], 120_000);

  const collat = useMemo(() => (tokens.data ? collateralAssets(tokens.data) : []), [tokens.data]);
  const usdc = useMemo(() => (tokens.data ? usdcTargets(tokens.data) : []), [tokens.data]);

  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [borrow, setBorrow] = useState("");
  const [recvAsset, setRecvAsset] = useState("");
  const [recvAddr, setRecvAddr] = useState("");
  const [refundAddr, setRefundAddr] = useState("");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<(BorrowQuoteResp & { label?: string }) | null>(null);

  useEffect(() => {
    if (!assetId && collat.length) setAssetId((collat.find((t) => t.symbol === "ETH" && t.blockchain === "arb") ?? collat[0]!).assetId);
    if (!recvAsset && usdc.length) setRecvAsset(usdc[0]!.assetId);
  }, [collat, usdc, assetId, recvAsset]);

  // Resume tracking from ?deposit=
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("deposit");
    if (d) setQuote({ depositAddress: d });
  }, []);

  const asset: OneClickToken | undefined = collat.find((t) => t.assetId === assetId);
  const recv: OneClickToken | undefined = usdc.find((t) => t.assetId === recvAsset);
  const amt = Number(amount);
  const value = asset && amt > 0 ? amt * asset.price : 0;
  const b = Number(borrow);
  const ltv = value > 0 && b > 0 ? b / value : 0;
  const cohortPrice = market.data?.priceUsd ?? 0;
  const liqPrice = value > 0 && b > 0 && cohortPrice > 0 ? (cohortPrice * b) / (LIQ_LTV * value) : null;
  const rate = market.data ? market.data.borrowApy + SPREAD_APR : null;

  const amountUnits = asset ? toUnits(amount, asset.decimals) : null;
  const borrowUnits = toUnits(borrow, 6);
  const problems: string[] = [];
  if (!asset) problems.push("Pick what you deposit.");
  else if (!amountUnits) problems.push("Enter how much you deposit.");
  if (!borrowUnits) problems.push("Enter how much USDC to borrow.");
  if (ltv > OPEN_LTV) problems.push(`That is ${pct(ltv)} of your collateral. The most you can open at is 60%.`);
  if (!recv) problems.push("Pick where to receive USDC.");
  else if (!addressLooksValid(recv.blockchain, recvAddr)) problems.push(`Enter a valid ${chainName(recv.blockchain)} address to receive USDC.`);
  if (asset && !addressLooksValid(asset.blockchain, refundAddr)) problems.push(`Enter a ${chainName(asset.blockchain)} address for refunds.`);
  if (!accept) problems.push("Read and accept how losses are shared.");

  const submit = async () => {
    if (!asset || !recv || !amountUnits || !borrowUnits) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await agent<BorrowQuoteResp>("/quote/borrow", {
        method: "POST",
        token: session.token ?? undefined,
        timeoutMs: 45_000,
        body: JSON.stringify({
          cohort: cohort.id,
          depositAsset: asset.assetId,
          depositAmount: amountUnits.toString(),
          borrowUsdc: borrowUnits.toString(),
          receiveAsset: recv.assetId,
          receiveAddress: recvAddr.trim(),
          refundTo: refundAddr.trim(),
        }),
      });
      if (!r?.depositAddress) throw new Error("The agent answered without a deposit address.");
      setQuote({
        ...r,
        label: `${amount} ${asset.symbol} on ${chainName(asset.blockchain)}${r.collateralOut ? `, which lands as about ${r.collateralOut} ${cohort.collateralSymbol}` : ""}`,
      });
      const u = new URL(window.location.href);
      u.searchParams.set("deposit", r.depositAddress);
      window.history.replaceState(null, "", u.toString());
    } catch (e) {
      setErr(e instanceof AgentError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (quote) {
    return (
      <>
        <PageHead sheet="Sheet 02 · Borrow · Deposit" title={<>Send your collateral.</>}>
          Your deposit goes into a private balance through NEAR Intents. When it lands, your loan joins the next batch for the {cohort.label} cohort.
        </PageHead>
        <div className="rule-t pt-10">
          <DepositTracker depositAddress={quote.depositAddress} memo={quote.depositMemo} amountLabel={quote.label} deadline={quote.deadline} />
        </div>
        <button
          className="btn mt-12"
          onClick={() => {
            setQuote(null);
            window.history.replaceState(null, "", "/app");
          }}
        >
          Start another loan
        </button>
      </>
    );
  }

  return (
    <>
      <PageHead sheet="Sheet 02 · Borrow" title={<>Borrow off the map.</>}>
        Deposit from any chain, borrow USDC from Morpho&apos;s lenders, receive it where you like. Your loan never appears as your own position anywhere public.
      </PageHead>

      {!agentConfigured && (
        <div className="mb-10">
          <NotLive title="The Offmap agent is not live yet">
            You can plan a loan with live prices and limits below, but no deposit address can be issued until the agent is running. Nothing will be sent.
          </NotLive>
        </div>
      )}

      <div className="grid gap-14 lg:grid-cols-[1fr_380px]">
        <div>
          {/* 1 cohort */}
          <fieldset className="rule-t pt-6">
            <legend className="eyebrow float-left mb-4 w-full">1 · Cohort</legend>
            <div className="clear-both grid gap-0 sm:grid-cols-2">
              {COHORTS.map((c) => {
                const on = c.id === cohort.id;
                return (
                  <label key={c.id} className={`flex min-h-16 cursor-pointer items-center gap-4 border-b-2 py-3 pr-4 transition-colors ${on ? "border-accent" : "border-transparent hover:border-[var(--rule)]"}`}>
                    <input type="radio" name="cohort" className="sr-only" checked={on} onChange={() => setCohort(c)} />
                    <span className={on ? "dot dot-hot" : "dot dot-off"} />
                    <span>
                      <span className="block font-serif text-[24px] leading-tight">{c.label}</span>
                      <span className="num text-[11px] text-ink-3">Morpho Blue on Base · collateral held as {c.collateralSymbol}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* 2 deposit */}
          <fieldset className="mt-10 rule-t pt-6">
            <legend className="eyebrow float-left mb-4 w-full">2 · Deposit</legend>
            <div className="clear-both grid gap-6 sm:grid-cols-2">
              <label className="block">
                <span className="text-[13px] text-ink-2">Asset and chain</span>
                <select className="field" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!collat.length}>
                  {!collat.length && <option>{tokens.error ? "Could not load assets" : "Loading assets…"}</option>}
                  {collat.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} on {chainName(t.blockchain)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[13px] text-ink-2">Amount {asset ? `(${asset.symbol})` : ""}</span>
                <input className="field" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} />
                <span className="num mt-1 block text-[11px] text-ink-3">
                  {asset ? `${usd(value)} at ${usd(asset.price, asset.price > 100 ? 0 : 2)} per ${asset.symbol}` : " "}
                </span>
              </label>
            </div>
            <label className="mt-6 block">
              <span className="text-[13px] text-ink-2">Refund address on {asset ? chainName(asset.blockchain) : "the deposit chain"}</span>
              <input className="field" placeholder="Where funds go back if the deposit cannot be used" value={refundAddr} onChange={(e) => setRefundAddr(e.target.value)} spellCheck={false} />
            </label>
            {tokens.error && <ErrorLine>Could not load the asset list from 1Click: {tokens.error}</ErrorLine>}
          </fieldset>

          {/* 3 borrow */}
          <fieldset className="mt-10 rule-t pt-6">
            <legend className="eyebrow float-left mb-4 w-full">3 · Borrow</legend>
            <label className="clear-both block">
              <span className="text-[13px] text-ink-2">USDC to borrow</span>
              <input className="field text-[22px]" inputMode="decimal" placeholder="0.00" value={borrow} onChange={(e) => setBorrow(e.target.value.replace(",", "."))} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[0.25, 0.4, 0.5, 0.6].map((f) => (
                <button key={f} className="num min-h-9 px-2 text-[12px] text-ink-2 underline decoration-[var(--rule)] underline-offset-4 hover:text-accent disabled:opacity-40" disabled={!value} onClick={() => setBorrow((Math.floor(value * f * 100) / 100).toString())}>
                  {f * 100}%
                </button>
              ))}
            </div>
            <LtvGauge ltv={ltv} />
          </fieldset>

          {/* 4 receive */}
          <fieldset className="mt-4 rule-t pt-6">
            <legend className="eyebrow float-left mb-4 w-full">4 · Receive</legend>
            <div className="clear-both grid gap-6 sm:grid-cols-[200px_1fr]">
              <label className="block">
                <span className="text-[13px] text-ink-2">USDC on</span>
                <select className="field" value={recvAsset} onChange={(e) => setRecvAsset(e.target.value)} disabled={!usdc.length}>
                  {usdc.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {chainName(t.blockchain)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[13px] text-ink-2">Your address there</span>
                <input className="field" placeholder={recv?.blockchain === "near" ? "you.near" : recv?.blockchain === "sol" ? "Solana address" : "0x…"} value={recvAddr} onChange={(e) => setRecvAddr(e.target.value)} spellCheck={false} />
              </label>
            </div>
            <p className="mt-4 text-[14px] text-ink-3">
              Most private: use a fresh address that has never touched your deposit wallet. The loan is credited to a private balance first and paid out in round sized pieces with a random delay.
            </p>
          </fieldset>
        </div>

        {/* Summary rail */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rule-t pt-6">
            <div className="eyebrow">Your loan, before it goes dark</div>
            <dl className="num mt-4 text-[14px]">
              {[
                ["Collateral value", value ? usd(value) : "n/a"],
                ["Borrow", b > 0 ? `${usd(b, 2)} USDC` : "n/a"],
                ["Loan to value", ltv ? pct(ltv) : "n/a"],
                [`Private liquidation if ${cohort.collateralSymbol} hits`, liqPrice ? usd(liqPrice, 0) : "n/a"],
                [`${cohort.collateralSymbol} now (Morpho oracle)`, cohortPrice ? usd(cohortPrice, 0) : "loading"],
                ["Rate a year", rate !== null ? `${pct(rate, 2)}` : "loading"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 rule-t py-2.5">
                  <dt className="font-sans text-[13px] text-ink-2">{k}</dt>
                  <dd className={k.startsWith("Private") ? "text-accent" : ""}>{v}</dd>
                </div>
              ))}
            </dl>
            <Source>
              Rate is Morpho&apos;s live borrow rate ({market.data ? pct(market.data.borrowApy, 2) : "…"}) plus 1%. Liquidation estimate is before swap fees. Asset prices from 1Click.
            </Source>

            <div className="mt-8 rule-t pt-5">
              <div className="eyebrow">If a loan goes bad</div>
              <ol className="mt-3 space-y-2 text-[14px] text-ink-2">
                <li>1. The borrower&apos;s own collateral and penalty cover it.</li>
                <li>2. Then the cohort reserve, funded by the 1% spread.</li>
                <li>3. Only then, pro rata across this cohort. Other cohorts are never touched.</li>
              </ol>
              <label className="mt-4 flex cursor-pointer items-start gap-3 text-[14px]">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>I understand how losses are shared, and that this is an unaudited hackathon build.</span>
              </label>
            </div>

            {agentConfigured && !session.token ? (
              <button className="btn btn-primary mt-8 w-full justify-center" disabled={session.busy} onClick={session.signInEvm}>
                {session.busy ? "Waiting for wallet…" : "Sign in with your wallet"}
              </button>
            ) : (
              <button className="btn btn-primary mt-8 w-full justify-center" disabled={!agentConfigured || problems.length > 0 || busy} onClick={submit}>
                {busy ? "Asking the agent…" : "Get my deposit address"}
              </button>
            )}
            <div className="mt-3 min-h-6 text-[13px] text-ink-3" aria-live="polite">
              {!agentConfigured
                ? "Disabled: the agent is not live yet."
                : !session.token
                  ? "Your loan is tied to the wallet you sign in with. It is also where an eject would send your position. The signature is free."
                  : problems[0] ?? `The agent at ${AGENT_URL} checks your limits and returns a one time address.`}
            </div>
            {session.error && <ErrorLine>{session.error}</ErrorLine>}
            {err && <ErrorLine>The agent refused or failed: {err}</ErrorLine>}
          </div>
        </aside>
      </div>
    </>
  );
}
