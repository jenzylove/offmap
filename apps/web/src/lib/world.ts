import type { Address } from "viem";
import { AgentError, agentConfigured, publicCohorts, type PublicCohort } from "./agent";
import { SPIKE_ADDRESS, type CohortDef } from "./config";
import { readLevels, readMarket, readPosition, type MarketLevels, type MarketOnChain, type PositionOnChain } from "./morpho";

export type AgentState = { kind: "live" } | { kind: "not_configured" } | { kind: "unreachable"; message: string };

export interface WorldPosition {
  label: string;
  kind: "cohort" | "spike";
  pos: PositionOnChain;
  published?: PublicCohort;
}

export interface World {
  market: MarketOnChain;
  positions: WorldPosition[];
  agent: AgentState;
}

/** The agent's published cohorts, or why they are not available. */
export async function loadCohorts(): Promise<{ agent: AgentState; cohorts: PublicCohort[] }> {
  if (!agentConfigured) return { agent: { kind: "not_configured" }, cohorts: [] };
  try {
    const r = await publicCohorts();
    return { agent: { kind: "live" }, cohorts: r.cohorts ?? [] };
  } catch (e) {
    return { agent: { kind: "unreachable", message: e instanceof AgentError ? e.message : String(e) }, cohorts: [] };
  }
}

/** Everything an outside observer can read about one cohort's market, live from Base. */
export async function loadWorld(c: CohortDef): Promise<World> {
  const [market, cohorts] = await Promise.all([readMarket(c), loadCohorts()]);
  const positions: WorldPosition[] = [];
  const mine = cohorts.cohorts.filter((x) => x.cohort === c.id && /^0x[0-9a-fA-F]{40}$/.test(x.address));
  for (const k of mine) {
    positions.push({ label: `Offmap cohort ${c.label}`, kind: "cohort", pos: await readPosition(c, k.address as Address, market), published: k });
  }
  // Until the agent publishes cohort addresses, show the spike position (cbBTC/USDC only), labelled as a test.
  if (mine.length === 0 && c.id === "cbbtc-usdc") {
    positions.push({ label: "Spike position (test)", kind: "spike", pos: await readPosition(c, SPIKE_ADDRESS, market) });
  }
  return { market, positions, agent: cohorts.agent };
}

export async function loadLevels(c: CohortDef): Promise<MarketLevels> {
  return readLevels(c, 500);
}
