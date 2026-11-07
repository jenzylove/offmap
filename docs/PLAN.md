# Blindside build plan

Deadline: 2026-11-14 23:59 UTC. Every phase ends on a check that proves it is done. Built on NEAR mainnet and Base mainnet with small real amounts (Confidential Intents has no testnet).

## Fixed choices

| Item | Choice |
|---|---|
| NEAR contract account | `blindsidefi.near` (blindside.near is taken) |
| Builder account | implicit `864a5094…87b5`, key in `~/.near-credentials/implicit`, never in the repo |
| Cohort 1 | Morpho Blue Base, cbBTC/USDC, market `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836`, LLTV 86% |
| Cohort 2 | Morpho Blue Base, WETH/USDC, market `0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda`, LLTV 86% |
| MPC signer | `v1.signer` (mainnet), domain 0 secp256k1 |
| TEE | Phala Cloud, Intel TDX, dstack, Shade Agent framework (`@neardefi/shade-agent-js`, `shade-attestation`) |
| Money rail | 1Click API, `CONFIDENTIAL_INTENTS` deposit, recipient and refund types, `confidentiality: basic` |
| Web | Next.js on Vercel, `blindside.jdollar.site` for launch links |

## Phase 0. Spikes (gate)

| Spike | Check that proves it |
|---|---|
| S1 Agent contract on mainnet, local mode agent derives the Base address via `v1.signer`, supplies $5 cbBTC to cohort 1, borrows $2 USDC, repays | Three Base transactions on basescan signed by the chain signatures address |
| S2 Confidential rail: deposit $5 USDC into a confidential Intents balance, swap part to cbBTC on Base for the cohort address, pay $1 USDC out to a fresh wallet; read balances with a session token | 1Click statuses SUCCESS, balances read back, no public NEAR transfer tied to the user |
| S3 Eject helper on a Base fork: flash loan, repay share, withdraw share, supply and borrow at user wallet, repay flash loan | Foundry test passes on a Base mainnet fork |
| S4 Salted Merkle proof verification gas on NEAR for a padded 1,024 leaf tree | Measured gas in a sandbox test |
| S5 Phala TEE deploy of the agent with attestation registered on the contract | `register_agent` succeeds with a real TDX quote |

If a spike fails: stop, write `docs/spikes/<name>.md`, bring the changed plan to the owner.

## Phase 1. Core logic (pure, no network)

Ledger, notes, salted Merkle tree with padding, risk engine (60% open, 70% private liquidation back to 60%), batch netting per cohort, loss waterfall, rate accrual (Morpho rate + 1%), solvency statement builder. TypeScript package `packages/core` with unit tests. Check: tests green, waterfall and netting property tests on 10k random operations.

## Phase 2. NEAR contract `contracts/blindside`

Agent registry and attestation (Shade Agent pattern), signing gate (fresh statement, cap, ceiling), solvency statements per cohort, Merkle verify, eject queue, recovery mode, NEP-330 build, keys removed after deploy. Check: sandbox tests for every refusal; deployed on mainnet; access key list empty.

## Phase 3. Base eject helper `contracts/base`

Immutable Solidity helper using Morpho flash loans and authorizations. Check: Foundry fork tests; deployed and verified on basescan.

## Phase 4. Agent `apps/agent`

Batch loop, median price from three sources, Morpho operations through chain signatures, confidential Intents in and out, private liquidations, notes, statements. Runs locally first, then in Phala TEE. Check: a full borrow, repay and private liquidation cycle on mainnet.

## Phase 5. Web `apps/web`

Landing (numbered sections, FAQ, footer), borrow, your view, hunter view, proof page, repay, eject. Design: own bold direction. Check: every page driven in a headless browser, light and dark, phone width.

## Phase 6. Proof tooling `scripts/`

Judge checks (keys, code hash, statements equal cohort positions, sample Merkle proof), leak study, level attack. Check: each runs from one command on a fresh clone.

## Phase 7. Mainnet run

Real loans from at least two wallets, one private liquidation, one eject with the agent paused, recovery drill. Check: every claim in the PRD table has a linked transaction.

## Phase 8. Release

Release readiness audit and fixes, README with judge fast path, LICENSE, repo public, demo video, X post, submission form. Check: `docs/SUBMISSION_CHECKLIST.md` all ticked from the live app.

## Delegation

Sonnet subagents: Phase 1 pure functions and tests from this spec, Phase 5 UI from the described layout, Phase 6 scripts. Kept in house: spikes, contracts, agent, keys and funds, design direction, every review.

## Risks

| Risk | Status |
|---|---|
| Shade Agent framework is unmaintained since April 2026 | Known: pin versions, maintain ourselves |
| Confidential Intents mainnet only | Known: small amounts from day one |
| Eject atomicity on Morpho | Needs spike S3 |
| Phala attestation on mainnet contract | Needs spike S5 |
| Anonymity set small at hackathon volume | Known: stated, measured by the leak study |
