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
