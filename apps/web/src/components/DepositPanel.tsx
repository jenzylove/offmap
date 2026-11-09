"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { UserCohortPosition } from "@/lib/agent";
import { ago } from "@/lib/format";
import { fetchStatus, STATUS_WORDS, type SwapStatus } from "@/lib/oneclick";
import { Details, Row } from "./Bits";

const FINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export function useCountdown(deadline?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const end = new Date(deadline).getTime();
  if (!Number.isFinite(end)) return null;
  const left = Math.max(0, Math.round((end - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return { left, text: h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}` };
}

export interface Stage {
  key: string;
  label: string;
  hint: string;
}

/** Status timeline: done stages are cold, the live one pulses, the rest wait. */
export function Timeline({ stages, at, failed }: { stages: Stage[]; at: number; failed?: string | null }) {
  return (
    <ol className="relative">
      {stages.map((st, i) => {
        const done = i < at;
        const live = i === at && !failed;
        return (
          <li key={st.key} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-4 pb-6 last:pb-0">
            {i < stages.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-20px)] w-px ${done ? "bg-cold/60" : "bg-white/10"}`} />}
            <span className={`relative mt-0.5 grid h-7 w-7 place-items-center rounded-full ${done ? "bg-cold text-[var(--accent-ink)]" : live ? "ring-1 ring-cold" : "ring-1 ring-white/15"}`}>
              {done ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 6.2l2.3 2.3L9.5 3.6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                </svg>
              ) : live ? (
                <>
                  <span className="absolute inset-0 rounded-full ring-1 ring-cold pulse-ring" />
                  <span className="h-2 w-2 rounded-full bg-cold" />
                </>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
              )}
            </span>
            <div>
              <div className={`text-[15px] ${done || live ? "text-ink" : "text-ink-3"}`}>{st.label}</div>
              {(live || (failed && i === at)) && <div className={`mt-0.5 text-[13px] ${failed ? "text-bad" : "text-ink-2"}`}>{failed ?? st.hint}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function useOneClick(depositAddress: string) {
  const [status, setStatus] = useState<SwapStatus | { status: "NOT_FOUND" } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await fetchStatus(depositAddress);
        if (stop) return;
        setStatus(s);
        setErr(null);
        setAt(Date.now());
        if (FINAL.has(s.status)) return;
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : String(e));
      }
      if (!stop) timer = setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [depositAddress]);
  return { status, err, at };
}

/** Where a borrow deposit stands, from 1Click's status and the agent's view of your position. */
export function borrowStage(oneclick: string, positions: UserCohortPosition[] | undefined, depositAddress: string, startedAt: number | null) {
  const all = positions ?? [];
  const pend = all.flatMap((p) => p.pending).find((x) => x.depositAddress.toLowerCase() === depositAddress.toLowerCase());
  const since = (startedAt ?? 0) - 120_000;
  const borrowed = all.some((p) => p.requests.some((r) => r.kind === "borrow" && r.status === "applied" && r.createdAt >= since));
  const paid = all.some((p) => p.payouts.some((x) => x.status === "done" && x.notBefore >= since));
  const landed = oneclick === "SUCCESS";
  if (paid) return 5;
  if (borrowed) return 4;
  if (pend?.status === "supplied" || (landed && positions && !pend)) return 3;
  if (landed || (pend && ["arrived", "onbase"].includes(pend.status))) return 2;
  if (["KNOWN_DEPOSIT_TX", "PROCESSING"].includes(oneclick)) return 1;
  return 0;
}

export function DepositPanel({
  depositAddress,
  memo,
  amountLabel,
  deadline,
  stages,
  stage,
  failed,
  oneclick,
}: {
  depositAddress: string;
  memo?: string;
  amountLabel?: string;
  deadline?: string;
  stages: Stage[];
  stage: number;
  failed?: string | null;
  oneclick: ReturnType<typeof useOneClick>;
}) {
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);
  const left = useCountdown(deadline);
  useEffect(() => {
    QRCode.toString(depositAddress, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b0c0e", light: "#00000000" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [depositAddress]);
  const s = oneclick.status?.status ?? "NOT_FOUND";
  const details = oneclick.status && "swapDetails" in oneclick.status ? oneclick.status.swapDetails : undefined;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
      <div>
        {amountLabel && (
          <p className="text-[20px] leading-snug text-ink md:text-[22px]">
            Send <span className="num text-cold">{amountLabel}</span> to this address.
          </p>
        )}
        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="w-[180px] flex-none rounded-2xl bg-[#eceef0] p-4">
            <div className="aspect-square w-full" aria-label="Deposit address as a QR code" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow">One time deposit address</div>
            <div className="num mt-2 break-all text-[16px] leading-snug text-ink" data-testid="deposit-address">
              {depositAddress}
            </div>
            <button
              className="btn btn-sm mt-4"
              onClick={() => {
                void navigator.clipboard.writeText(depositAddress).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            {memo && (
              <div className="mt-4 text-[14px]">
                <span className="eyebrow">Memo, required</span> <span className="num">{memo}</span>
              </div>
            )}
          </div>
        </div>
        {left && (
          <div className="mt-8 flex items-baseline gap-3 rule-t pt-5">
            <span className="eyebrow">Address expires in</span>
            <span className={`num text-[20px] ${left.left < 600 ? "text-heat" : "text-ink"}`}>{left.left > 0 ? left.text : "expired"}</span>
          </div>
        )}
        <p className="mt-4 max-w-md text-[14px] text-ink-3">Send from any wallet on that chain. If less arrives or it comes too late, it goes back to your refund address.</p>
      </div>
      <div>
        <div className="eyebrow mb-5">Live status</div>
        <Timeline stages={stages} at={stage} failed={failed} />
        <Details label="Details">
          <Row k="Deposit status, 1Click" v={s} sub={STATUS_WORDS[s]} />
          {details?.amountInFormatted && <Row k="Amount seen" v={details.amountInFormatted} />}
          {details?.originChainTxHashes?.map((h) => <Row key={h.hash} k="Deposit transaction" v={`${h.hash.slice(0, 10)}…${h.hash.slice(-6)}`} href={h.explorerUrl || undefined} />)}
          <Row k="Resume link" v="this page with ?deposit=" sub={depositAddress} />
          {oneclick.err && <p className="mt-2 text-[13px] text-bad">Status check failed: {oneclick.err}. Retrying.</p>}
          <p className="num mt-3 text-[11px] text-ink-3">Checked {oneclick.at ? ago(oneclick.at) : "…"} from 1Click, and from your agent session every 10 seconds.</p>
        </Details>
      </div>
    </div>
  );
}
