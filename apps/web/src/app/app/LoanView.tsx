"use client";

import { PRICE_SCALE, type Note } from "@offmap/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Details, ErrorLine, Row } from "@/components/Bits";
import { DepositPanel, useOneClick, type Stage } from "@/components/DepositPanel";
import { NoteVerdict } from "@/components/NoteCheck";
import { agent, AgentError, type RepayQuoteResp, type UserCohortPosition } from "@/lib/agent";
import { basescanTx, cohortById, LIQ_LTV, OPEN_LTV, SPREAD_APR, type CohortDef } from "@/lib/config";
import { ago, pct, short, toUnits, units, usd } from "@/lib/format";
import { readLevels } from "@/lib/morpho";
import { parseNote } from "@/lib/notes";
import { addressLooksValid, CHAIN_NAMES, collateralAssets, usdcTargets, type OneClickToken } from "@/lib/oneclick";
import { useLive } from "@/lib/useLive";

const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();
const errText = (e: unknown) => (e instanceof AgentError ? e.message : e instanceof Error ? e.message : String(e));
const isEvmChain = (c: string) => ["eth", "base", "arb", "op", "pol", "avax", "bsc", "gnosis"].includes(c);

/** Loan to value on a scale from 0 to Morpho's own limit, with Offmap's two lines drawn on it. */
export function HealthBar({ ltv }: { ltv: number }) {
  const max = 0.86;
  const at = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const tone = ltv >= LIQ_LTV ? "var(--heat-2)" : ltv > OPEN_LTV ? "var(--heat)" : "var(--cold)";
  return (
    <div className="relative pb-8 pt-3">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: at(ltv), background: `linear-gradient(90deg, var(--cold-2), ${tone})`, boxShadow: `0 0 18px ${tone}` }} />
      </div>
      {[
        [OPEN_LTV, "60% open limit", "text-ink-2", "-translate-x-full pr-1.5 text-right"],
        [LIQ_LTV, "70% private sale", "text-heat", "pl-1.5"],
      ].map(([v, l, c, pos]) => (
        <div key={String(v)} className="absolute top-1" style={{ left: at(v as number) }}>
          <div className="h-[18px] w-px bg-white/30" />
          <div className={`num mt-1 whitespace-nowrap text-[10px] ${c} ${pos}`}>{l as string}</div>
        </div>
      ))}
    </div>
  );
}

function TokenSelect({ list, value, onChange, label }: { list: OneClickToken[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="block">
      <span className="text-[13px] text-ink-2">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)} disabled={!list.length}>
        {!list.length && <option>Loading…</option>}
        {list.map((t) => (
          <option key={t.assetId} value={t.assetId}>
            {t.symbol} on {chainName(t.blockchain)}
          </option>
        ))}
      </select>
    </label>
  );
}

const REPAY_STAGES: Stage[] = [
  { key: "wait", label: "Waiting for your payment", hint: "Send the amount above from any wallet on that chain." },
  { key: "in", label: "Payment received", hint: "Seen on its chain. Converting it to USDC in your private balance." },
  { key: "apply", label: "Applied to your loan", hint: "Repays your share in the next batch." },
];

function Repay({ token, c, tokens, wallet, positions }: { token: string; c: CohortDef; tokens: OneClickToken[]; wallet: string | null; positions: UserCohortPosition[] }) {
  const list = useMemo(() => [...usdcTargets(tokens), ...collateralAssets(tokens)], [tokens]);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [dep, setDep] = useState<(RepayQuoteResp & { label: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!assetId && list.length) setAssetId(list[0]!.assetId);
  }, [list, assetId]);
  const asset = list.find((t) => t.assetId === assetId);
  useEffect(() => {
    if (asset && wallet && isEvmChain(asset.blockchain) && !refund) setRefund(wallet);
  }, [asset, wallet, refund]);
  const amt = asset ? toUnits(amount, asset.decimals) : null;
  const ok = asset && amt && addressLooksValid(asset.blockchain, refund);
  if (dep) return <RepayTracker dep={dep} positions={positions} />;
  return (
    <div>
      <p className="max-w-xl text-ink-2">Pay back in USDC from NEAR, Ethereum, Base, Arbitrum, Optimism or Solana. It lands in your private balance as USDC and repays your loan in the next batch.</p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <TokenSelect list={list} value={assetId} onChange={setAssetId} label="Pay with" />
        <label className="block">
          <span className="text-[13px] text-ink-2">Amount {asset ? `(${asset.symbol})` : ""}</span>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="0.0" />
        </label>
      </div>
      <label className="mt-6 block">
        <span className="text-[13px] text-ink-2">Refund address on {asset ? chainName(asset.blockchain) : "that chain"}, if the payment cannot be used</span>
        <input className="field" value={refund} onChange={(e) => setRefund(e.target.value)} spellCheck={false} />
      </label>
      <button
        className="btn btn-primary mt-8"
        disabled={busy || !ok}
        onClick={async () => {
          if (!asset || !amt) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await agent<RepayQuoteResp>("/quote/repay", {
              method: "POST",
              token,
              timeoutMs: 45_000,
              body: JSON.stringify({ cohort: c.id, depositAsset: asset.assetId, depositAmount: amt.toString(), refundTo: refund.trim() }),
            });
            setDep({ ...r, label: `${amount} ${asset.symbol} on ${chainName(asset.blockchain)}` });
          } catch (e) {
            setErr(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Asking the agent…" : "Get a repay address"}
      </button>
      {err && (
        <div className="mt-4">
          <ErrorLine>{err}</ErrorLine>
        </div>
      )}
    </div>
  );
}

function RepayTracker({ dep, positions }: { dep: RepayQuoteResp & { label: string }; positions: UserCohortPosition[] }) {
  const oc = useOneClick(dep.depositAddress);
  const s = oc.status?.status ?? "NOT_FOUND";
  const pend = positions.flatMap((p) => p.pending).find((x) => x.depositAddress.toLowerCase() === dep.depositAddress.toLowerCase());
  const stage = s === "SUCCESS" ? (pend ? 2 : 3) : ["KNOWN_DEPOSIT_TX", "PROCESSING"].includes(s) ? 1 : 0;
  const failed = ["REFUNDED", "FAILED"].includes(s) ? "The payment could not be used and is going back to your refund address." : s === "INCOMPLETE_DEPOSIT" ? "Less than the quoted amount arrived. Send the rest or wait for a refund." : null;
  return (
    <DepositPanel
      depositAddress={dep.depositAddress}
      amountLabel={dep.label + (dep.usdcOut ? `, about ${dep.usdcOut} USDC of repayment` : "")}
      deadline={dep.deadline}
      stages={REPAY_STAGES}
      stage={stage}
      failed={failed}
      oneclick={oc}
    />
  );
}

function RequestForm({ token, c, tokens, kind, wallet, onDone }: { token: string; c: CohortDef; tokens: OneClickToken[]; kind: "borrow" | "withdraw"; wallet: string | null; onDone: () => void }) {
  const list = useMemo(() => (kind === "borrow" ? usdcTargets(tokens) : collateralAssets(tokens)), [tokens, kind]);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [addr, setAddr] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (list.length && !list.some((t) => t.assetId === assetId)) setAssetId((list.find((t) => t.blockchain === "base") ?? list[0]!).assetId);
  }, [list, assetId]);
  const asset = list.find((t) => t.assetId === assetId);
  useEffect(() => {
    if (asset && wallet && isEvmChain(asset.blockchain) && !addr) setAddr(wallet);
  }, [asset, wallet, addr]);
  const decimals = kind === "borrow" ? 6 : c.collateralDecimals;
  const amt = toUnits(amount, decimals);
  const tooSmall = kind === "borrow" && !!amt && amt < 250_000n;
  const ok = asset && amt && !tooSmall && addressLooksValid(asset.blockchain, addr);
  return (
    <div>
      <p className="max-w-xl text-ink-2">
        {kind === "borrow" ? "Borrow more USDC against the collateral you already have, up to 60% of its value." : `Take ${c.collateralSymbol} back out, as long as what stays keeps your loan under 60%.`} Applied in the next batch, paid out after a random wait.
      </p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] text-ink-2">Amount ({kind === "borrow" ? "USDC" : c.collateralSymbol})</span>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="0.0" />
        {tooSmall && <span className="mt-1 block text-[12px] text-warn">Borrow at least 0.25 USDC: smaller amounts cannot be bridged out.</span>}
        </label>
        <TokenSelect list={list} value={assetId} onChange={setAssetId} label="Receive as" />
      </div>
      <label className="mt-6 block">
        <span className="text-[13px] text-ink-2">Your address on {asset ? chainName(asset.blockchain) : "that chain"}</span>
        <input className="field" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} />
      </label>
      <button
        className="btn btn-primary mt-8"
        disabled={busy || !ok}
        onClick={async () => {
          if (!asset || !amt) return;
          setBusy(true);
          setErr(null);
          setMsg(null);
          try {
            const r = await agent<{ queued: boolean; nextBatchWithinSeconds?: number }>("/request", {
              method: "POST",
              token,
              body: JSON.stringify({ cohort: c.id, kind, amount: amt.toString(), receiveAsset: asset.assetId, receiveAddress: addr.trim() }),
            });
            setMsg(r.queued ? `Queued for the next batch${r.nextBatchWithinSeconds ? `, within ${r.nextBatchWithinSeconds < 120 ? `${r.nextBatchWithinSeconds} seconds` : `${Math.round(r.nextBatchWithinSeconds / 60)} minutes`}` : ""}.` : "Not queued.");
            onDone();
          } catch (e) {
            setErr(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : kind === "borrow" ? "Borrow more" : "Withdraw"}
      </button>
      {msg && <p className="mt-4 text-cold">{msg}</p>}
      {err && (
        <div className="mt-4">
          <ErrorLine>{err}</ErrorLine>
        </div>
      )}
    </div>
  );
}

function saveNote(c: CohortDef, note: NonNullable<UserCohortPosition["note"]>) {
  const blob = new Blob([JSON.stringify(note, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `offmap-note-${c.id}-${note.batchId}.json`;
  a.click();
}

const STATUS_WORDS: Record<string, string> = {
  waiting: "waiting for your deposit",
  arrived: "received, joining the next batch",
  onbase: "on Base, being supplied",
  supplied: "supplied, borrowing next",
  queued: "queued for the next batch",
  applied: "done",
  rejected: "refused",
  sent: "on its way",
  done: "paid",
  failed: "waiting to retry",
};

type Action = "repay" | "borrow" | "withdraw" | "eject";

export function LoanView({ p, token, tokens, wallet, reload }: { p: UserCohortPosition; token: string; tokens: OneClickToken[]; wallet: string | null; reload: () => void }) {
  const c = cohortById(p.cohort);
  const [action, setAction] = useState<Action>("repay");
  const market = useLive(() => (c ? readLevels(c, 1) : Promise.resolve(null)), [c?.id], 300_000);
  const note: Note | null = useMemo(() => {
    try {
      return p.note ? parseNote(p.note) : null;
    } catch {
      return null;
    }
  }, [p.note]);
  if (!c) return <ErrorLine>The agent returned an unknown market ({p.cohort}).</ErrorLine>;

  const collateral = BigInt(p.collateral);
  const debt = BigInt(p.debt);
  const price = Number(p.price) / Number(PRICE_SCALE);
  const ltv = Number(p.ltvBps) / 10_000;
  const liq = p.liquidationPrice ? Number(p.liquidationPrice) / Number(PRICE_SCALE) : null;
  const collUsd = (Number(collateral) / 10 ** c.collateralDecimals) * price;
  const drop = liq && price > 0 ? 1 - liq / price : null;
  const rate = market.data ? market.data.borrowApy + SPREAD_APR : null;
  const inMotion = [
    ...p.pending.map((x) => ({ k: x.kind === "deposit" ? "Deposit" : "Repayment", v: STATUS_WORDS[x.status] ?? x.status, raw: x.depositAddress })),
    ...p.requests
      .filter((r) => r.status === "queued")
      .map((r) => ({ k: r.kind === "borrow" ? `Borrow ${units(BigInt(r.amount), 6, 2)} USDC` : `Withdraw ${units(BigInt(r.amount), c.collateralDecimals, 8)} ${c.collateralSymbol}`, v: STATUS_WORDS[r.status] ?? r.status, raw: r.id })),
    ...p.payouts
      .filter((x) => x.status !== "done" && BigInt(x.amount) > 0n)
      .map((x) => ({ k: `Payout ${units(BigInt(x.amount), 6, 6)} USDC`, v: x.status === "queued" ? `random wait, not before ${new Date(x.notBefore).toLocaleTimeString()}` : STATUS_WORDS[x.status] ?? x.status, raw: x.tx ?? "" })),
  ];
  const paid = p.payouts.filter((x) => x.status === "done");

  return (
    <div data-testid="loan-view">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16">
        <div className="relative overflow-hidden rounded-[28px] p-7 ring-1 ring-cold/20 md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(127,233,255,0.13),transparent_60%)]" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="eyebrow">{c.label} · private</span>
              <span className="num flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-cold">
                <span className="dot dot-cold" /> visible to you only
              </span>
            </div>
            <div className="eyebrow mt-8">Liquidation price</div>
            <div className="display mt-3 text-[clamp(48px,7.4vw,104px)] text-cold-grad" data-testid="liq-price">
              {liq === null ? "none" : usd(liq, 0)}
            </div>
            <div className="num mt-3 text-[13px] text-ink-2">
              {c.collateralSymbol} now {usd(price, 0)}
              {drop !== null && drop > 0 ? ` · ${pct(drop, 0)} away` : ""}
            </div>
            <div className="mt-10">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Loan to value</span>
                <span className={`num text-[15px] ${ltv > OPEN_LTV ? "text-heat" : "text-cold"}`}>{pct(ltv)}</span>
              </div>
              <HealthBar ltv={ltv} />
            </div>
          </div>
        </div>

        <div>
          <Row k="Collateral" v={`${units(collateral, c.collateralDecimals, 8)} ${c.collateralSymbol}`} sub={usd(collUsd)} />
          <Row k="Debt" v={`${units(debt, 6, 4)} USDC`} sub="grows with interest" />
          <Row k="Rate a year" v={rate !== null ? pct(rate, 2) : "…"} sub="Morpho's live rate plus 1%" />
          <Row k="If it reaches 70%" v="sold privately back to 60%" />
          {inMotion.length > 0 && (
            <div className="mt-8">
              <div className="eyebrow mb-1">In motion</div>
              {inMotion.map((m, i) => (
                <Row key={i} k={m.k} v={<span className="text-cold">{m.v}</span>} />
              ))}
            </div>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            {p.note && (
              <button className="btn" onClick={() => saveNote(c, p.note!)} data-testid="save-note">
                Download note
              </button>
            )}
            <span className="max-w-[16rem] self-center text-[13px] text-ink-3">Your note is all you need to eject without us. Keep the latest one.</span>
          </div>
        </div>
      </div>

      {/* one action in focus at a time */}
      <div className="mt-16 rule-t pt-10">
        <div role="tablist" aria-label="Manage your loan" className="flex flex-wrap gap-2">
          {(
            [
              ["repay", "Repay"],
              ["borrow", "Borrow more"],
              ["withdraw", "Withdraw"],
              ["eject", "Eject"],
            ] as const
          ).map(([v, t]) => (
            <button
              key={v}
              role="tab"
              aria-selected={action === v}
              onClick={() => setAction(v)}
              className={`min-h-11 rounded-full px-5 text-[14px] transition-all ${action === v ? "bg-white/[0.08] text-ink ring-1 ring-white/20" : "text-ink-2 ring-1 ring-transparent hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-10">
          {action === "repay" && <Repay token={token} c={c} tokens={tokens} wallet={wallet} positions={[p]} />}
          {action === "borrow" && <RequestForm key="b" token={token} c={c} tokens={tokens} kind="borrow" wallet={wallet} onDone={reload} />}
          {action === "withdraw" && <RequestForm key="w" token={token} c={c} tokens={tokens} kind="withdraw" wallet={wallet} onDone={reload} />}
          {action === "eject" && (
            <div className="max-w-2xl">
              <p className="text-[18px] leading-relaxed text-ink">
                Eject moves your share of the pooled position into a Morpho position owned by your own wallet, in one transaction, through the NEAR contract. It works even if Offmap is down.
              </p>
              <p className="mt-4 text-ink-2">Your loan becomes public again, like any Morpho loan. You keep your collateral and your debt. Nobody can stop it.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                {p.note && (
                  <button className="btn" onClick={() => saveNote(c, p.note!)}>
                    1. Download note
                  </button>
                )}
                <Link href="/eject" className="btn btn-primary">
                  {p.note ? "2. Open eject" : "Open eject"}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <Details label="Details: note, proof and raw values">
        {note ? <NoteVerdict note={note} /> : <p className="text-[14px] text-ink-3">Your first note arrives after your first batch.</p>}
        {p.note && (
          <pre className="num mt-6 max-h-72 overflow-auto rounded-xl bg-black/40 p-4 text-[11px] leading-relaxed text-ink-2">{JSON.stringify(p.note, null, 2)}</pre>
        )}
        <div className="mt-6">
          <Row k="Price used by the agent" v={usd(price, 2)} />
          <Row k="Loan to value, basis points" v={p.ltvBps} />
          {p.pending.map((x) => (
            <Row key={x.depositAddress} k={`${x.kind} deposit address`} v={short(x.depositAddress, 10, 6)} sub={x.status} />
          ))}
          {p.requests.map((r) => (
            <Row key={r.id} k={`${r.kind} request`} v={r.status} sub={`${r.reason ?? ""} ${short(r.id, 8, 4)} · ${ago(r.createdAt)}`} />
          ))}
          {paid.map((x, i) => (
            <Row
              key={`d${i}`}
              k={`Paid ${units(BigInt(x.amount), 6, 6)} USDC`}
              v={x.tx ? short(x.tx, 8, 6) : "done"}
              href={x.tx && /^0x[0-9a-f]{64}$/i.test(x.tx) ? basescanTx(x.tx) : undefined}
            />
          ))}
        </div>
      </Details>
    </div>
  );
}
