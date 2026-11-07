import { type BatchContext, DEFAULT_RISK, type Cohort, type Hex, type UserPosition, bytesToHex } from "../src/index.js";

export const BTC: Cohort = {
  id: "cbbtc",
  collateralAsset: "cbBTC",
  collateralDecimals: 8,
  loanDecimals: 6,
  lltvBps: 8600n,
  cohortCeilingBps: 5000n,
  sizeCapLoan: 1_000_000n * 10n ** 6n,
};

/** 1 cbBTC = 100,000 USDC at the 1e8 price scale. */
export const P100K = 100_000n * 10n ** 8n;
export const USDC = (n: number): bigint => BigInt(n) * 10n ** 6n;
export const BTCU = (n: number): bigint => BigInt(Math.round(n * 1e8));

export const RISK = { ...DEFAULT_RISK, userCapLoan: USDC(200_000) };

/** Deterministic test salt (the real agent passes a CSPRNG). */
export const saltFor = (userId: string, nonce: bigint): Hex =>
  bytesToHex(Uint8Array.from({ length: 32 }, (_, i) => (userId.length * 7 + Number(nonce) * 13 + i) & 0xff));

export function ctx(over: Partial<BatchContext> = {}, t = 1000): BatchContext {
  return { price: P100K, timestamp: t, aprBps: 0n, spreadBps: 0n, risk: RISK, saltFor, ...over };
}

export function pos(userId: string, collateral: bigint, debt: bigint, nonce = 1n): UserPosition {
  return { userId, cohortId: BTC.id, collateral, debt, nonce, salt: saltFor(userId, nonce) };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
