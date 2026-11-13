# Build log

| Date (UTC) | Commit | What now works |
|---|---|---|
| 2026-11-07 | 3c40ae9 | Repo, PRD, plan |
| 2026-11-07 | de427c3 | Eject in one transaction on a Base mainnet fork (S4) |
| 2026-11-07 | 66fb734 | Core: private ledger, risk, private liquidation math, waterfall, salted Merkle tree, notes (55 tests) |
| 2026-11-07 | 5040b8b | Merkle proof verifies in a NEAR contract for 2 Tgas (S5) |
| 2026-11-08 | e99c307 | NEAR MPC signs a real Morpho supply, borrow, repay, withdraw on Base mainnet (S1) |
| 2026-11-08 | 10cb5c5 | Private Intents balance, owner only read, signed intent payout to a fresh Base wallet (S2) |
| 2026-11-08 | 9f3d058 | Agent runs the whole loop on mainnet: a user signs in, deposits 1.4 USDC from NEAR, it lands privately as 1,835 sats cbBTC, batch 1 supplies it to the pooled cohort `0x38CD311d1cd93e05371Ef09f3e2179CB45D71803` and borrows 0.5 USDC (txs [approve](https://basescan.org/tx/0xff711e2df8ddbfa2ba2905acae1ef3daf6607f330850ddb2c84e512d2c471866), [supply](https://basescan.org/tx/0x3341e05962de21d9f3d3fd5deabed09d62041eceab178b6957031496cd180be2), [borrow](https://basescan.org/tx/0x59c588a0df6cff7c84417f3c7dc717d529764fa85c1f7e2b346018d4e83fae2b), [to private balance](https://basescan.org/tx/0xe01bc721c2657a50c52fa9da2f2e803c956c1bf99527044b8019d2e0963d5381)); Morpho shows collateral 1835 and debt 500001, equal to the private ledger; payout queued with a random delay |
| 2026-11-08 | 9f3d058 | The borrowed 0.5 USDC reached the user's own Base wallet from the shared Intents wallet after a random delay ([0x4a6572…](https://basescan.org/tx/0x4a6572782c2a30be2dd8f0011593c6a9df93cff6de97f0dad79b1acd79a2a3dc)); nothing links it to the deposit or the cohort |
| 2026-11-08 | | EjectHelper live on Base mainnet at `0x262fe96b235be762dca8cc1937a542848e12f8b8`, deployed from an address only NEAR MPC can sign for ([tx](https://basescan.org/tx/0x0a60bd60acdda6bef6b7f56066b7fa28bc4f04b21e8cce5ece71dfd7111074f1)) |
| 2026-11-08 | 77c7652 | offmap.near contract: 48 tests, testnet runs with real MPC signatures for signing, eject and recovery (`contracts/near/TESTNET.md`) |
| 2026-11-08 | | **offmap.near live on NEAR mainnet** ([deploy + new](https://nearblocks.io/txns/8CyDQzm6ZGSSsDc6CWMSAr7BTYAFMzEmCpCHkqEnWKdY)): requires_tee true, approved TDX measurements computed from the pinned agent compose, 23 Phala device ids, both cohorts with the live eject helper |
| 2026-11-08 | | offmap.near lost to a name sniper during a redeploy (storage NEAR recovered); product contract is now **offmapfi.near** ([deploy](https://nearblocks.io/txns/28BvAxvTXkr2VhpRq2xZwkkDPJR9jSyjUmCv8vM7P12E), [code update with set_config](https://nearblocks.io/txns/4NQUPZPtkkbGrpFo347YWhbipp3YrrkSS7zEQWX4PxUU), [measurements approved](https://nearblocks.io/txns/3nsyMdRxeN2Cr8yCuFAoRw1itmBAca7pyRTsovdNcitk)) |
| 2026-11-08 | | **Agent runs in Intel TDX on Phala (dstack 0.5.12) and registered on offmapfi.near with a real attestation** ([register_agent](https://nearblocks.io/txns/B5zGUub7dp15BHHpuR8ZEUQhN3wKyP5iSn9Q2wR9Ssez)); compose hash `e9aa24a1…a046` reproduces from `apps/agent/docker-compose.yaml`; intents.near now lists the agent key for offmapfi.near |
| 2026-11-08 | | **First production loan through the TEE agent**: demo wallet `0xdFfE…C8c9` deposited 6,300 sats cbBTC from Base; agent supplied 6,296 sats to the production cohort `0x5bDE486b…9B5a` and borrowed 1.5 USDC (Morpho shows collateral 6296, debt 1.500000); payouts left in round lots from the shared Intents wallet ([1.0](https://basescan.org/tx/0x683d935fe501c4e83179d375645fcc66215458a2da2ee073008b81abb96fc92b), [0.4998](https://basescan.org/tx/0xa7151c2ed4e3bc6ecb1b67c016569bc122503487d0c302f313bc9e03c081a42a)). Agent key is now derived from the dstack key service, so its account survives updates |

## Nov 9 2026: release audit fixes

- Cohort cbbtc-usdc authorized the EjectHelper on Morpho: [0x4e9fee0e…](https://basescan.org/tx/0x4e9fee0e7798f40214b0aa6d11a2d429d7723804fc4f27caa91ea71bcb212ae4). Without it every eject reverted on withdrawCollateral.
- Agent reads the contract's signed ejects every batch, lands them at their nonce before its own transactions, removes landed positions and freezes users with an eject in flight.
- Withdraw and payout paths made idempotent. New agent image compose hash f1fc8f94…, approved by set_config [Bk1XtK…](https://nearblocks.io/txns/Bk1XtKMxcvfkVv2xeYZm7Kwi1AitKeCZmSZ9b1EVXsp8).
- Judge checks: 11 of 11 pass.

## Nov 9 2026: batch lock live

- Contract upgraded ([3LMiTq…](https://nearblocks.io/txns/3LMiTqVgZU6Rc4h5K8erGpYrKFLXPoU7YYMPtSqRcg3V)): the agent signs only inside a batch lock; ejects are refused while a lock is open and the lock cannot open while an eject is being signed; a new root needs the lock holder; config changes wait 24 hours in public; sweep and wind down for the owner.
- Agent posts the new statement before any money moves and resolves Intents transits by status, outside the lock.
- First batch under the lock on mainnet: [begin_batch](https://nearblocks.io/txns/9YGLmXtBERqVN7vuHRhS5CKaqfJ1hi8ZKWL5aNb9gfWF), a 0.5 USDC private borrow ([borrow](https://basescan.org/tx/0x9b216922cfd7288b316a7de59a6b35743aa4de27b25a09dcd8476e3f9323aa4c), [to the private balance](https://basescan.org/tx/0xefd197b2c33c25d10d99a3d31626f3ca3cf985f529ca4daff81a7cdbdbf53d50)), [end_batch](https://nearblocks.io/txns/Gbrk8A2xLnqX6ke1qNLJGAdd122diW8CnVjFK6LgAaLg).
- Gas right sized (60 Tgas signing, 30 Tgas calls) so the agent runs on a few tenths of a NEAR; spare NEAR goes back to the contract.

## Nov 10 2026: first mainnet eject reverted, cause found

- The NEAR contract signed the demo user's eject as designed ([GuwrhoVM…](https://nearblocks.io/txns/GuwrhoVMLqpq2F8emEELzL7fBxdU5T2rHAkoMK5SMfXn)). The Base transaction [reverted](https://basescan.org/tx/0x028f3b9a926dc9075769aea5b5ba4697b85062904813662f0b457c01ebd258f1) with an arithmetic underflow inside Morpho's repay.
- Cause: the private ledger charges the Offmap spread on top of Morpho's rate, so ledger debt runs a little ahead of the cohort's real Morpho debt. The agent turned ledger debt straight into Morpho borrow shares for each statement, so the last user in a cohort was owed 1,994,149,315,563 shares while the cohort held 1,994,021,038,847 (about 0.00014 USDC apart). Morpho cannot repay more shares than a position has.
- Fix: statements never publish more shares than the cohort will hold once the batch's own moves land; spare dust stays with the pool, covered by the spread. The new agent image was proposed on chain with the 24 hour public notice ([DagBtaeH…](https://nearblocks.io/txns/DagBtaeHJN2Uy6oXxMKixVEJGRpYV49DMJpwzdozZs19)) and the eject is rerun once it applies.
- Eject now prepays 50 Tgas (measured: 5.3 Tgas of its own plus 25 forwarded to the signer and callback), so a user needs about 0.07 NEAR to leave on their own.

## Nov 12 2026: mainnet eject landed

- The fixed agent image applied after its 24 hour notice ([apply_config CsDdYNAR…](https://nearblocks.io/txns/CsDdYNARcquBVmwupdvZQ1SCLiGmtJZ4Br8yzjDrsSuC)) and the agent re registered with its new TDX attestation.
- First eject on the new statement: NEAR signed ([78GPwEAn…](https://nearblocks.io/txns/78GPwEAnnYAEbLCc5DBWTM8RmrnTk6XWCT8g2mmEq2XX)), Base [reverted](https://basescan.org/tx/0xcd09c9126430bdd179d81f82e9ffc4b32716895484f0b158c1eaf93e7412227e) with "insufficient collateral": the share cap left 66M borrow shares (about 0.00007 USDC) on the pool, and the demo user was the pool's only borrower, so the eject would have left that dust with no collateral.
- Morpho lets anyone repay on another address's behalf: 0.0003 USDC repaid for the pool ([0x95ff4272…](https://basescan.org/tx/0x95ff4272f679e90229a13d6563a9892c0918cf275e5351152a4946a20f15e30f)). The agent gave the user a fresh leaf in the next statement, whose shares equal the pool's on chain shares exactly.
- **Eject landed**: NEAR [Bmzf1bgg…](https://nearblocks.io/txns/Bmzf1bggxs4gFidYxmH8wg9ReMCNTYG37q3aZ1oaarNY), Base [0x1c765da1…](https://basescan.org/tx/0x1c765da1410120e8f4054434a7d49b6217bee3fcefc2178855dfbbc3e2569470). The demo wallet now owns its Morpho position (6296 sats cbBTC, 2.31 USDC debt); the pooled borrower is at zero.
- If a last borrower ever meets the same dust, anyone can clear it with the same public repay on the pool's behalf, as above.

## Nov 13 2026: hunter lookup and trust page

- The [hunter view](https://offmap.jdollar.site/hunter) reads any Base wallet's Morpho loans from the public API and shows the liquidation price and how far it is from today.
- The [proof page](https://offmap.jdollar.site/proof#trust) lists who you still trust and what stops each of them, and states the live size of the pools.
- Commit 83e6a34. Submitted to NEAR HACKATHON in the DeFi and Privacy tracks.
