import { ONECLICK } from "./config";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  sol: "Solana",
  btc: "Bitcoin",
  near: "NEAR",
  pol: "Polygon",
  avax: "Avalanche",
  bsc: "BNB Chain",
  zec: "Zcash",
  gnosis: "Gnosis",
};

const COLLATERAL_SYMBOLS = new Set(["ETH", "WETH", "BTC", "cbBTC", "wBTC", "SOL", "wNEAR", "ZEC"]);
const COLLATERAL_CHAINS = new Set(["eth", "base", "arb", "op", "sol", "btc", "near", "zec"]);
const RECEIVE_CHAINS = new Set(["eth", "base", "arb", "op", "sol", "near", "pol", "avax", "bsc", "gnosis"]);

export async function fetchTokens(): Promise<OneClickToken[]> {
  const r = await fetch(`${ONECLICK}/tokens`);
  if (!r.ok) throw new Error(`1Click tokens ${r.status}`);
  return (await r.json()) as OneClickToken[];
}

/** Assets that make sense as collateral, one per symbol and chain. */
export function collateralAssets(all: OneClickToken[]): OneClickToken[] {
  const seen = new Set<string>();
  return all
    .filter((t) => COLLATERAL_SYMBOLS.has(t.symbol) && COLLATERAL_CHAINS.has(t.blockchain) && t.price > 0)
    .filter((t) => {
      const k = `${t.symbol}@${t.blockchain}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.price - a.price || a.blockchain.localeCompare(b.blockchain));
}

/** USDC on each chain the loan can be paid out to. */
export function usdcTargets(all: OneClickToken[]): OneClickToken[] {
  const seen = new Set<string>();
  return all
    .filter((t) => t.symbol === "USDC" && RECEIVE_CHAINS.has(t.blockchain))
    .filter((t) => (seen.has(t.blockchain) ? false : (seen.add(t.blockchain), true)))
    .sort((a, b) => (a.blockchain === "base" ? -1 : b.blockchain === "base" ? 1 : a.blockchain.localeCompare(b.blockchain)));
}

export interface SwapStatus {
  status: string;
  updatedAt?: string;
  swapDetails?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    originChainTxHashes?: { hash: string; explorerUrl?: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
    refundedAmountFormatted?: string;
  };
}

export async function fetchStatus(depositAddress: string): Promise<SwapStatus | { status: "NOT_FOUND" }> {
  const r = await fetch(`${ONECLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  if (r.status === 404) return { status: "NOT_FOUND" };
  if (!r.ok) throw new Error(`1Click status ${r.status}`);
  return (await r.json()) as SwapStatus;
}

export const STATUS_WORDS: Record<string, string> = {
  NOT_FOUND: "Waiting for your deposit. 1Click has not seen it yet.",
  PENDING_DEPOSIT: "Waiting for your deposit.",
  KNOWN_DEPOSIT_TX: "Deposit seen on its chain. Waiting for confirmations.",
  PROCESSING: "Deposit confirmed. Moving it into the private balance.",
  SUCCESS: "Deposit landed in the private balance. Your loan joins the next batch.",
  INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived. Send the rest or wait for a refund.",
  REFUNDED: "Refunded to your refund address.",
  FAILED: "The swap failed. Funds are refunded to your refund address.",
};

export function addressLooksValid(chain: string, a: string): boolean {
  const s = a.trim();
  if (!s) return false;
  if (["eth", "base", "arb", "op", "pol", "avax", "bsc", "gnosis"].includes(chain)) return /^0x[0-9a-fA-F]{40}$/.test(s);
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  if (chain === "near") return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s) && s.length >= 2 && s.length <= 64;
  return s.length > 10;
}
