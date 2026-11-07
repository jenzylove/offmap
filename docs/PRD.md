# Offmap PRD

Private borrowing on real liquidity. Borrow USDC against your crypto, and nobody can see your loan, your collateral or your liquidation price. Private while you want it, yours whenever you want out.

Status: v2.1 for approval, 2026-11-07. Hackathon: NEAR HACKATHON, deadline 2026-11-14 23:59 UTC. Tracks: Unstoppable DeFi (main), Privacy and Private AI.

**Changes from v1:** pooled position split into capped cohorts; loss waterfall; salted Merkle root of positions in every solvency statement; permissionless eject to the user's own wallet; corrected the "private lending is live nowhere" claim; evidence that still needs sources is flagged; Confidential Intents has no testnet, so mainnet from day one; judge path that needs no TEE.

## 1. Problem

Every loan and leveraged position on a public chain is a target.

1. **Positions are public.** On every lending market and perps venue, anyone can read your size, your collateral and the exact price where you get liquidated.
2. **Public levels get hunted.** Traders and bots read liquidation data and push price into those levels. In 2025 one of the most watched traders on a public perps venue was reported "hunted twice in one day", losing about $14.3M, and was later fully liquidated for about $99M. That case is perps. **To do before the build:** add at least one sourced lending market case, or public liquidation map tooling aimed at lending positions. If none is found, frame the problem around liquidation maps in general and say plainly that the strongest evidence is from perps.
3. **Hiding who you are does not hide your level.** Private accounts that hold loans exist since September 2026. The borrower's identity is hidden, but the position, its size and its liquidation price are still public on the market. **Hunters don't need your name; they need your level.**
4. **Confidential routing alone does not fix it.** Deposits and payouts are ordinary public transactions; confidential routing only hides the middle. Simple heuristics (amount within 2%, payout within 1 hour, address reuse, pair rarity) can link most confidential trades at low volume. Offmap runs and publishes this study on its own traffic (5.10).
5. **No lending market hides the level.** No market a user can borrow from today keeps the individual position and liquidation price off the public map.

## 2. Users

1. **Leveraged holders and traders** who borrow against crypto and do not want their liquidation price on a public map.
2. **Funds, treasuries and known wallets** whose every move is watched and copied.
3. **Anyone who wants a loan without linking the wallet they deposit from to the wallet they receive in.**

## 3. What Offmap is

Borrowing through a few shared, capped positions on a deep existing lending market, run by an agent inside sealed hardware, with every user's loan kept private inside them, and an exit that works without the agent.

1. **Cohorts, not one pool.** Offmap runs a few pooled positions (cohorts) on Morpho Blue on Base, each through its own NEAR chain signatures address. A cohort is defined by collateral asset and has a hard size cap. The market and every observer see a handful of borrowers, never an individual. A problem in one cohort cannot touch another.
2. **Real liquidity from day one.** Loans are funded by Morpho's existing lenders. Offmap recruits no lenders.
3. **A private ledger.** Each user's collateral, debt, health and liquidation price live only inside the sealed hardware agent. The user sees their own position. Nobody else does.
4. **Private liquidation.** If a user's loan gets unhealthy, the agent sells part of that user's collateral through a confidential NEAR Intents swap and repays that user's share. No public liquidation event is tied to anyone. Each cohort stays far from Morpho's own liquidation line.
5. **Unlinkable money in and out.** Deposits and payouts move through confidential NEAR Intents balances, with round sizes, batch windows and random delays.
6. **Verifiable solvency.** After every batch the agent publishes a hardware signed statement with the cohort totals, a **salted Merkle root of every user's position**, and the reserve size. The NEAR contract checks it before the agent can move money. Each user checks their own leaf against the root using their note.
7. **Eject.** Any user can force their share out of the cohort into a Morpho position at **their own wallet on Base**, publicly, using their latest note. It works through the contract even if the agent is down. They give up privacy, never their money.

## 4. Front door

The visitor brings their own funds and gets a real loan in a few minutes.

1. **Landing page.** Headline: "Borrow without becoming a target." Below it, two live panels side by side, read from chain: what the world sees (a few cohort positions on Morpho) and what you would see (your own loan, private).
2. **Borrow.** Pick collateral from any supported chain (for example $20 of ETH on Arbitrum or SOL on Solana), the USDC amount, and the chain and wallet to receive it.
3. **Deposit.** Send to the one time deposit address shown. The page tracks it to confirmed.
4. **Loan lands privately.** The agent converts the collateral, adds it to the right cohort in the next batch, borrows USDC, and credits your private balance.
5. **Withdraw.** Send USDC to your chosen wallet now, or in round sized pieces with a random delay (the private default). The page says plainly which is more private and why.
6. **Your view.** Collateral, debt, health, liquidation price, your latest note, your Merkle proof check (green tick), repay, and **Eject**. Only you see it.
7. **Hunter view.** Exactly what an outside observer sees: the cohort positions on the explorer, with no way to point at you.
8. **Proof.** The hardware attestation, the code hash the NEAR contract accepted, the latest solvency statement and root, the reserve, the leak study and the level attack.
9. **Repay.** Pay back from any chain. Collateral returns to any chain and wallet you choose, through the same private path.

## 5. Full scope

Everything below ships. Nothing is held for later.

### 5.1 NEAR contract `offmap.near`

1. Registry of the accepted agent code hash and the agent's attested key (the Shade Agent pattern).
2. Only a registered, attested agent can request chain signatures for the cohort Base accounts.
3. Stores the latest solvency statement per cohort: total collateral, total debt, reserve, Merkle root, leaf count, timestamp, agent signature.
4. Rejects any signing request if the last solvency statement is older than a set limit, fails its checks, or would push a cohort over its cap or LTV ceiling.
5. **Eject:** permissionless. The user submits their latest note, the leaf salt, a Merkle proof against the latest accepted root, and a Morpho authorization signed by their own Base wallet. The contract signs, through chain signatures, one call to the eject helper on Base (5.3.4). Ejects are **queued in order, never refused**: a queue keeps each step inside the cohort ceiling, and every queued eject completes.
6. Recovery mode: if no valid agent checks in for a set time, any new agent running the same published code hash can register and resume from the ledger and user notes. Eject keeps working throughout.
7. Full access keys removed after deploy. Source verified, reproducible build (NEP 330).

### 5.2 Sealed hardware agent

1. Runs in Intel TDX through the Shade Agent framework. Remote attestation is verified by `offmap.near` on registration.
2. Holds the private ledger, encrypted to a key only an attested instance can derive.
3. Derives and controls each cohort's Base account through chain signatures.
4. Reads prices from at least three independent sources and uses the median. Refuses to act on a stale or split price.
5. Each batch window: nets all deposits, borrows, repayments and withdrawals per cohort, applies one combined change per cohort to Morpho, and rebuilds the Merkle tree.
6. Per user health checks every block window; private liquidations through confidential Intents swaps.
7. Publishes the solvency statement after every batch and issues each changed user a fresh signed note.

### 5.3 Morpho integration (Base)

1. Morpho Blue markets with deep USDC liquidity (WETH/USDC and cbBTC/USDC, chosen in the spike by liquidity and rate). One cohort per market at launch.
2. Supply collateral, borrow and repay USDC from each cohort's chain signatures account.
3. Each cohort is held below a hard ceiling far under Morpho's liquidation line (target: cohort loan to value at most 50% while the market's line is 86%) and below a size cap set from market depth.
4. **Eject helper**, an immutable contract on Base. In one transaction it takes a Morpho flash loan, repays the user's debt share on the cohort position, withdraws their collateral share, supplies it to the user's own position, borrows the same debt there, and repays the flash loan. It acts only with the cohort's chain signatures authorization and the user's own Morpho authorization.

### 5.4 Money in and out (NEAR Intents)

1. Deposits from any chain and token on the 1Click list, through 1Click with confidentiality on.
2. Collateral converted to the cohort's collateral asset through Intents.
3. Loans credited to the user's private Intents balance, not paid straight out.
4. Withdrawals in standard lot sizes, inside batch windows, with a random delay the user can see and choose.
5. Repayment from any chain through the same path.

### 5.5 Risk rules (per user, inside the agent)

1. Maximum loan to value at open: 60%.
2. Private liquidation starts at 70%: sell just enough collateral to return the loan to 60%, plus a small penalty that goes to the reserve.
3. Per user loan cap and per cohort size cap, enforced in code and shown on the site.
4. Rate: Morpho's live borrow rate plus 1% a year, shown before every borrow.

### 5.6 Loss waterfall (shown before every borrow)

If a private liquidation cannot fully cover a user's debt (gap down, stale price, failed swap), the shortfall is absorbed in this order:

1. The user's own remaining collateral and penalty.
2. The **cohort reserve**, funded from the 1% spread and penalties. Its size is in every solvency statement.
3. Only if the reserve is exhausted: **pro rata across users in that cohort only**, reflected in their next notes. Other cohorts are never touched.

Every loss is published as an event with the amount and cohort. It never names the user.

### 5.7 Merkle commitments

1. Each leaf is a hash of cohort, collateral, debt, nonce and a **random 32 byte salt** known only to the agent and that user's note. Without the salt a leaf cannot be confirmed by guessing amounts.
2. The tree is padded to a fixed size per cohort, so the leaf count does not reveal the exact number of users.

### 5.8 User notes and recovery

1. After every change, the user gets a note signed by the agent: cohort, collateral, debt, nonce, salt, Merkle root and the user's proof.
2. The user's app checks the proof against the root on `offmap.near` and shows a green tick or a red warning.
3. If the agent is gone and recovery mode starts, users present their latest notes. A new attested agent rebuilds the ledger, or unwinds the cohort and returns each user their share. Users can eject at any time.

### 5.9 Selective disclosure

A user can generate a signed statement of their own position for a chosen party (a fund, an auditor, a lender), without revealing it to anyone else.

### 5.10 Leak study and level attack (published, re-runnable)

1. **Leak study:** four heuristics (amount within 2%, payout within 1 hour, address reuse, pair rarity) over Offmap's own deposits and payouts, from public chain data only. Shows trades, uniquely linked, correctly linked, mean anonymity set and linked fraction, with sample sizes.
2. **Level attack:** given only public cohort data and batch deltas, try to estimate any single user's liquidation price; report the error.
3. Runs on demand from the proof page and from one command in the repo.

### 5.11 App

1. Landing page, borrow flow, your view, hunter view, proof page, repay flow, eject flow, FAQ, footer.
2. Sign in with a NEAR wallet or any wallet that can sign for an Intents account.
3. Works at phone width. Light and dark.

## 6. NEAR technology and why it is the hero

| NEAR piece | What it does in Offmap | Without it |
|---|---|---|
| Confidential NEAR Intents | Private balances, private liquidation swaps, private payouts to 35+ chains | Every step is public and the product does not exist |
| Chain signatures | A NEAR contract controls each cohort's Morpho account on Base and signs ejects, no bridge, no human key | A human or a multisig holds the account |
| Shade Agent pattern (TEE plus contract) | The contract only signs for an agent proven to run the published code | You trust an operator |
| 1Click API | Any chain in, any chain out | Users must bridge by hand |
| NEP 330 verified build, keyless contract | Anyone can check the deployed code | Claims cannot be checked |

**Honest uniqueness note:** chain signatures and TEE agents have equivalents on other chains. The piece no other chain has live is **confidential cross chain settlement**. Lead the pitch with it.

## 7. Positioning

1. Private account systems hide who holds a loan; the position and its level stay public. Offmap hides the position and the level.
2. Liquidation rescue tools act on positions that stay public. Offmap removes the public target.
3. The strongest DeFi entries in this hackathon are live on mainnet with tests, CI and verified builds. That is the polish bar Offmap ships at.

(Named rivals are tracked outside this document.)

## 8. How each judging area is met

Published guidance: technical implementation, design, impact, originality, sustainability.

1. **Technical implementation:** a keyless NEAR contract verifying hardware attestation and Merkle proofs; a sealed agent driving real Morpho positions on Base through chain signatures; confidential Intents in and out; batching and private liquidation; solvency statements, permissionless eject and recovery.
2. **Design:** the hunter view against your view is the whole product on one screen. Plain words, live numbers, every claim one click from its proof.
3. **Impact:** every borrower on a public chain is exposed today. Offmap gives them a loan on real liquidity without the target.
4. **Originality:** no lending market hides the individual level today. Pooled private positions, private liquidation, user verifiable solvency and eject are new together.
5. **Sustainability:** revenue from day one, 1% a year over Morpho's rate on every loan, with no partners to sign.

## 9. Claims and how each is proven

| Claim | Proof |
|---|---|
| Loans are real, from Morpho | Cohort positions on the Base explorer, USDC arriving at the user's wallet |
| The agent runs the published code | Attestation and accepted code hash on `offmap.near`, rebuild script |
| Nobody holds a key | `offmap.near` access key list is empty; cohort accounts are chain signatures addresses |
| Each cohort is solvent | Latest solvency statement on chain, checked by the contract |
| My position is counted | My note's Merkle proof verifies against the on-chain root |
| Positions are private | Hunter view shows only cohort positions; level attack error published |
| Deposits and payouts are hard to link | Our leak study, live numbers and sample size |
| Liquidations are private | A test liquidation on mainnet shows a confidential swap and no public event tied to the user |
| I can always get out | A mainnet eject transaction made with the agent paused |

Every number on the site is read live or links to its source. No staged states, no simulated success.

## 10. What Offmap does not do, and the trust it asks for

1. **It trusts sealed hardware for privacy, not for custody of last resort.** Eject works without the agent.
2. **Privacy depends on volume.** At hackathon volume the anonymity set is small; the leak study shows the real number.
3. **Cohort positions are public.** Their total size and health are visible by design; individual loans are not.
4. **Losses can be shared inside a cohort** once the reserve is exhausted. The waterfall is shown before every borrow.
5. **A few markets at launch.** One Morpho market per cohort on Base.
6. **Not a mixer.** Deposits are screened against public sanctions lists.
7. **Unaudited hackathon build.** Loan and cohort caps are enforced in code and shown on the site.

## 11. Judge path (no TEE needed)

1. One command reads `offmap.near`: access keys (empty), accepted code hash, latest solvency statements and roots.
2. One command reads the cohort positions on Base and checks they equal the statement totals within rounding.
3. One command verifies a published sample note's Merkle proof against the on-chain root.
4. One command runs the leak study and the level attack and prints the results.
5. Links to the mainnet transactions for every claimed behaviour, including a private liquidation and an eject.

## 12. Hackathon checklist

Ticked only from the live app. Copied to `docs/SUBMISSION_CHECKLIST.md`.

- [ ] Public repo with LICENSE by 2026-11-14 23:59 UTC
- [ ] README for human and AI judges: "do X, see Y", five minute fast path (section 11)
- [ ] README names the other project, Q-DAY (rule Q-015)
- [ ] Libraries and AI assisted code listed in the README (rule Q-005)
- [ ] Code written since 2026-10-19
- [ ] Hosted demo up until at least 2026-11-25
- [ ] X post: built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, demo video attached
- [ ] Form: tracks `defi`, `privacy`; NEAR mainnet payout account created by the owner; Website field empty
- [ ] Mainnet transactions for every claimed behaviour, linked from the README

## 13. Acceptance tests

1. A new user deposits from a non NEAR chain, borrows USDC and receives it on a chosen chain. Morpho shows one combined cohort change, not a per user one.
2. The hunter view, built only from public data, cannot name the user's collateral, debt or liquidation price. The level attack's error is published.
3. A user's view matches the agent ledger and their Merkle proof verifies.
4. Forcing a loan past 70% triggers a private liquidation through a confidential swap, returns it to 60%, and leaves no public event tied to that user.
5. The contract refuses signing requests from an unregistered key, a stale statement, a mismatched code hash, or one that would exceed a cohort cap or ceiling. Each refusal is a real transaction with its error.
6. Every solvency statement sums to the public cohort positions within rounding.
7. A forced shortfall walks the waterfall in order: user, reserve, then pro rata inside that cohort only.
8. **Eject with the agent paused:** a user moves their share into a Morpho position at their own Base wallet in one transaction. The cohort stays inside its ceiling.
9. A leaf cannot be confirmed from the root by guessing amounts without its salt.
10. The leak study and level attack run from one command and from the proof page.
11. Recovery: a second attested instance of the same code resumes from notes and the root.
12. Repay from any chain returns collateral to any chain.
13. `offmap.near` has no access keys and its source matches the repo build.

## 14. Unknowns to spike before building

**Confidential Intents has no testnet. Spikes 2, 3 and the end to end flow run on mainnet with small real amounts from day one.**

1. **Spike:** a Shade Agent in TEE registers on a NEAR contract and gets a chain signatures Base address that can supply, borrow and repay on Morpho. (The pattern has been shown working elsewhere on testnet; confirm on mainnet.)
2. **Spike (mainnet):** the agent holds a confidential Intents balance and runs a confidential 1Click swap and payout. Option: build on an existing TEE custody service instead of our own enclave custody; decide on the trust trade off.
3. **Spike (mainnet):** batch timing and lot sizes that lower the linked fraction at low volume.
4. **Spike:** the eject helper with a Morpho flash loan and dual authorization, on Base.
5. **Spike:** Merkle proof verification gas on NEAR for padded cohort trees.
6. **Source needed:** one lending market hunting case (section 1.2).
7. **Known:** Morpho Blue market parameters and liquidity on Base.
8. **Known:** 1Click deposit, status and refund flow.

If any spike fails, the build stops and the plan is changed with the owner before any code depends on it.

## 15. References

- NEAR HACKATHON: https://nearhackathon.com · https://nearhackathon.com/HACKATHON.md
- Track prompts: https://github.com/nearai/near-hackathon-prompt-examples
- Confidential Intents: https://leodex.io/editorial/near-confidential-intents-july-2026
- Private loans from private accounts (Sep 2026): https://alearesearch.substack.com/p/railgun-private-dollars
- Morpho Blue flash loans and authorization: https://docs.morpho.org
- Shade Agents: https://docs.near.org/ai/shade-agents/getting-started/introduction
