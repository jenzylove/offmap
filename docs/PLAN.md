# Offmap build plan

Deadline: 2026-11-14 23:59 UTC. Written 2026-11-07 20:30 UTC. Seven days.

**Final status, 2026-11-13: every phase is done and Offmap is live on mainnet.** Proof for each step is in the [build log](BUILD_LOG.md).

Every phase ends with a check that proves it. Nothing in a later phase is built on an unproven spike.

## Phase 0. Accounts and funds (Nov 7 to 8)

Needed before any mainnet work:

1. NEAR mainnet account for the deployer (`offmapfi.near`), funded with about 15 NEAR (contract storage plus chain signature fees).
2. Base wallet with about $40 of ETH for gas and about $60 of WETH or cbBTC as test collateral.
3. Phala Cloud account (Shade Agents run there in Intel TDX), with credits for one CVM for 3 weeks.
4. NEAR AI / 1Click API key for Intents (JWT from the partner portal) for confidential swaps.

Check: each account shows its balance on the explorer. **Done.**

## Phase 1. Spikes (Nov 8 to 9)

Time box each to 90 minutes. Results go to `docs/spikes/<name>.md`.

| # | Question | Where | Status |
|---|---|---|---|
| S1 | Shade Agent in TDX registers on our NEAR contract, derives a Base address through chain signatures, and supplies, borrows and repays on Morpho Blue | mainnet NEAR + Base | **pass on mainnet** (`docs/spikes/s1-chainsig-morpho.md`); the agent registered in TDX with a real attestation on Nov 8 |
| S2 | The agent holds a confidential Intents balance, runs a confidential 1Click swap, and pays out to a chosen chain | mainnet | **pass** (`docs/spikes/s2-confidential-rail.md`) |
| S3 | Batch window and lot sizes that drop the linked fraction at low volume | offline sim, then mainnet sample | **done**: one net move per batch, payouts in round lots after random delays, leak study live at `/public/leak` |
| S4 | Eject helper: Morpho flash loan plus dual authorization moves a share to the user's own position in one transaction | Base fork (forge), then Base mainnet | **pass on Base fork** (`docs/spikes/s4-eject.md`) |
| S5 | Merkle proof check gas on NEAR for a padded tree | NEAR testnet | **pass: 2 Tgas at 1,024 leaves** (`docs/spikes/s5-merkle-gas.md`) |
| S6 | One sourced case of a lending market liquidation level being hunted | web research | **done**: 10x Research, March 2025, linked in the README |
| S7 | Morpho Blue WETH/USDC and cbBTC/USDC on Base: liquidity, LLTV, oracle | Morpho API | **done**: both markets in the contract config |
| S8 | 1Click deposit, status, refund flow | docs | **done**: used by the agent on mainnet |

Check: every spike file ends in a verdict. If S1, S2 or S4 had failed, the plan would have changed. None failed.

S4, S5, S6 and S7 can be done before Phase 0 is finished. Those run first.

## Phase 2. Core logic (Nov 9 to 10)

Pure functions with unit tests, no network:

1. Ledger: per user collateral, debt, health, liquidation price; netting a batch into one change per cohort.
2. Risk rules: 60% open, 70% private liquidation back to 60%, caps, rate.
3. Loss waterfall: user, reserve, pro rata inside the cohort.
4. Merkle tree with salted leaves and fixed padding; proof build and verify (same encoding in Rust and TypeScript).
5. Notes: signed, verifiable, enough to recover.
6. Leak study and level attack over a list of public transfers.

Check: `cargo test` and `npm test` green, including the acceptance tests 6, 7 and 9 as unit tests. **Done: 55 tests green (commit 66fb734).**

## Phase 3. Contracts (Nov 10 to 11)

1. `offmapfi.near`: agent registry with attestation check, solvency statements, signing guard (stale, cap, ceiling, code hash), eject queue, recovery mode. NEP 330 build. Keys removed after deploy.
2. Eject helper on Base: immutable, forge tests on a Base fork, then deployed and verified.

Check: each refusal in acceptance test 5 is a real mainnet transaction with its error; only a restricted key remains on the account. **Done: 69 contract tests, EjectHelper verified on Base.**

## Phase 4. Agent (Nov 11 to 12)

1. Shade Agent in TDX on Phala: registration, price median from three sources, batch loop, Morpho calls through chain signatures, confidential Intents in and out, private liquidation, statement and notes.
2. First real loan end to end with collateral from a non NEAR chain.

Check: acceptance tests 1, 3, 4 and 8 pass on mainnet, with transaction links in `docs/BUILD_LOG.md`. **Done: first loan Nov 8, mainnet eject Nov 12.**

## Phase 5. App (Nov 11 to 13, in parallel with Phase 4)

Landing with the two live panels (hunter view against your view), borrow, your view, repay, eject, proof page, FAQ, footer. Phone width, light and dark. Own look, set in this phase.

Check: every page driven in the headless browser at phone and desktop width. **Done.**

## Phase 6. Audit and launch (Nov 13 to 14)

1. Release readiness audit, fixes proven, scope and limits written.
2. Judge path commands (PRD section 11) run clean from a fresh clone.
3. README, LICENSE, demo video, X post, form.

Check: the submission checklist in the PRD is fully ticked from the live app. **Done and submitted on Nov 13.**

## Delegation

| Work | Who |
|---|---|
| Spikes S1, S2, S4, contract and agent security, key handling | main session |
| Core logic and its tests (Phase 2) | Opus agent, from a shared spec |
| Morpho data, 1Click plumbing, judge path scripts, docs | Sonnet agents |
| App UI | Opus agent, after the look is set |
| Read only audit | Sonnet agent, in parallel with Phase 6 |

## Risks

| Risk | Status |
|---|---|
| Confidential Intents has no testnet, so mainnet costs real money and is slower to iterate | known |
| Shade Agent framework maturity on mainnet with chain signatures to an EVM chain | passed (S1) |
| Morpho flash loan plus authorization path for the eject in one transaction | passed on a Base fork (S4) |
| Anonymity set at hackathon volume is tiny; the leak study will show it | known, stated in the product |
| Attestation verification cost on chain | passed: register_agent runs on mainnet |
| Seven days for full scope | met |
