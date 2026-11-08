import { createPublicClient, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { BASE_RPC, MORPHO, MORPHO_API, type CohortDef } from "./config";

export const baseClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

export const morphoAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function nonce(address user) view returns (uint256)",
  "function isAuthorized(address authorizer, address authorized) view returns (bool)",
]);
const oracleAbi = parseAbi(["function price() view returns (uint256)"]);

export interface MarketOnChain {
  totalSupplyAssets: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lltv: bigint;
  oracle: Address;
  /** Raw Morpho oracle price, 1e36 scaled, loan units per collateral unit. */
  oraclePrice: bigint;
  /** USD (USDC) per whole collateral token. */
  priceUsd: number;
  block: bigint;
}

export async function readMarket(c: CohortDef): Promise<MarketOnChain> {
  const [m, params, block] = await Promise.all([
    baseClient.readContract({ address: MORPHO, abi: morphoAbi, functionName: "market", args: [c.marketId] }),
    baseClient.readContract({ address: MORPHO, abi: morphoAbi, functionName: "idToMarketParams", args: [c.marketId] }),
    baseClient.getBlockNumber(),
  ]);
  const oracle = params[2];
  const oraclePrice = await baseClient.readContract({ address: oracle, abi: oracleAbi, functionName: "price" });
  return {
    totalSupplyAssets: m[0],
    totalBorrowAssets: m[2],
    totalBorrowShares: m[3],
    lltv: params[4],
    oracle,
    oraclePrice,
    priceUsd: oracleToUsd(oraclePrice, c.collateralDecimals),
    block,
  };
}

export function oracleToUsd(p: bigint, collateralDecimals: number, loanDecimals = 6): number {
  // price * 10^collDec / 10^(36 + loanDec)
  const scaled = (p * 10n ** BigInt(collateralDecimals) * 100n) / 10n ** BigInt(36 + loanDecimals);
  return Number(scaled) / 100;
}

export interface PositionOnChain {
  address: Address;
  borrowShares: bigint;
  collateral: bigint;
  /** Debt in USDC smallest units, rounded up like Morpho does. */
  borrowAssets: bigint;
  collateralUsd: number;
  debtUsd: number;
  ltv: number | null;
  /** Price of one whole collateral token at which Morpho can liquidate this position. */
  liquidationPrice: number | null;
}

export async function readPosition(c: CohortDef, address: Address, m: MarketOnChain): Promise<PositionOnChain> {
  const p = await baseClient.readContract({ address: MORPHO, abi: morphoAbi, functionName: "position", args: [c.marketId, address] });
  const borrowShares = p[1];
  const collateral = p[2];
  const borrowAssets =
    m.totalBorrowShares === 0n ? 0n : (borrowShares * m.totalBorrowAssets + m.totalBorrowShares - 1n) / m.totalBorrowShares;
  const coll = Number(collateral) / 10 ** c.collateralDecimals;
  const collateralUsd = coll * m.priceUsd;
  const debtUsd = Number(borrowAssets) / 1e6;
  const lltv = Number(m.lltv) / 1e18;
  return {
    address,
    borrowShares,
    collateral,
    borrowAssets,
    collateralUsd,
    debtUsd,
    ltv: collateralUsd > 0 ? debtUsd / collateralUsd : null,
    liquidationPrice: coll > 0 && debtUsd > 0 ? debtUsd / (coll * lltv) : null,
  };
}

/* ---------- Morpho public API: every borrower's level, which is what a hunter reads ---------- */

export interface PublicLevel {
  address: string;
  debtUsd: number;
  liquidationPrice: number;
}

export interface MarketLevels {
  marketId: string;
  borrowers: number;
  borrowApy: number;
  utilization: number;
  liquidityUsd: number;
  borrowUsd: number;
  priceUsd: number;
  levels: PublicLevel[];
  fetchedAt: number;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Morpho API ${r.status}`);
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(j.errors[0]!.message);
  return j.data as T;
}

const LEVELS_QUERY = `query Levels($id: String!, $first: Int!) {
  m: markets(where: { uniqueKey_in: [$id], chainId_in: [8453] }) {
    items { collateralAsset { decimals } state { borrowApy utilization price liquidityAssetsUsd borrowAssetsUsd } }
  }
  p: marketPositions(first: $first, orderBy: BorrowShares, orderDirection: Desc,
    where: { marketUniqueKey_in: [$id], chainId_in: [8453], borrowShares_gte: 1 }) {
    pageInfo { countTotal }
    items { user { address } healthFactor state { borrowAssetsUsd } }
  }
}`;

interface LevelsResp {
  m: { items: { collateralAsset: { decimals: number }; state: { borrowApy: number; utilization: number; price: string; liquidityAssetsUsd: number; borrowAssetsUsd: number } }[] };
  p: { pageInfo: { countTotal: number }; items: { user: { address: string }; healthFactor: number | null; state: { borrowAssetsUsd: number | null } }[] };
}

export async function readLevels(c: CohortDef, first = 400): Promise<MarketLevels> {
  const d = await gql<LevelsResp>(LEVELS_QUERY, { id: c.marketId, first });
  const m = d.m.items[0];
  if (!m) throw new Error("market not found in Morpho API");
  const priceUsd = oracleToUsd(BigInt(m.state.price), m.collateralAsset.decimals);
  const levels: PublicLevel[] = [];
  for (const it of d.p.items) {
    if (!it.healthFactor || !it.state.borrowAssetsUsd || it.healthFactor <= 0) continue;
    levels.push({ address: it.user.address, debtUsd: it.state.borrowAssetsUsd, liquidationPrice: priceUsd / it.healthFactor });
  }
  return {
    marketId: c.marketId,
    borrowers: d.p.pageInfo.countTotal,
    borrowApy: m.state.borrowApy,
    utilization: m.state.utilization,
    liquidityUsd: m.state.liquidityAssetsUsd,
    borrowUsd: m.state.borrowAssetsUsd,
    priceUsd,
    levels,
    fetchedAt: Date.now(),
  };
}
