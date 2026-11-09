import type { TerrainPoint } from "@/components/ThermalTerrain";
import { COHORTS } from "./config";
import { readLevels, type MarketLevels } from "./morpho";
import { loadCohorts } from "./world";

/** Stable 0..1 from an address, so a borrower keeps its place on the map between refreshes. */
export function lane(addr: string): number {
  let h = 2166136261;
  for (let i = 0; i < addr.length; i++) {
    h ^= addr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

export interface TerrainData {
  points: TerrainPoint[];
  markets: MarketLevels[];
  /** Sum of public borrowing across the mapped markets, in USD. */
  publicDebtUsd: number;
  /** Open borrowers across the mapped markets. */
  borrowers: number;
  /** The Offmap cohort's own public liquidation price over today's price, when the agent publishes it. */
  cohortRatio: number | null;
  mapped: number;
}

/** Every public borrower's liquidation level on Offmap's two markets, plus where the Offmap cohort sits. */
export async function loadTerrain(perMarket = 400): Promise<TerrainData> {
  const [markets, cohorts] = await Promise.all([Promise.all(COHORTS.map((c) => readLevels(c, perMarket))), loadCohorts()]);
  const points: TerrainPoint[] = [];
  markets.forEach((m) => {
    for (const l of m.levels) points.push({ ratio: l.liquidationPrice / m.priceUsd, debtUsd: l.debtUsd, lane: lane(l.address) });
  });
  let cohortRatio: number | null = null;
  for (const k of cohorts.cohorts) {
    const c = COHORTS.find((x) => x.id === k.cohort);
    const m = markets.find((x) => x.marketId === c?.marketId);
    if (!c || !m) continue;
    const coll = Number(k.morpho.collateral) / 10 ** c.collateralDecimals;
    const debt = Number(k.morpho.debt) / 1e6;
    if (coll > 0 && debt > 0) {
      cohortRatio = debt / (coll * (Number(c.core.lltvBps) / 10_000)) / m.priceUsd;
      break;
    }
  }
  return {
    points,
    markets,
    publicDebtUsd: markets.reduce((n, m) => n + m.borrowUsd, 0),
    borrowers: markets.reduce((n, m) => n + m.borrowers, 0),
    cohortRatio,
    mapped: points.length,
  };
}
