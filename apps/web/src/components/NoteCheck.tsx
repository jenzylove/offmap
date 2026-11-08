"use client";

import type { Note } from "@offmap/core";
import { useEffect, useState } from "react";
import { CONTRACT_ID, nearblocksAddr } from "@/lib/config";
import { short, units } from "@/lib/format";
import { contractState, readStatement, type ContractState } from "@/lib/near";
import { checkNote, type ProofCheck } from "@/lib/notes";
import { cohortById } from "@/lib/config";

export interface RootLookup {
  contract: ContractState;
  root: string | null;
  why: string | null;
}

export async function lookupRoot(cohortId: string): Promise<RootLookup> {
  const contract = await contractState();
  if (contract.kind === "missing") return { contract, root: null, why: `${CONTRACT_ID} does not exist on NEAR mainnet yet.` };
  if (contract.kind === "no_code") return { contract, root: null, why: `${CONTRACT_ID} exists but has no contract deployed yet.` };
  if (contract.kind === "error") return { contract, root: null, why: `Could not read ${CONTRACT_ID}: ${contract.message}` };
  try {
    const s = await readStatement(cohortId);
    if (!s) return { contract, root: null, why: `${CONTRACT_ID} has no statement for ${cohortId} yet.` };
    return { contract, root: s.merkle_root, why: null };
  } catch (e) {
    return { contract, root: null, why: `Could not read the statement: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Shows the result of checking a note's Merkle proof against the on chain root. */
export function NoteVerdict({ note }: { note: Note }) {
  const [res, setRes] = useState<{ check: ProofCheck; lookup: RootLookup } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    lookupRoot(note.cohortId)
      .then((lookup) => live && setRes({ lookup, check: checkNote(note, lookup.root) }))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [note]);

  const c = cohortById(note.cohortId);
  return (
    <div>
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Cohort</dt>
          <dd>{note.cohortId}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Collateral</dt>
          <dd>{c ? `${units(note.collateral, c.collateralDecimals, 8)} ${c.collateralSymbol}` : note.collateral.toString()}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Debt</dt>
          <dd>{units(note.debt, 6, 2)} USDC</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Nonce · slot</dt>
          <dd>
            {note.nonce.toString()} · {note.proof.index}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex items-start gap-4 rule-t pt-5" aria-live="polite">
        {!res && !err && <span className="num text-[13px] text-ink-3">Reading the root from {CONTRACT_ID}…</span>}
        {err && <span className="text-bad">Check failed: {err}</span>}
        {res && <Verdict check={res.check} why={res.lookup.why} />}
      </div>
    </div>
  );
}

function Mark({ tone }: { tone: "good" | "warn" | "bad" }) {
  const col = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : "var(--bad)";
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className="flex-none">
      <circle cx="17" cy="17" r="15.5" fill="none" stroke={col} strokeWidth="1.6" />
      {tone === "good" ? (
        <path d="M10 17.5l4.5 4.5L24.5 12" fill="none" stroke={col} strokeWidth="2.2" strokeLinecap="round" />
      ) : tone === "warn" ? (
        <path d="M17 9v10M17 23.5v1" stroke={col} strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path d="M11.5 11.5l11 11M22.5 11.5l-11 11" stroke={col} strokeWidth="2.2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function Verdict({ check, why }: { check: ProofCheck; why: string | null }) {
  if (check.kind === "verified")
    return (
      <>
        <Mark tone="good" />
        <div>
          <div className="font-serif text-[22px] text-good">Your position is counted.</div>
          <p className="mt-1 text-[14px] text-ink-2">
            The leaf from your note hashes up to the root stored on{" "}
            <a className="ink-link" href={nearblocksAddr(CONTRACT_ID)} target="_blank" rel="noreferrer">
              {CONTRACT_ID}
            </a>
            .
          </p>
          <div className="num mt-2 text-[11px] text-ink-3">
            leaf {short(check.leaf, 10, 8)} · root {short(check.root, 10, 8)}
          </div>
        </div>
      </>
    );
  if (check.kind === "self_only")
    return (
      <>
        <Mark tone="warn" />
        <div>
          <div className="font-serif text-[22px]">The proof is consistent, but not yet checked on chain.</div>
          <p className="mt-1 text-[14px] text-ink-2">
            The note&apos;s leaf hashes up to the root written in the note itself. {why ?? ""} Until then there is no public root to compare it with.
          </p>
          <div className="num mt-2 text-[11px] text-ink-3">
            leaf {short(check.leaf, 10, 8)} · note root {short(check.root, 10, 8)}
          </div>
        </div>
      </>
    );
  if (check.kind === "stale")
    return (
      <>
        <Mark tone="warn" />
        <div>
          <div className="font-serif text-[22px]">This note is from an older batch.</div>
          <p className="mt-1 text-[14px] text-ink-2">
            The root on chain has moved on. Ask the agent for your latest note from your view. If the agent is gone, the contract&apos;s recovery mode accepts your latest note.
          </p>
          <div className="num mt-2 text-[11px] text-ink-3">
            note root {short(check.noteRoot, 10, 8)} · chain root {short(check.chainRoot, 10, 8)} · self consistent {check.selfConsistent ? "yes" : "no"}
          </div>
        </div>
      </>
    );
  return (
    <>
      <Mark tone="bad" />
      <div>
        <div className="font-serif text-[22px] text-bad">The proof does not match.</div>
        <p className="mt-1 text-[14px] text-ink-2">The note&apos;s fields do not hash up to its root. It may have been edited or copied wrong.</p>
        <div className="num mt-2 text-[11px] text-ink-3">
          leaf {short(check.leaf, 10, 8)} · root {short(check.root, 10, 8)}
        </div>
      </div>
    </>
  );
}
