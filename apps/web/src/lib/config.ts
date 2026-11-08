import type { Cohort } from "@offmap/core";

const trim = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");

export const AGENT_URL = trim(process.env.NEXT_PUBLIC_AGENT_URL);
export const CONTRACT_ID = trim(process.env.NEXT_PUBLIC_CONTRACT_ID) || "offmap.near";
export const NEAR_RPC = trim(process.env.NEXT_PUBLIC_NEAR_RPC) || "https://rpc.mainnet.fastnear.com";
export const BASE_RPC = trim(process.env.NEXT_PUBLIC_BASE_RPC) || "https://mainnet.base.org";

export const REPO_URL = "https://github.com/jenzylove/offmap";
export const ONECLICK = "https://1click.chaindefuser.com/v0";
export const MORPHO_API = "https://blue-api.morpho.org/graphql";

export const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_CHAIN_ID = 8453;

/** The spike position from docs/spikes/s1-chainsig-morpho.md. Shown until the agent publishes cohorts. */
export const SPIKE_ADDRESS = "0xf0Ad15b5AC0A6Ec7109c29D45F752bb944666004" as const;

/** Risk limits from the PRD (5.5), mirrored in @offmap/core DEFAULT_RISK. */
export const OPEN_LTV = 0.6;
export const LIQ_LTV = 0.7;
export const SPREAD_APR = 0.01;

export interface CohortDef {
  id: string;
  label: string;
  collateralSymbol: string;
  marketId: `0x${string}`;
  collateralToken: `0x${string}`;
  collateralDecimals: number;
  /** 1Click symbol whose price stands in for the collateral price before the oracle loads. */
  core: Cohort;
}

export const COHORTS: CohortDef[] = [
  {
    id: "cbbtc-usdc",
    label: "cbBTC / USDC",
    collateralSymbol: "cbBTC",
    marketId: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    collateralDecimals: 8,
    core: {
      id: "cbbtc-usdc",
      collateralAsset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      collateralDecimals: 8,
      loanDecimals: 6,
      lltvBps: 8600n,
      cohortCeilingBps: 5000n,
      sizeCapLoan: 0n,
    },
  },
  {
    id: "weth-usdc",
    label: "WETH / USDC",
    collateralSymbol: "WETH",
    marketId: "0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda",
    collateralToken: "0x4200000000000000000000000000000000000006",
    collateralDecimals: 18,
    core: {
      id: "weth-usdc",
      collateralAsset: "0x4200000000000000000000000000000000000006",
      collateralDecimals: 18,
      loanDecimals: 6,
      lltvBps: 8600n,
      cohortCeilingBps: 5000n,
      sizeCapLoan: 0n,
    },
  },
];

export const cohortById = (id: string) => COHORTS.find((c) => c.id === id);

export const basescanTx = (h: string) => `https://basescan.org/tx/${h}`;
export const basescanAddr = (a: string) => `https://basescan.org/address/${a}`;
export const nearblocksAddr = (a: string) => `https://nearblocks.io/address/${a}`;
export const nearblocksTx = (h: string) => `https://nearblocks.io/txns/${h}`;
export const morphoMarketUrl = (id: string) => `https://app.morpho.org/base/market/${id}`;
