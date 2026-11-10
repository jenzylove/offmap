import { AGENT_URL } from "./config";

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "unreachable" | "http",
    public readonly status?: number,
  ) {
    super(message);
  }
}

export const agentConfigured = AGENT_URL.length > 0;

export async function agent<T>(path: string, init: RequestInit & { token?: string; timeoutMs?: number } = {}): Promise<T> {
  if (!agentConfigured) throw new AgentError("The Offmap agent address is not configured yet.", "not_configured");
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let r: Response | undefined;
  // The agent sits behind a sealed hardware gateway that is sometimes slow to wake: try twice before giving up.
  const tries = !init.method || init.method === "GET" ? 2 : 1; // never resend a POST: it could open a second deposit
  for (let attempt = 0; attempt < tries && !r; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
    try {
      r = await fetch(`${AGENT_URL}${path}`, { ...init, headers, signal: ctrl.signal });
    } catch {
      /* retried once below */
    } finally {
      clearTimeout(t);
    }
  }
  if (!r) throw new AgentError("Offmap's agent is slow to answer right now. Give it a minute and try again.", "unreachable");
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!r.ok) {
    const b = body as { error?: unknown; message?: unknown } | null;
    const msg: string = b && typeof b === "object" && (b.error || b.message) ? String(b.error ?? b.message) : `HTTP ${r.status}`;
    throw new AgentError(msg, "http", r.status);
  }
  return body as T;
}

/* Shapes from apps/agent/src/server.ts. bigint values arrive as decimal strings. */

export interface AgentHealth {
  agent: string;
  intentsOwner?: string;
  tee: boolean | Record<string, unknown> | null;
  contract: string | null;
  cohorts: { id: string; address: string }[];
  lastBatch: BatchLog | null;
}

export interface BatchLog {
  batchId: string;
  cohortId: string;
  at: number;
  txs: string[];
  statementTx?: string;
  delta: { collateral: string; debt: string };
}

export interface PublicCohort {
  cohort: string;
  address: string;
  market: string;
  morpho: { supplyShares: string; borrowShares: string; collateral: string; debt: string };
  ledgerTotals: { collateral: string; debt: string; reserve: string };
  /** Collateral value in USDC smallest units at the agent's price. */
  collateralValue: string;
  lastBatch: BatchLog | null;
}

export interface PublicCohortsResp {
  contract: string | null;
  cohorts: PublicCohort[];
}

/** Either { status: "not yet run" } or the published study. Rendered generically. */
export type LeakResp = { status: string } | Record<string, unknown>;

export interface BorrowQuoteReq {
  cohort: string;
  depositAsset: string;
  depositAmount: string;
  borrowUsdc: string;
  receiveAsset: string;
  receiveAddress: string;
  refundTo: string;
}

export interface BorrowQuoteResp {
  depositAddress: string;
  amountIn?: string;
  collateralOut?: string;
  ltvBps?: number;
  deadline?: string;
  depositMemo?: string;
}

export interface RepayQuoteResp {
  depositAddress: string;
  amountIn?: string;
  usdcOut?: string;
  deadline?: string;
}

export interface NoteWire {
  cohortId: string;
  userId: string;
  collateral: string;
  debt: string;
  nonce: string;
  salt: string;
  root: string;
  proof: { index: number; siblings: string[] };
  batchId: string;
}

export interface UserCohortPosition {
  cohort: string;
  collateral: string;
  debt: string;
  ltvBps: string;
  /** 1e8 scaled USDC per whole collateral token, or null. */
  liquidationPrice: string | null;
  /** 1e8 scaled price the agent used. */
  price: string;
  note: NoteWire | null;
  pending: { kind: string; status: string; depositAddress: string }[];
  payouts: { amount: string; status: string; notBefore: number; tx?: string }[];
  requests: { id: string; kind: string; amount: string; status: string; reason?: string; createdAt: number }[];
}

export interface PositionResp {
  address: string;
  userId: string;
  positions: UserCohortPosition[];
}

export async function publicCohorts(): Promise<PublicCohortsResp> {
  return agent<PublicCohortsResp>("/public/cohorts", { timeoutMs: 30_000 });
}
