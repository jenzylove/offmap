"use client";

import { useState } from "react";
import { ErrorLine, NotLive, Row, Source } from "@/components/Bits";
import { COHORTS } from "@/lib/config";
import { compactUsd, pct, short } from "@/lib/format";
import { readLevels, readWalletLoans, type WalletLoan } from "@/lib/morpho";

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

function money(n: number, sym: string) {
  const v = n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return /USD/i.test(sym) ? `$${v}` : `${v} ${sym}`;
}

type State = { busy: boolean; error?: string; who?: string; loans?: WalletLoan[] };

/** Paste any Base wallet and read its loans the way a liquidation hunter does: straight from the public Morpho API. */
export function WalletCheck() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ busy: false });

  async function check(addr: string) {
    const a = addr.trim();
    if (!isAddress(a)) return setState({ busy: false, error: "That is not a Base wallet address. It starts with 0x and has 42 characters." });
    setState({ busy: true });
    try {
      setState({ busy: false, who: a, loans: await readWalletLoans(a) });
    } catch (e: any) {
      setState({ busy: false, error: `Could not read the Morpho public API: ${String(e?.message ?? e)}` });
    }
  }

  async function whale() {
    setState({ busy: true });
    try {
      const top = (await readLevels(COHORTS[0]!, 1)).levels[0];
      if (!top) throw new Error("no open loans returned");
      setInput(top.address);
      await check(top.address);
    } catch (e: any) {
      setState({ busy: false, error: `Could not read the Morpho public API: ${String(e?.message ?? e)}` });
    }
  }

  return (
    <div>
      <form
        className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void check(input);
        }}
      >
        <input
          className="num min-h-12 w-full min-w-0 flex-1 border border-[var(--rule)] bg-transparent px-4 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-[var(--ink-2)]"
          placeholder="Paste any Base wallet, 0x…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Wallet address"
        />
        <button type="submit" disabled={state.busy} className="num min-h-12 bg-[var(--ink)] px-6 text-[12px] uppercase tracking-[0.14em] text-[var(--paper)] disabled:opacity-50">
          {state.busy ? "Reading…" : "Look it up"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void whale()}
        disabled={state.busy}
        className="num mt-3 min-h-11 text-left text-[12px] uppercase tracking-[0.14em] text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
      >
        No loan of your own? Try the biggest cbBTC borrower
      </button>

      <div className="mt-8 max-w-2xl" aria-live="polite">
        {state.error && <ErrorLine>{state.error}</ErrorLine>}
        {state.loans && state.who && state.loans.length === 0 && (
          <NotLive title="Nothing to hunt here">
            {short(state.who, 6, 4)} has no open loan on Morpho, Base. Paste a wallet that borrows, or try the biggest borrower above.
          </NotLive>
        )}
        {state.loans && state.who && state.loans.length > 0 && (
          <div>
            <div className="eyebrow mb-2">What anyone can read about {short(state.who, 6, 4)}</div>
            {state.loans.slice(0, 6).map((l) => (
              <Row
                key={l.marketId}
                k={`${l.collateralSymbol} / ${l.loanSymbol}${l.debtUsd ? `, ${compactUsd(l.debtUsd)} borrowed` : ""}`}
                sub={`now ${money(l.priceNow, l.loanSymbol)} per ${l.collateralSymbol}`}
                v={
                  <span>
                    <span className="text-heat">{money(l.liquidationPrice, l.loanSymbol)}</span>
                    <span className="text-ink-3"> · {pct(l.dropToLiquidation, 0)} drop</span>
                  </span>
                }
              />
            ))}
            <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
              That is the liquidation line a hunter aims at, read in one request with no login. Borrow through Offmap and this lookup on your wallet comes back empty, because Morpho only sees the pool.
            </p>
            <Source>Morpho public API, Base. Liquidation price is the oracle price divided by the loan's health factor.</Source>
          </div>
        )}
      </div>
    </div>
  );
}
