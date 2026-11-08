import { CONTRACT_ID, NEAR_RPC } from "./config";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "offmap", method, params }),
  });
  if (!r.ok) throw new Error(`NEAR RPC ${r.status}`);
  const j = (await r.json()) as { result?: T; error?: { cause?: { name?: string }; data?: string; message?: string } };
  if (j.error) {
    const e = new Error(j.error.data || j.error.message || "NEAR RPC error") as Error & { code?: string };
    e.code = j.error.cause?.name;
    throw e;
  }
  return j.result as T;
}

export type ContractState =
  | { kind: "missing"; contractId: string }
  | { kind: "no_code"; contractId: string }
  | { kind: "live"; contractId: string; codeHash: string; accessKeys: number }
  | { kind: "error"; contractId: string; message: string };

const EMPTY_CODE = "11111111111111111111111111111111";

export async function contractState(contractId = CONTRACT_ID): Promise<ContractState> {
  try {
    const acc = await rpc<{ code_hash: string }>("query", { request_type: "view_account", finality: "final", account_id: contractId });
    if (acc.code_hash === EMPTY_CODE) return { kind: "no_code", contractId };
    const keys = await rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: contractId });
    return { kind: "live", contractId, codeHash: acc.code_hash, accessKeys: keys.keys.length };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNKNOWN_ACCOUNT") return { kind: "missing", contractId };
    return { kind: "error", contractId, message: err.message };
  }
}

/** Calls a view method and parses its JSON result. */
export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = CONTRACT_ID): Promise<T> {
  const argsB64 = btoa(JSON.stringify(args));
  const res = await rpc<{ result?: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: argsB64,
  });
  if (res.error || !res.result) {
    const m = res.error ?? "view call returned nothing";
    throw new Error((m.match(/panic_msg: "(.+?)"/)?.[1] ?? m.match(/Smart contract panicked: ([^"\n]+)/)?.[1] ?? m).trim());
  }
  const text = new TextDecoder().decode(new Uint8Array(res.result));
  return JSON.parse(text) as T;
}

import type { ContractConfigWire, StatementWire, StoredStatementWire } from "./eject";

/** Statement as stored by offmap.near (contracts/near/src/types.rs Statement). */
export type ChainStatement = StatementWire;

/** The contract's `statement(cohort_id)` view returns { statement, accepted_at_ms, agent }. */
export async function readStoredStatement(cohortId: string): Promise<StoredStatementWire | null> {
  return view<StoredStatementWire | null>("statement", { cohort_id: cohortId });
}

export async function readStatement(cohortId: string): Promise<ChainStatement | null> {
  return (await readStoredStatement(cohortId))?.statement ?? null;
}

export async function readConfig(): Promise<ContractConfigWire> {
  return view<ContractConfigWire>("config");
}
