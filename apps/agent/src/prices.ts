import { PRICE_SCALE } from "@offmap/core";
import { abi, client, marketParams } from "./base.js";
import type { CohortConfig } from "./config.js";

/** Price in core units: loan tokens per ONE whole collateral token, scaled by 1e8. */
export interface PriceReading { source: string; price: bigint }

/** Morpho's own market oracle. Its price is 1e36 scaled per smallest units: core = p * 10^(collDec - loanDec) * 1e8 / 1e36. */
async function morphoOracle(c: CohortConfig): Promise<PriceReading> {
  const { oracle } = await marketParams(c);
  const p = await client.readContract({ address: oracle, abi, functionName: "price" });
  const num = p * 10n ** BigInt(c.collateralDecimals) * PRICE_SCALE;
  return { source: "morpho-oracle", price: num / 10n ** BigInt(36 + c.loanDecimals) };
}

/** Kraken public ticker, last trade price. */
async function kraken(c: CohortConfig): Promise<PriceReading> {
  const r: any = await (await fetch(`https://api.kraken.com/0/public/Ticker?pair=${c.kraken}`, { signal: AbortSignal.timeout(10_000) })).json();
  if (r.error?.length) throw new Error(`kraken ${r.error.join(",")}`);
  const last = String((Object.values(r.result)[0] as any).c[0]);
  const [w, f = ""] = last.split(".");
  return { source: "kraken", price: BigInt(w!) * PRICE_SCALE + BigInt((f + "00000000").slice(0, 8)) };
}

async function coinbase(c: CohortConfig): Promise<PriceReading> {
  const r: any = await (await fetch(`https://api.coinbase.com/v2/prices/${c.coinbase}/spot`, { signal: AbortSignal.timeout(10_000) })).json();
  const [w, f = ""] = String(r.data.amount).split(".");
  return { source: "coinbase", price: BigInt(w!) * PRICE_SCALE + BigInt((f + "00000000").slice(0, 8)) };
}

export interface PriceResult { price: bigint; readings: PriceReading[]; errors: string[] }

/** Median of three independent sources. Refuses when fewer than two respond or when they split by more than 2%. */
export async function cohortPrice(c: CohortConfig): Promise<PriceResult> {
  const settled = await Promise.allSettled([morphoOracle(c), kraken(c), coinbase(c)]);
  const readings = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [String(s.reason)] : []));
  if (readings.length < 2) throw new Error(`price: only ${readings.length} sources (${errors.join("; ")})`);
  const sorted = readings.map((r) => r.price).sort((a, b) => (a < b ? -1 : 1));
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  if ((hi - lo) * 10_000n > 200n * lo) throw new Error(`price: sources split ${readings.map((r) => `${r.source}=${r.price}`).join(", ")}`);
  const price = sorted.length === 2 ? (sorted[0]! + sorted[1]!) / 2n : sorted[1]!;
  return { price, readings, errors };
}
