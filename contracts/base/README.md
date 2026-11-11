# EjectHelper (Base)

Moves one user's share out of a pooled Offmap cohort position on Morpho Blue into a position owned by the user's own wallet, in one transaction, using a Morpho flash loan. No owner, no upgrade path. Only the cohort account (a NEAR chain signatures address) can start an eject from its own position, and the user's side needs a one time Morpho authorization plus a matching revocation, both used inside the same call.

Live on Base: [0x262fe96b235be762dca8cc1937a542848e12f8b8](https://basescan.org/address/0x262fe96b235be762dca8cc1937a542848e12f8b8) (source verified).

## Build and test

```sh
cd contracts/base
forge install foundry-rs/forge-std@v1.17.0 --no-git   # once; lib/ is not committed
forge build
forge test --fork-url https://mainnet.base.org        # runs the eject against real Morpho state on a Base fork
```

Files: `src/EjectHelper.sol` (the helper), `src/IMorpho.sol` (the Morpho Blue interface it calls), `test/EjectHelper.t.sol` (fork test).
