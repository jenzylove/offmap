# Spike S2: an account holds a private balance and pays out from it (mainnet)

**Question.** Can the account that will run Offmap's agent keep funds in a Confidential Intents balance that only it can read, and pay out from that balance to any chain with a signed intent?

**What was run.** `spikes/chainsig-morpho/s2.mjs` and `intents.mjs` on mainnet, 2026-11-08, with the 1Click API (partner key).
1. **Shield:** 3 USDC on NEAR sent to a 1Click quote with `recipientType: CONFIDENTIAL_INTENTS`. Status SUCCESS.
2. **Owner only read:** signed an empty NEP-413 intent, exchanged it at `/v0/auth/authenticate` for a User-Session token, read `/v0/account/balances`: `available 3000000, source private`. Without that session the balance is not readable.
3. **Private payout:** quote with `depositType: CONFIDENTIAL_INTENTS` to USDC on Base for a freshly generated wallet; `/v0/generate-intent`, NEP-413 signature, `/v0/submit-intent`. Status SUCCESS. Private balance afterwards: 1,500,000.

**What the public sees on Base:** [0x0a697f…](https://basescan.org/tx/0x0a697f0f515ae6d8201a25bf2d3169679e4a711439e6e5666e2a167002176752). NEAR Intents' shared Base wallet `0x2CfF…2680` sends 1.495022 USDC to the new wallet `0xb7E4…Dfab`. Nothing in that transaction points to the owner's NEAR account or the original deposit. What remains visible is amount and time, which the batching, round lots and the published leak study address.

**Gotchas found.**
1. The versioned nonce salt must be read live from the verifying contract. `intents.near` returns `252812b3` from `current_salt`; the documented `e110f317` belongs to the confidential contract and makes user auth fail with "signature verification failed".
2. The Intents SDK does not load next to near-api-js 5 (ESM import without extension), so the nonce and NEP-413 signing are implemented directly in `intents.mjs` from the spec.

**Verdict.** Pass. The private custody and payout rail Offmap needs works on mainnet with an ordinary NEAR account key. Next: the same key held only inside the TDX agent.
