import type { Cohort } from "@offmap/core";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

export const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export interface CohortConfig extends Cohort {
  marketId: `0x${string}`;
  collateralToken: `0x${string}`;
  /** 1Click asset id of the collateral on Base, and inside Intents. */
  collateralAssetId: string;
  /** Kraken public ticker pair, e.g. XBTUSD. */
  kraken: string;
  /** Coinbase spot product, e.g. BTC-USD. */
  coinbase: string;
}

export const COHORTS: CohortConfig[] = [
  {
    id: "cbbtc-usdc",
    collateralAsset: "cbBTC",
    collateralDecimals: 8,
    loanDecimals: 6,
    lltvBps: 8600n,
    cohortCeilingBps: 5000n,
    sizeCapLoan: 5_000_000_000n, // 5,000 USDC during the hackathon
    marketId: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    collateralAssetId: "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near",
    kraken: "XBTUSD",
    coinbase: "BTC-USD",
  },
  {
    id: "weth-usdc",
    collateralAsset: "WETH",
    collateralDecimals: 18,
    loanDecimals: 6,
    lltvBps: 8600n,
    cohortCeilingBps: 5000n,
    sizeCapLoan: 5_000_000_000n,
    marketId: "0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda",
    collateralToken: "0x4200000000000000000000000000000000000006",
    collateralAssetId: "nep141:base-0x4200000000000000000000000000000000000006.omft.near",
    kraken: "ETHUSD",
    coinbase: "ETH-USD",
  },
];

export const USDC_INTENTS_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const USDC_BASE_ID = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const ETH_BASE_ID = "nep141:base.omft.near";

export const config = {
  network: env("NEAR_NETWORK", "mainnet") as "mainnet" | "testnet",
  /** offmap.near in production. In dev without the contract, empty: the agent signs directly as its own account. */
  contractId: env("OFFMAP_CONTRACT", ""),
  nearRpc: env("NEAR_RPC", "https://rpc.mainnet.fastnear.com"),
  baseRpc: env("BASE_RPC", "https://mainnet.base.org"),
  mpcContract: env("MPC_CONTRACT", "v1.signer"),
  oneClickJwt: env("ONECLICK_JWT", ""),
  port: Number(env("PORT", "8787")),
  batchSeconds: Number(env("BATCH_SECONDS", "120")),
  stateFile: env("STATE_FILE", "./data/state.enc"),
  /** 32 byte hex key for state encryption. In the TEE it comes from dstack key derivation. */
  stateKey: env("STATE_KEY", ""),
  sessionSecret: env("SESSION_SECRET", ""),
  /** Dev only: local NEAR key file standing in for the TEE key. */
  devKeyFile: env("DEV_KEY_FILE", ""),
  userCapLoan: 1_000_000_000n, // 1,000 USDC per user during the hackathon
  minGasEth: 300_000_000_000_000n, // keep 0.0003 ETH on each cohort address
};
