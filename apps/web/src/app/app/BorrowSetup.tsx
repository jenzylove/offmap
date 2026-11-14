"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorLine } from "@/components/Bits";
import { agent, AgentError, type BorrowQuoteResp } from "@/lib/agent";
import { COHORTS, LIQ_LTV, OPEN_LTV, SPREAD_APR, type CohortDef } from "@/lib/config";
import { pct, short, toUnits, usd } from "@/lib/format";
import { readLevels } from "@/lib/morpho";
import { addressLooksValid, CHAIN_NAMES, collateralAssets, usdcTargets, type OneClickToken } from "@/lib/oneclick";
import { useLive } from "@/lib/useLive";
import { readBalance } from "@/lib/balance";
import { loadWorld } from "@/lib/world";
import { basescanAddr } from "@/lib/config";

const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();
const isEvmChain = (c: string) => ["eth", "base", "arb", "op", "pol", "avax", "bsc", "gnosis"].includes(c);
/** Deposit routes into each pool that NEAR Intents can fill today (checked against the live agent, Nov 10 2026). */
const ROUTES: Record<string, string[]> = {
  "cbbtc-usdc": [
    "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near",
    "nep141:btc.omft.near",
    "nep141:eth-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near",
    "nep141:eth-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.omft.near",
  ],
  "weth-usdc": ["nep141:base-0x4200000000000000000000000000000000000006.omft.near"],
};
const ROUTE_NOTE: Record<string, string> = {
  "cbbtc-usdc": "Bitcoin, or cbBTC on Base or Ethereum.",
  "weth-usdc": "The ETH pool takes WETH on Base today. Holding plain ETH? Wrap it to WETH in your wallet first.",
};
/** Plain words for the errors a quote can come back with. */
function quoteError(raw: string, what: string, chain: string): string {
  const inner = /"message":"([^"]+)"/.exec(raw)?.[1] ?? raw;
  if (/no liquidity|no_quote/i.test(inner)) return `There is no swap route for ${what} into the pool right now. Pick another source above.`;
  if (/refundTo is not valid/i.test(inner)) return `That refund address does not look right for ${chain}.`;
  if (/sign in first/i.test(inner)) return "Your session ended. Sign again in step 1.";
  if (/borrow too large/i.test(inner)) return "That borrow is too large for this deposit. Move the slider left.";
  return inner;
}
const CHOICE: Record<string, { name: string; sub: string }> = {
  "cbbtc-usdc": { name: "cbBTC", sub: "Bitcoin, held as cbBTC" },
  "weth-usdc": { name: "ETH", sub: "Ether, held as WETH" },
};

export interface StartedDeposit extends BorrowQuoteResp {
  /** Set when the deposit is a token on a chain a browser wallet can pay from in one click. */
  pay?: { chainId: number; token: string; amountRaw: string; symbol: string };
  label: string;
  startedAt: number;
  cohort: string;
}

export function BorrowSetup({ token, wallet, tokens, tokensError, onStarted }: { token: string; wallet: string; tokens: OneClickToken[]; tokensError: string | null; onStarted: (d: StartedDeposit) => void }) {
  const [cohort, setCohort] = useState<CohortDef>(COHORTS[0]!);
  const market = useLive(() => readLevels(cohort, 1), [cohort.id], 120_000);
  const world = useLive(() => loadWorld(cohort), [cohort.id], 60_000);
  const prices = useLive(() => Promise.all(COHORTS.map((c) => readLevels(c, 1).then((m) => m.priceUsd))), [], 300_000);

  const all = useMemo(() => collateralAssets(tokens), [tokens]);
  const family = useMemo(() => ROUTES[cohort.id]!.map((id) => all.find((t) => t.assetId === id)).filter((t): t is OneClickToken => !!t), [all, cohort.id]);
  const others = useMemo(() => [] as OneClickToken[], []);
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

  const balance = useLive(async () => (asset && wallet.startsWith("0x") ? readBalance(asset.assetId, asset.decimals, wallet) : null), [asset?.assetId, wallet], 30_000);
  // a sensible first borrow: 30% of the deposit, well away from liquidation
  useEffect(() => {
    if (value > 0 && !borrow) setBorrow((Math.floor(value * 0.3 * 100) / 100).toString());
  }, [value, borrow]);
  const amountUnits = asset ? toUnits(amount, asset.decimals) : null;
  const borrowUnits = toUnits(borrow, 6);
  const problems: string[] = [];
  if (!asset) problems.push("Pick what you deposit.");
  else if (!amountUnits) problems.push("Enter how much you deposit.");
  if (!borrowUnits) problems.push("Choose how much USDC to borrow.");
  else if (borrowUnits < 250_000n) problems.push("Borrow at least 0.25 USDC: smaller amounts cannot be bridged out.");
  if (ltv > OPEN_LTV) problems.push(`That is ${pct(ltv)} of your collateral. You can open at 60% at most.`);
  if (!recv) problems.push("Pick where to receive USDC.");
  else if (!addressLooksValid(recv.blockchain, recvAddr)) problems.push(`Enter a valid ${chainName(recv.blockchain)} address to receive USDC.`);
  if (asset && !addressLooksValid(asset.blockchain, refund)) problems.push(`Enter a ${chainName(asset.blockchain)} address for refunds.`);
  if (!accept) problems.push("Tick the box to confirm you understand liquidation.");

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
      const chainId = asset.blockchain === "base" ? 8453 : asset.blockchain === "eth" ? 1 : 0;
      const pay = chainId && asset.contractAddress ? { chainId, token: asset.contractAddress, amountRaw: amountUnits.toString(), symbol: asset.symbol } : undefined;
      onStarted({ ...r, pay, label: `${amount} ${asset.symbol} on ${chainName(asset.blockchain)}`, startedAt: Date.now(), cohort: cohort.id });
    } catch (e) {
      setErr(quoteError(e instanceof Error ? e.message : String(e), asset ? `${asset.symbol} on ${chainName(asset.blockchain)}` : "this asset", asset ? chainName(asset.blockchain) : "that chain"));
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
                  onClick={() => { setCohort(c); setAssetId(""); setAmount(""); }}
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
              <span className="num mt-1 flex min-h-4 flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
                <span>{asset && value > 0 ? `worth ${usd(value)}` : asset ? `${usd(asset.price, asset.price > 100 ? 0 : 2)} per ${asset.symbol}` : ""}</span>
                {balance.data && (
                  <button type="button" className="text-cold hover:underline" onClick={() => setAmount(balance.data!.text)} data-testid="use-max">
                    In your wallet: {balance.data.text} {asset?.symbol} · use max
                  </button>
                )}
              </span>
              {balance.data && amountUnits && amountUnits > balance.data.raw && (
                <span className="mt-1 block text-[12px] text-warn">More than this wallet holds. You can still send it from another wallet.</span>
              )}
            </label>
          </div>
          <p className="mt-3 text-[13px] text-ink-3">{ROUTE_NOTE[cohort.id]}</p>
          {tokensError && (
            <div className="mt-4">
              <ErrorLine>Could not load the asset list from NEAR Intents: {tokensError}</ErrorLine>
            </div>
          )}
        </fieldset>

        {/* borrow */}
        <fieldset>
          <legend className="eyebrow mb-4">How much USDC to borrow</legend>
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
            <span>safer</span>
            <span className={ltv > OPEN_LTV ? "text-heat" : "text-ink-2"}>{ltv ? `borrowing ${pct(ltv)} of your deposit's value` : "drag to choose"}</span>
            <span>riskier · 60% max</span>
          </div>
          <p className="mt-3 text-[13px] text-ink-3">
            {value ? "Type an amount or drag. The further right, the closer your liquidation price sits to today's price." : "Enter a deposit amount first to use the slider."}
          </p>
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
                Safety net: if a deposit cannot be converted (it arrives late, or the price moves too far), it is sent back to <span className="num text-ink">{short(refundDefault)}</span> on {chainName(asset.blockchain)}
              </span>
              <button className="ink-link text-[13px] text-ink-2" onClick={() => setEditRefund(true)}>
                Change
              </button>
            </div>
          ) : (
            <label className="block rule-t pt-4">
              <span className="text-[13px] text-ink-2">Where a deposit goes back to on {chainName(asset.blockchain)}, if it cannot be converted</span>
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
              {liq && cohortPrice ? `If ${cohort.collateralSymbol} falls to this price, ${pct(1 - liq / cohortPrice, 0)} below today's ${usd(cohortPrice, 0)}, part of your collateral is sold to cover the loan. Only you ever see this number.` : "Fill in a deposit and a borrow amount. Only you ever see this number."}
            </p>
            <dl className="num mt-6 text-[13px]">
              {[
                ["Collateral value", value ? usd(value) : "enter an amount"],
                ["You borrow", b > 0 ? `${usd(b, 2)} USDC` : "enter an amount"],
                ["Loan to value", ltv ? pct(ltv) : "after amounts"],
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
              <span>I understand that if {cohort.collateralSymbol} falls to my liquidation price, part of my collateral is sold to repay the loan.</span>
            </label>
            <button className="btn btn-primary mt-6 w-full" disabled={problems.length > 0 || busy} onClick={submit} data-testid="confirm-borrow">
              {busy ? "Asking the agent…" : "Get my deposit address"}
            </button>
            <p className="mt-3 min-h-5 text-[13px] text-ink-3" aria-live="polite">
              {problems[0] ?? "Nothing is sent yet. You get a one time address to deposit to."}
            </p>
            {err && <ErrorLine>{err}</ErrorLine>}
          </div>
        </div>
        <PublicRecord pool={world.data?.positions.find((p) => p.kind === "cohort")?.pos ?? null} loading={!world.data} wallet={wallet} addValue={value} addDebt={b > 0 ? b : 0} />
      </aside>
    </div>
  );
}

/** The other half of the setup: what anyone reading Morpho will see once this loan lands. */
function PublicRecord({ pool, loading, wallet, addValue, addDebt }: { pool: { address: string; collateralUsd: number; debtUsd: number } | null; loading: boolean; wallet: string; addValue: number; addDebt: number }) {
  const row = (k: string, now: number, add: number) => (
    <div key={k} className="flex items-baseline justify-between gap-4 rule-t py-2.5">
      <dt className="font-sans text-[13px] text-ink-2">{k}</dt>
      <dd className="text-ink">
        {usd(now, 0)}
        {add > 0 && <span className="text-heat"> → {usd(now + add, 0)}</span>}
      </dd>
    </div>
  );
  return (
    <div className="mt-4 rounded-[28px] p-7 ring-1 ring-white/10" data-testid="public-record">
      <div className="eyebrow">What Morpho will show, live from Base</div>
      {pool ? (
        <>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Your loan joins one shared pool address on Morpho. Your wallet never shows up there.
          </p>
          <div className="num mt-4 flex items-center justify-between gap-3 text-[13px]">
            <span className="font-sans text-ink-2">Borrower on record</span>
            <a className="text-cold underline decoration-white/20 underline-offset-4" href={basescanAddr(pool.address)} target="_blank" rel="noreferrer">{short(pool.address, 6, 4)} · Offmap pool</a>
          </div>
          <dl className="num mt-3 text-[13px]">
            {row("Pool collateral", pool.collateralUsd, addValue)}
            {row("Pool debt", pool.debtUsd, addDebt)}
            <div className="flex items-baseline justify-between gap-4 rule-t py-2.5">
              <dt className="font-sans text-[13px] text-ink-2">Your wallet {short(wallet, 6, 4)}</dt>
              <dd className="text-cold">never appears</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">{loading ? "Reading the pool's position from Morpho…" : "The pool's position could not be read right now."}</p>
      )}
    </div>
  );
}
