"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { fetchStatus, STATUS_WORDS, type SwapStatus } from "@/lib/oneclick";
import { ago } from "@/lib/format";

const STEPS = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
const FINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export function DepositTracker({
  depositAddress,
  memo,
  amountLabel,
  deadline,
}: {
  depositAddress: string;
  memo?: string;
  amountLabel?: string;
  deadline?: string;
}) {
  const [svg, setSvg] = useState<string>("");
  const [status, setStatus] = useState<SwapStatus | { status: "NOT_FOUND" } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toString(depositAddress, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#17284a", light: "#00000000" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [depositAddress]);

  useEffect(() => {
    let stop = false;
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
      if (!stop) setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [depositAddress]);

  const s = status?.status ?? "NOT_FOUND";
  const stepIdx = s === "NOT_FOUND" ? 0 : Math.max(0, STEPS.indexOf(s));
  const details = status && "swapDetails" in status ? status.swapDetails : undefined;

  return (
    <div className="grid gap-10 md:grid-cols-[220px_1fr]">
      <div>
        <div className="aspect-square w-full max-w-[220px] bg-[#f3eee2] p-3" aria-label="Deposit address QR code" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="num mt-2 text-[11px] text-ink-3">Scan with the wallet you deposit from.</div>
      </div>
      <div>
        <div className="eyebrow">One time deposit address</div>
        <div className="num mt-2 break-all text-[18px] text-ink">{depositAddress}</div>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(depositAddress).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
        </div>
        {memo && (
          <div className="mt-4 text-[14px]">
            <span className="eyebrow">Memo, required</span> <span className="num">{memo}</span>
          </div>
        )}
        {amountLabel && (
          <div className="mt-4 text-[15px] text-ink-2">
            Send exactly <span className="num text-ink">{amountLabel}</span>
            {deadline ? (
              <>
                {" "}
                before <span className="num">{new Date(deadline).toLocaleString()}</span>
              </>
            ) : null}
            .
          </div>
        )}

        <ol className="mt-8">
          {STEPS.map((st, i) => (
            <li key={st} className="flex items-center gap-3 rule-t py-2.5 text-[14px]">
              <span className={i < stepIdx || s === "SUCCESS" ? "dot dot-live" : i === stepIdx && !FINAL.has(s) ? "dot dot-hot" : "dot dot-off"} />
              <span className={i <= stepIdx ? "text-ink" : "text-ink-3"}>
                {["Waiting for deposit", "Deposit seen", "Confirming and shielding", "In your private balance"][i]}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[15px] text-ink" aria-live="polite">
          {STATUS_WORDS[s] ?? s}
        </p>
        {details?.originChainTxHashes?.map((h) => (
          <a key={h.hash} className="num ink-link mt-1 block break-all text-[12px]" href={h.explorerUrl || "#"} target="_blank" rel="noreferrer">
            deposit tx {h.hash}
          </a>
        ))}
        {err && <p className="mt-2 text-[13px] text-bad">Status check failed: {err}. Retrying.</p>}
        <p className="num mt-3 text-[11px] text-ink-3">
          Live from 1Click /v0/status{at ? `, checked ${ago(at)}` : ""}. Bookmark this page to come back:{" "}
          <span className="break-all">?deposit={depositAddress}</span>
        </p>
      </div>
    </div>
  );
}
