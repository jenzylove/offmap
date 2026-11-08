# Spike S1: a NEAR account drives Morpho Blue on Base through chain signatures (mainnet)

**Question.** Can a NEAR account, with no Ethereum key anywhere, hold and run a real Morpho Blue position on Base by asking NEAR's MPC network (`v1.signer`) to sign each transaction?

**What was run.** `spikes/chainsig-morpho/` on NEAR mainnet and Base mainnet, 2026-11-08.
1. Derived the Base address for NEAR account `864a5094…87b5` and path `offmap-spike-base-1`: `0xf0Ad15b5AC0A6Ec7109c29D45F752bb944666004`. No private key for it exists; only the MPC network can sign for it, and only when that NEAR account asks.
2. Funded it from USDC on NEAR through the 1Click API (NEAR Intents): 0.00112 ETH for gas and 6,590 sats of cbBTC.
3. Each Base transaction: hash prepared, `v1.signer.sign` called from the NEAR account (domain 0, secp256k1), signature assembled, broadcast.

**Output (Morpho cbBTC/USDC market `0x9103…1836`).**

| Step | Transaction | Position after (supplyShares, borrowShares, collateral) |
|---|---|---|
| approve cbBTC | [0x4af57d…](https://basescan.org/tx/0x4af57da5c458279c03edab392709cee3833389043696aa78b303cea238292b55) | 0, 0, 0 |
| supplyCollateral 6,590 sats | [0xb8852a…](https://basescan.org/tx/0xb8852a922a304f875eb0963f9eeff08739f87bcf05af4a751d909ff580fe4114) | 0, 0, 6590 |
| borrow 2 USDC | [0xd7ccdd…](https://basescan.org/tx/0xd7ccdd58ffaa65cdade69172a43f339a399794c86085249584828421a740c13a) | 0, 1772785749903, 6590 |
| approve USDC | [0x162fa5…](https://basescan.org/tx/0x162fa582d2c9c1e5ccae4646a0045356fa41d483b2510742401534fa324434ae) | unchanged |
| repay 1.9 USDC | [0x32e863…](https://basescan.org/tx/0x32e86328a9cca05807cd85b591e4bde620722ac352dbd41942e24503d04aa5a3) | 0, 88639334342, 6590 |
| withdrawCollateral 1,000 sats | [0x04f15c…](https://basescan.org/tx/0x04f15c2eec22aaccbc21652920307d2f6fb2cfcb90756a7ce215f00390d1f501) | 0, 88639334342, 5590 |

**Gotcha found.** `v1.signer` returns `recovery_id`; chainsig.js expects `v = recovery_id + 27`. Passing the raw id made the transaction recover to a different, empty address.

**Verdict.** Pass for the chain signatures and Morpho half of S1. Still open in S1: the same calls requested by a contract (`offmapfi.near`) for an agent proven to run in TDX (Phala), instead of by a plain NEAR account.
