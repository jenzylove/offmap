"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorLine } from "@/components/Bits";
import { agent, AgentError, type BorrowQuoteResp } from "@/lib/agent";
import { COHORTS, LIQ_LTV, OPEN_LTV, SPREAD_APR, type CohortDef } from "@/lib/config";
import { pct, short, toUnits, usd } from "@/lib/format";
import { readLevels } from "@/lib/morpho";
import { addressLooksValid, CHAIN_NAMES, collateralAssets, usdcTargets, type OneClickToken } from "@/lib/oneclick";
import { useLive } from "@/lib/useLive";

const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();
const isEvmChain = (c: string) => ["eth", "base", "arb", "op", "pol", "avax", "bsc", "gnosis"].includes(c);
const FAMILY: Record<string, string[]> = { "cbbtc-usdc": ["cbBTC", "BTC", "wBTC"], "weth-usdc": ["ETH", "WETH"] };
const CHOICE: Record<string, { name: string; sub: string }> = {
  "cbbtc-usdc": { name: "cbBTC", sub: "Bitcoin, held as cbBTC" },
  "weth-usdc": { name: "ETH", sub: "Ether, held as WETH" },
};

export interface StartedDeposit extends BorrowQuoteResp {
  label: string;
  startedAt: number;
  cohort: string;
}

export function BorrowSetup({ token, wallet, tokens, tokensError, onStarted }: { token: string; wallet: string; tokens: OneClickToken[]; tokensError: string | null; onStarted: (d: StartedDeposit) => void }) {
  const [cohort, setCohort] = useState<CohortDef>(COHORTS[0]!);
  const market = useLive(() => readLevels(cohort, 1), [cohort.id], 120_000);
  const prices = useLive(() => Promise.all(COHORTS.map((c) => readLevels(c, 1).then((m) => m.priceUsd))), [], 300_000);

  const all = useMemo(() => collateralAssets(tokens), [tokens]);
  const family = useMemo(() => all.filter((t) => FAMILY[cohort.id]!.includes(t.symbol)), [all, cohort.id]);
  const others = useMemo(() => all.filter((t) => !FAMILY[cohort.id]!.includes(t.symbol)), [all, cohort.id]);
  const usdc = useMemo(() => usdcTargets(tokens), [tokens]);

  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [borrow, setBorrow] = useState("");
  const [recvAsset, setRecvAsset] = useState("");
  const [recvAddr, setRecvAddr] = useState(wallet);
  const [refundAddr, setRefundAddr] = useState("");
  const [editRecv, setEditRecv] = useState(false);
  const [editRefund, setEditRefund] = useState(false);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // sensible defaults: the asset on Base if it is there, USDC paid on Base to this wallet
  useEffect(() => {
    if (!family.length) return;
    if (!family.some((t) => t.assetId === assetId) && !others.some((t) => t.assetId === assetId)) {
      const pick = family.find((t) => t.blockchain === "base") ?? family.find((t) => isEvmChain(t.blockchain)) ?? family[0]!;
      setAssetId(pick.assetId);
    }
  }, [family, others, assetId]);
  useEffect(() => {
    if (!recvAsset && usdc.length) setRecvAsset((usdc.find((t) => t.blockchain === "base") ?? usdc[0]!).assetId);
  }, [usdc, recvAsset]);

  const asset = all.find((t) => t.assetId === assetId);
  const recv = usdc.find((t) => t.assetId === recvAsset);
  const refundDefault = asset && isEvmChain(asset.blockchain) ? wallet : "";
  const refund = editRefund || !refundDefault ? refundAddr : refundDefault;

  const amt = Number(amount);
  const value = asset && amt > 0 ? amt * asset.price : 0;
  const b = Number(borrow);
  const ltv = value > 0 && b > 0 ? b / value : 0;
  const cohortPrice = market.data?.priceUsd ?? 0;
  const liq = value > 0 && b > 0 && cohortPrice > 0 ? (cohortPrice * b) / (LIQ_LTV * value) : null;
  const rate = market.data ? market.data.borrowApy + SPREAD_APR : null;
  const sliderPct = Math.min(60, Math.round(ltv * 1000) / 10);

  const amountUnits = asset ? toUnits(amount, asset.decimals) : null;
  const borrowUnits = toUnits(borrow, 6);
  const problems: string[] = [];
  if (!asset) problems.push("Pick what you deposit.");
  else if (!amountUnits) problems.push("Enter how much you deposit.");
  if (!borrowUnits) problems.push("Choose how much USDC to borrow.");
  if (ltv > OPEN_LTV) problems.push(`That is ${pct(ltv)} of your collateral. You can open at 60% at most.`);
  if (!recv) problems.push("Pick where to receive USDC.");
  else if (!addressLooksValid(recv.blockchain, recvAddr)) problems.push(`Enter a valid ${chainName(recv.blockchain)} address to receive USDC.`);
  if (asset && !addressLooksValid(asset.blockchain, refund)) problems.push(`Enter a ${chainName(asset.blockchain)} address for refunds.`);
  if (!accept) problems.push("Tick the box about shared losses.");

  const submit = async () => {
    if (!asset || !recv || !amountUnits || !borrowUnits) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await agent<BorrowQuoteResp>("/quote/borrow", {
        method: "POST",
        token,
        timeoutMs: 45_000,
        body: JSON.stringify({
          cohort: cohort.id,
          depositAsset: asset.assetId,
          depositAmount: amountUnits.toString(),
          borrowUsdc: borrowUnits.toString(),
          receiveAsset: recv.assetId,
          receiveAddress: recvAddr.trim(),
          refundTo: refund.trim(),
        }),
      });
      if (!r?.depositAddress) throw new Error("The agent answered without a deposit address.");
      onStarted({ ...r, label: `${amount} ${asset.symbol} on ${chainName(asset.blockchain)}`, startedAt: Date.now(), cohort: cohort.id });
    } catch (e) {
      setErr(e instanceof AgentError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16">
      <div className="space-y-12">
        {/* collateral */}
        <fieldset>
          <legend className="eyebrow mb-4">What you put up</legend>
          <div className="grid grid-cols-2 gap-3">
            {COHORTS.map((c, i) => {
              const on = c.id === cohort.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCohort(c)}
                  className={`rounded-2xl p-4 text-left transition-all duration-300 sm:p-5 ${on ? "bg-cold/[0.08] ring-1 ring-cold/60" : "ring-1 ring-white/10 hover:ring-white/25"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="wide text-[22px] font-semibold sm:text-[26px]">{CHOICE[c.id]!.name}</span>
                    <span className={on ? "dot dot-cold" : "dot dot-off"} />
                  </div>
                  <div className="mt-1 text-[13px] text-ink-3">{CHOICE[c.id]!.sub}</div>
                  <div className="num mt-3 text-[13px] text-ink-2">{prices.data ? usd(prices.data[i]!, 0) : "…"}</div>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* deposit */}
        <fieldset>
          <legend className="eyebrow mb-4">Where it comes from</legend>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <label className="block">
              <span className="text-[13px] text-ink-2">Send from</span>
              <select className="field" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!all.length} data-testid="asset-select">
                {!all.length && <option>{tokensError ? "Could not load assets" : "Loading assets…"}</option>}
                {family.length > 0 && (
                  <optgroup label={CHOICE[cohort.id]!.name}>
                    {family.map((t) => (
                      <option key={t.assetId} value={t.assetId}>
                        {t.symbol} on {chainName(t.blockchain)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label={`Other assets, converted to ${cohort.collateralSymbol} on the way`}>
                    {others.map((t) => (
                      <option key={t.assetId} value={t.assetId}>
                        {t.symbol} on {chainName(t.blockchain)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="block">
              <span className="text-[13px] text-ink-2">Amount {asset ? `(${asset.symbol})` : ""}</span>
              <input className="field text-[22px]" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} data-testid="amount" />
              <span className="num mt-1 block min-h-4 text-[11px] text-ink-3">{asset && value > 0 ? `worth ${usd(value)}` : asset ? `${usd(asset.price, asset.price > 100 ? 0 : 2)} per ${asset.symbol}` : ""}</span>
            </label>
          </div>
          {tokensError && (
            <div className="mt-4">
              <ErrorLine>Could not load the asset list from NEAR Intents: {tokensError}</ErrorLine>
            </div>
          )}
        </fieldset>

        {/* borrow */}
        <fieldset>
          <legend className="eyebrow mb-4">How much USDC</legend>
          <div className="flex items-baseline gap-3">
            <input
              className="field max-w-[260px] text-[34px]"
              inputMode="decimal"
              placeholder="0.00"
              value={borrow}
              onChange={(e) => setBorrow(e.target.value.replace(",", "."))}
              aria-label="USDC to borrow"
            />
            <span className="num text-[14px] text-ink-3">USDC</span>
          </div>
          <input
            type="range"
            className="ltv-range mt-6"
            min={0}
            max={60}
            step={0.5}
            value={sliderPct}
            disabled={!value}
            onChange={(e) => setBorrow((Math.floor(value * (Number(e.target.value) / 100) * 100) / 100).toString())}
            aria-label="Loan to value"
          />
          <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
            <span>0%</span>
            <span className={ltv > OPEN_LTV ? "text-heat" : "text-ink-2"}>loan to value {ltv ? pct(ltv) : "0%"}</span>
            <span>60% max</span>
          </div>
          {!value && <p className="mt-3 text-[13px] text-ink-3">Enter a deposit amount first to use the slider.</p>}
        </fieldset>

        {/* receive and refunds */}
        <fieldset className="space-y-4">
          <legend className="eyebrow mb-4">Where the USDC goes</legend>
          {!editRecv ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rule-t pt-4">
              <span className="text-[15px] text-ink">
                USDC on {recv ? chainName(recv.blockchain) : "Base"} to <span className="num text-cold">{short(recvAddr || wallet)}</span>
                {recvAddr.toLowerCase() === wallet.toLowerCase() && <span className="text-ink-3">, this wallet</span>}
              </span>
              <button className="ink-link text-[13px] text-ink-2" onClick={() => setEditRecv(true)}>
                Change
              </button>
            </div>
          ) : (
            <div className="grid gap-6 rule-t pt-4 sm:grid-cols-[180px_minmax(0,1fr)]">
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
                <input className="field" value={recvAddr} onChange={(e) => setRecvAddr(e.target.value)} spellCheck={false} />
              </label>
              <p className="text-[13px] text-ink-3 sm:col-span-2">Most private: a fresh address that has never touched the wallet you deposit from.</p>
            </div>
          )}
          {asset && (refundDefault && !editRefund ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rule-t pt-4">
              <span className="text-[15px] text-ink-2">
                If the deposit cannot be used, it goes back to <span className="num text-ink">{short(refundDefault)}</span> on {chainName(asset.blockchain)}
              </span>
              <button className="ink-link text-[13px] text-ink-2" onClick={() => setEditRefund(true)}>
                Change
              </button>
            </div>
          ) : (
            <label className="block rule-t pt-4">
              <span className="text-[13px] text-ink-2">Refund address on {chainName(asset.blockchain)}, if the deposit cannot be used</span>
              <input className="field" value={refundAddr} onChange={(e) => setRefundAddr(e.target.value)} spellCheck={false} placeholder={asset.blockchain === "btc" ? "bc1…" : asset.blockchain === "sol" ? "Solana address" : asset.blockchain === "near" ? "you.near" : "0x…"} />
            </label>
          ))}
        </fieldset>
      </div>

      {/* the summary that matters, pinned beside the form */}
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="relative overflow-hidden rounded-[28px] p-7 ring-1 ring-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_0%,rgba(127,233,255,0.12),transparent_60%)]" />
          <div className="relative">
            <div className="eyebrow">Your liquidation price</div>
            <div className={`display mt-3 text-[clamp(44px,5vw,64px)] ${liq ? "text-cold-grad" : "text-white/15"}`} data-testid="setup-liq">
              {liq ? usd(liq, 0) : "$…"}
            </div>
            <p className="mt-2 text-[13px] text-ink-3">
              {liq && cohortPrice ? `If ${cohort.collateralSymbol} falls ${pct(1 - liq / cohortPrice, 0)} from ${usd(cohortPrice, 0)}, a little is sold privately to bring you back to 60%. Only you will ever see this number.` : "Fill in a deposit and a borrow amount. Only you will ever see this number."}
            </p>
            <dl className="num mt-6 text-[13px]">
              {[
                ["Collateral value", value ? usd(value) : "n/a"],
                ["You borrow", b > 0 ? `${usd(b, 2)} USDC` : "n/a"],
                ["Loan to value", ltv ? pct(ltv) : "n/a"],
                ["Rate a year", rate !== null ? pct(rate, 2) : "…"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 rule-t py-2.5">
                  <dt className="font-sans text-[13px] text-ink-2">{k}</dt>
                  <dd className={k === "Loan to value" && ltv > OPEN_LTV ? "text-heat" : "text-ink"}>{v}</dd>
                </div>
              ))}
            </dl>
            <label className="mt-6 flex cursor-pointer items-start gap-3 text-[13px] text-ink-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 flex-none accent-[var(--cold)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>I understand that if a private sale cannot cover a loan, the gap comes from that borrower, then the reserve, then the pooled position. This is an unaudited hackathon build.</span>
            </label>
            <button className="btn btn-primary mt-6 w-full" disabled={problems.length > 0 || busy} onClick={submit} data-testid="confirm-borrow">
              {busy ? "Asking the agent…" : "Get my deposit address"}
            </button>
            <p className="mt-3 min-h-5 text-[13px] text-ink-3" aria-live="polite">
              {problems[0] ?? "Nothing is sent yet. You get a one time address to deposit to."}
            </p>
            {err && <ErrorLine>The agent refused: {err}</ErrorLine>}
          </div>
        </div>
      </aside>
    </div>
  );
}
