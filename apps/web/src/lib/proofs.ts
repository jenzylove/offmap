import { REPO_URL } from "./config";

export interface ProofEntry {
  id: string;
  title: string;
  what: string;
  date: string;
  network: string;
  links: { label: string; href: string }[];
  result: string;
  doc: string;
}

const docUrl = (f: string) => `${REPO_URL}/blob/main/docs/spikes/${f}`;

/** Real mainnet and testnet runs recorded in docs/spikes. Every link points at the chain. */
export const PROOFS: ProofEntry[] = [
  {
    id: "L1",
    title: "The first private loan, end to end",
    what:
      "A user signed in and deposited 1.4 USDC from NEAR. It landed privately as 1,835 sats of cbBTC, batch 1 supplied it to the pooled cohort and borrowed 0.5 USDC, and the loan reached the user's own Base wallet from the shared Intents wallet after a random delay. Morpho shows one cohort, never the user.",
    date: "2026-11-08",
    network: "NEAR Intents + Base mainnet",
    links: [
      { label: "supply to cohort", href: "https://basescan.org/tx/0x3341e05962de21d9f3d3fd5deabed09d62041eceab178b6957031496cd180be2" },
      { label: "borrow 0.5 USDC", href: "https://basescan.org/tx/0x59c588a0df6cff7c84417f3c7dc717d529764fa85c1f7e2b346018d4e83fae2b" },
      { label: "into the private balance", href: "https://basescan.org/tx/0xe01bc721c2657a50c52fa9da2f2e803c956c1bf99527044b8019d2e0963d5381" },
      { label: "payout to the user", href: "https://basescan.org/tx/0x4a6572782c2a30be2dd8f0011593c6a9df93cff6de97f0dad79b1acd79a2a3dc" },
      { label: "the cohort position", href: "https://basescan.org/address/0x38CD311d1cd93e05371Ef09f3e2179CB45D71803" },
    ],
    result: "Live · ledger equals Morpho",
    doc: `${REPO_URL}/blob/main/docs/BUILD_LOG.md`,
  },
  {
    id: "S1",
    title: "A NEAR account runs a Morpho loan on Base",
    what:
      "No Ethereum key exists for the Base address. NEAR's signer network (v1.signer) signed every step when the NEAR account asked: supply cbBTC, borrow USDC, repay, withdraw.",
    date: "2026-11-08",
    network: "NEAR mainnet + Base mainnet",
    links: [
      { label: "supplyCollateral 6,590 sats", href: "https://basescan.org/tx/0xb8852a922a304f875eb0963f9eeff08739f87bcf05af4a751d909ff580fe4114" },
      { label: "borrow 2 USDC", href: "https://basescan.org/tx/0xd7ccdd58ffaa65cdade69172a43f339a399794c86085249584828421a740c13a" },
      { label: "repay 1.9 USDC", href: "https://basescan.org/tx/0x32e86328a9cca05807cd85b591e4bde620722ac352dbd41942e24503d04aa5a3" },
      { label: "withdrawCollateral 1,000 sats", href: "https://basescan.org/tx/0x04f15c2eec22aaccbc21652920307d2f6fb2cfcb90756a7ce215f00390d1f501" },
      { label: "the position", href: "https://basescan.org/address/0xf0Ad15b5AC0A6Ec7109c29D45F752bb944666004" },
    ],
    result: "Pass",
    doc: docUrl("s1-chainsig-morpho.md"),
  },
  {
    id: "S2",
    title: "A private balance pays out with no trail back",
    what:
      "3 USDC went into a Confidential Intents balance that only its owner can read. A signed intent then paid USDC on Base to a fresh wallet. The payout comes from the shared Intents wallet and names nobody.",
    date: "2026-11-08",
    network: "NEAR Intents mainnet + Base mainnet",
    links: [{ label: "payout on Base", href: "https://basescan.org/tx/0x0a697f0f515ae6d8201a25bf2d3169679e4a711439e6e5666e2a167002176752" }],
    result: "Pass",
    doc: docUrl("s2-confidential-rail.md"),
  },
  {
    id: "S4",
    title: "Eject in one transaction",
    what:
      "One user's share moves out of the pooled position into a Morpho position at their own wallet, through a flash loan, on a fork of Base mainnet against the real cbBTC/USDC market. The helper keeps no access afterwards.",
    date: "2026-11-08",
    network: "Base mainnet fork (Foundry)",
    links: [
      { label: "EjectHelper.sol", href: `${REPO_URL}/blob/main/contracts/base/src/EjectHelper.sol` },
      { label: "fork test", href: `${REPO_URL}/blob/main/contracts/base/test/EjectHelper.t.sol` },
    ],
    result: "3 tests pass · about 470k gas",
    doc: docUrl("s4-eject.md"),
  },
  {
    id: "S5",
    title: "Checking your place in the root costs 2 Tgas",
    what:
      "A NEAR contract verified a real salted Merkle proof from a 700 user cohort padded to 1,024 leaves, with the exact encoding this app uses. The same proof against a wrong root fails.",
    date: "2026-11-08",
    network: "NEAR testnet",
    links: [{ label: "verify_call", href: "https://testnet.nearblocks.io/txns/96u6BujBjQz9NJWB5jKAj8ceH6k1fNztAVTgJ75WMzXy" }],
    result: "verified = true · 2.0 Tgas of 300",
    doc: docUrl("s5-merkle-gas.md"),
  },
];
