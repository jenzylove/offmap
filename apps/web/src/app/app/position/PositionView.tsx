"use client";

import { PRICE_SCALE, type Note } from "@offmap/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ErrorLine, NotLive, PageHead, Row, Source } from "@/components/Bits";
import { DepositTracker } from "@/components/DepositTracker";
import { Fog } from "@/components/Fog";
import { NoteVerdict } from "@/components/NoteCheck";
import { agent, agentConfigured, AgentError, type PositionResp, type RepayQuoteResp, type UserCohortPosition } from "@/lib/agent";
import { basescanTx, cohortById, LIQ_LTV, type CohortDef } from "@/lib/config";
import { ago, pct, short, toUnits, units, usd } from "@/lib/format";
import { parseNote } from "@/lib/notes";
import { addressLooksValid, CHAIN_NAMES, collateralAssets, fetchTokens, usdcTargets, type OneClickToken } from "@/lib/oneclick";
import { useSession } from "@/lib/session";
import { useLive } from "@/lib/useLive";

const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();
const errText = (e: unknown) => (e instanceof AgentError ? e.message : e instanceof Error ? e.message : String(e));

function SignIn() {
  const s = useSession();
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
      <Fog label="Your loan is here">
        <div className="h-[280px]" />
      </Fog>
      <div className="self-center">
        <h2 className="font-serif text-[34px] leading-tight">Sign in to lift the fog.</h2>
        <p className="mt-3 text-ink-2">
          Your position is held only by the Offmap agent. It opens for a session started by a signature from the wallet that owns it. The signature costs nothing and moves no funds.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="btn btn-primary" disabled={s.busy} onClick={s.signInEvm}>
            {s.busy ? "Waiting for wallet…" : "Sign in with EVM wallet"}
          </button>
        </div>
        <p className="mt-3 text-[13px] text-ink-3">Any injected EVM wallet works (MetaMask, Rabby, Coinbase Wallet). The same address is where an eject sends your position.</p>
        {s.error && (
          <div className="mt-4">
            <ErrorLine>{s.error}</ErrorLine>
          </div>
        )}
      </div>
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

function Repay({ token, c, tokens }: { token: string; c: CohortDef; tokens: OneClickToken[] }) {
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
  const units_ = asset ? toUnits(amount, asset.decimals) : null;
  const ok = asset && units_ && addressLooksValid(asset.blockchain, refund);
  if (dep) return <DepositTracker depositAddress={dep.depositAddress} amountLabel={dep.label} deadline={dep.deadline} />;
  return (
    <div>
      <p className="text-ink-2">Pay back from any chain. It lands in the private balance as USDC and repays your share in the next batch.</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <TokenSelect list={list} value={assetId} onChange={setAssetId} label="Pay with" />
        <label className="block">
          <span className="text-[13px] text-ink-2">Amount {asset ? `(${asset.symbol})` : ""}</span>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="0.0" />
        </label>
      </div>
      <label className="mt-4 block">
        <span className="text-[13px] text-ink-2">Refund address on {asset ? chainName(asset.blockchain) : "that chain"}</span>
        <input className="field" value={refund} onChange={(e) => setRefund(e.target.value)} spellCheck={false} />
      </label>
      <button
        className="btn mt-5"
        disabled={busy || !ok}
        onClick={async () => {
          if (!asset || !units_) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await agent<RepayQuoteResp>("/quote/repay", {
              method: "POST",
              token,
              timeoutMs: 45_000,
              body: JSON.stringify({ cohort: c.id, depositAsset: asset.assetId, depositAmount: units_.toString(), refundTo: refund.trim() }),
            });
            setDep({ ...r, label: `${amount} ${asset.symbol} on ${chainName(asset.blockchain)}${r.usdcOut ? `, about ${r.usdcOut} USDC of repayment` : ""}` });
          } catch (e) {
            setErr(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Asking…" : "Get a repay address"}
      </button>
      {err && <div className="mt-3"><ErrorLine>{err}</ErrorLine></div>}
    </div>
  );
}

function RequestForm({ token, c, tokens, onDone }: { token: string; c: CohortDef; tokens: OneClickToken[]; onDone: () => void }) {
  const [kind, setKind] = useState<"borrow" | "withdraw">("borrow");
  const list = useMemo(() => (kind === "borrow" ? usdcTargets(tokens) : collateralAssets(tokens)), [tokens, kind]);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [addr, setAddr] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (list.length && !list.some((t) => t.assetId === assetId)) setAssetId(list[0]!.assetId);
  }, [list, assetId]);
  const asset = list.find((t) => t.assetId === assetId);
  const decimals = kind === "borrow" ? 6 : c.collateralDecimals;
  const amt = toUnits(amount, decimals);
  const ok = asset && amt && addressLooksValid(asset.blockchain, addr);
  return (
    <div>
      <div role="radiogroup" className="flex gap-5">
        {(
          [
            ["borrow", "Borrow more USDC"],
            ["withdraw", `Withdraw ${c.collateralSymbol}`],
          ] as const
        ).map(([v, t]) => (
          <button key={v} role="radio" aria-checked={kind === v} onClick={() => setKind(v)} className={`num min-h-11 border-b-2 text-[12px] uppercase tracking-[0.1em] ${kind === v ? "border-accent text-ink" : "border-transparent text-ink-3"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] text-ink-2">Amount ({kind === "borrow" ? "USDC" : c.collateralSymbol})</span>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="0.0" />
        </label>
        <TokenSelect list={list} value={assetId} onChange={setAssetId} label="Receive as" />
      </div>
      <label className="mt-4 block">
        <span className="text-[13px] text-ink-2">Your address on {asset ? chainName(asset.blockchain) : "that chain"}</span>
        <input className="field" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} />
      </label>
      <p className="mt-3 text-[13px] text-ink-3">
        Applied in the next batch, inside the 60% limit. Payouts leave the private balance in round sized pieces after a random delay, so they are hard to match with your deposit.
      </p>
      <button
        className="btn mt-5"
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
            setMsg(r.queued ? `Queued for the next batch${r.nextBatchWithinSeconds ? `, within ${r.nextBatchWithinSeconds} seconds` : ""}.` : "Not queued.");
            onDone();
          } catch (e) {
            setErr(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : kind === "borrow" ? "Request borrow" : "Request withdraw"}
      </button>
      {msg && <p className="mt-3 text-good">{msg}</p>}
      {err && <div className="mt-3"><ErrorLine>{err}</ErrorLine></div>}
    </div>
  );
}

function CohortPosition({ p, token, tokens, reload }: { p: UserCohortPosition; token: string; tokens: OneClickToken[]; reload: () => void }) {
  const c = cohortById(p.cohort);
  const note: Note | null = useMemo(() => {
    try {
      return p.note ? parseNote(p.note) : null;
    } catch {
      return null;
    }
  }, [p.note]);
  if (!c) return <ErrorLine>The agent returned an unknown cohort ({p.cohort}).</ErrorLine>;

  const collateral = BigInt(p.collateral);
  const debt = BigInt(p.debt);
  const price = Number(p.price) / Number(PRICE_SCALE);
  const ltv = Number(p.ltvBps) / 10_000;
  const liq = p.liquidationPrice ? Number(p.liquidationPrice) / Number(PRICE_SCALE) : null;
  const health = ltv > 0 ? LIQ_LTV / ltv : null;

  return (
    <div className="rule-t pb-14 pt-8">
      <h2 className="display text-[clamp(32px,4vw,52px)]">{c.label}</h2>
      <div className="mt-8 grid gap-14 lg:grid-cols-2">
        <div>
          <div className="eyebrow">Charted for you only</div>
          <div className="mt-4">
            <Row k="Collateral" v={`${units(collateral, c.collateralDecimals, 8)} ${c.collateralSymbol}`} sub={usd((Number(collateral) / 10 ** c.collateralDecimals) * price)} />
            <Row k="Debt" v={`${units(debt, 6, 6)} USDC`} sub="includes interest at Morpho's rate plus 1%" />
            <Row k="Loan to value" v={pct(ltv)} sub="opens up to 60%, private liquidation at 70%" />
            <Row k="Health" v={<span className={health !== null && health < 1.1 ? "text-bad" : "text-good"}>{health === null ? "no debt" : health.toFixed(2)}</span>} sub="above 1 is safe" />
            <Row
              k={<span className="text-accent">Liquidation price</span>}
              v={<span className="text-accent">{liq === null ? "none" : usd(liq, 0)}</span>}
              sub={`${c.collateralSymbol} now ${usd(price, 0)}`}
            />
          </div>
          <Source>From your agent session. These numbers exist nowhere public: Morpho holds only the cohort total.</Source>

          {(p.pending.length > 0 || p.payouts.length > 0 || p.requests.length > 0) && (
            <div className="mt-8">
              <div className="eyebrow mb-2">In motion</div>
              {p.pending.map((x) => (
                <Row key={x.depositAddress} k={`${x.kind} deposit`} v={x.status} sub={short(x.depositAddress, 10, 6)} />
              ))}
              {p.payouts.map((x, i) => (
                <Row
                  key={`p${i}`}
                  k={`Payout ${units(BigInt(x.amount), 6, 6)} USDC`}
                  v={x.tx ? short(x.tx, 8, 6) : x.status}
                  href={x.tx && /^0x[0-9a-f]{64}$/i.test(x.tx) ? basescanTx(x.tx) : undefined}
                  sub={x.status === "queued" ? `random delay, not before ${new Date(x.notBefore).toLocaleTimeString()}` : x.status}
                />
              ))}
              {p.requests.map((r) => (
                <Row key={r.id} k={`${r.kind} ${r.kind === "borrow" ? units(BigInt(r.amount), 6, 6) + " USDC" : units(BigInt(r.amount), c.collateralDecimals, 8) + " " + c.collateralSymbol}`} v={r.status} sub={r.reason ?? ago(r.createdAt)} />
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="eyebrow">Your latest note</div>
          <div className="mt-4">{note ? <NoteVerdict note={note} /> : <NotLive title="No note yet">Your first note arrives after your first batch.</NotLive>}</div>
          {p.note && (
            <button
              className="btn mt-6"
              onClick={() => {
                const blob = new Blob([JSON.stringify(p.note, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `offmap-note-${c.id}-${p.note!.batchId}.json`;
                a.click();
              }}
            >
              Save note
            </button>
          )}
          <p className="mt-3 text-[13px] text-ink-3">Keep your latest note. It is all you need to eject without the agent.</p>
        </div>
      </div>
      <div className="mt-12 grid gap-14 rule-t pt-10 lg:grid-cols-2">
        <div>
          <h3 className="font-serif text-[28px]">Repay</h3>
          <div className="mt-4">
            <Repay token={token} c={c} tokens={tokens} />
          </div>
        </div>
        <div>
          <h3 className="font-serif text-[28px]">Borrow more or withdraw</h3>
          <div className="mt-4">
            <RequestForm token={token} c={c} tokens={tokens} onDone={reload} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Lifted({ token }: { token: string }) {
  const s = useSession();
  const pos = useLive(() => agent<PositionResp>("/position", { token, timeoutMs: 30_000 }), [token], 30_000);
  const tokens = useLive(fetchTokens, [], 300_000);
  const expired = pos.error && /sign in first/i.test(pos.error);
  if (expired)
    return (
      <NotLive title="Your session ended">
        Sign in again to reopen it.{" "}
        <button className="ink-link" onClick={s.signOut}>
          Sign out
        </button>
      </NotLive>
    );
  if (pos.error && !pos.data) return <ErrorLine>Could not open your position: {pos.error}</ErrorLine>;
  if (!pos.data) return <div className="num text-[13px] text-ink-3">Lifting the fog…</div>;
  if (pos.data.positions.length === 0)
    return (
      <NotLive title="No loan yet">
        This wallet has no position in any cohort.{" "}
        <Link className="ink-link" href="/app">
          Start one
        </Link>
        .
      </NotLive>
    );
  return (
    <>
      {pos.data.positions.map((p) => (
        <CohortPosition key={p.cohort} p={p} token={token} tokens={tokens.data ?? []} reload={pos.reload} />
      ))}
      {pos.at && <Source>Refreshed {ago(pos.at)}. Updates every 30 seconds.</Source>}
    </>
  );
}

function PasteNote() {
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <h3 className="font-serif text-[28px]">Check a saved note</h3>
      <p className="mt-2 max-w-xl text-ink-2">Works without the agent. Your note&apos;s Merkle proof is checked in this browser against the root on NEAR. Nothing is sent anywhere.</p>
      <textarea className="field mt-4 min-h-36 resize-y font-mono text-[13px]" placeholder='{"cohortId":"cbbtc-usdc","userId":"0x…","collateral":"…", …}' value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button
        className="btn mt-4"
        disabled={!text.trim()}
        onClick={() => {
          try {
            setNote(parseNote(text));
            setErr(null);
          } catch (e) {
            setNote(null);
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Check proof
      </button>
      {err && (
        <div className="mt-4">
          <ErrorLine>{err}</ErrorLine>
        </div>
      )}
      {note && (
        <div className="mt-8">
          <NoteVerdict note={note} />
        </div>
      )}
    </div>
  );
}

export function PositionView() {
  const s = useSession();
  const who = s.owner ? (s.owner.kind === "evm" ? short(s.owner.address) : s.owner.accountId) : null;
  return (
    <>
      <PageHead sheet="Sheet 03 · Your view" title={<>Only you see this sheet.</>}>
        Collateral, debt, health and liquidation price, read from the private ledger for your signature alone.
      </PageHead>
      {s.owner && (
        <div className="mb-10 flex flex-wrap items-center gap-4 rule-t pt-4 text-[14px]">
          <span className={s.token ? "dot dot-live" : "dot dot-off"} />
          <span className="num">{who}</span>
          <span className="text-ink-3">{s.token ? "session open" : "no session"}</span>
          <button className="num ink-link text-[12px] uppercase tracking-[0.1em]" onClick={s.signOut}>
            Sign out
          </button>
          <Link className="num ink-link ml-auto text-[12px] uppercase tracking-[0.1em]" href="/eject">
            Eject to my own wallet →
          </Link>
        </div>
      )}
      {!s.owner && <SignIn />}
      {s.owner && s.token && <Lifted token={s.token} />}
      {s.owner && !s.token && (
        <div>
          <NotLive title={agentConfigured ? "No session" : "The agent is not live yet"}>{s.note ?? "Sign in again to open a session."}</NotLive>
          {agentConfigured && (
            <button className="btn btn-primary mt-5" disabled={s.busy} onClick={s.signInEvm}>
              {s.busy ? "Waiting for wallet…" : "Sign in again"}
            </button>
          )}
        </div>
      )}
      <div className="mt-20 rule-t pt-10">
        <PasteNote />
      </div>
    </>
  );
}
