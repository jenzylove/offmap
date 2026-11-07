# @offmap/core

Pure TypeScript logic for pooled private borrowing. No network, no secrets. All money is `bigint` in smallest units.

| Module | What it does |
|---|---|
| `types` | `Cohort`, `UserPosition`, `CohortLedger`, `Op`, `SolvencyStatement`, `Note`, `LossEvent`, `MerkleProof` |
| `risk` | `collateralValue`, `ltvBps`, `liquidationPrice`, `checkBorrow`, `checkWithdraw`, `planLiquidation`. Open max 6000 bps, liquidation at 7000 back to 6000, penalty 300 bps of the repaid amount. Price is loan tokens per whole collateral token, scaled 1e8 |
| `interest` | `accrue(debt, aprBps, spreadBps, seconds)`: per second compounding in integer ray math, split into Morpho part and spread (spread goes to the reserve) |
| `batch` | `applyBatch(ledger, ops, ctx)` accrues, applies ops in order, returns the new ledger, ONE net `{collateralDelta, debtDelta}`, rejected ops with reason codes, liquidations and loss events. `liquidationOps` lists positions at or above 7000 bps |
| `waterfall` | `absorbShortfall`: user residual, then cohort reserve, then pro rata by debt across other users of the same cohort. The `LossEvent` has no user id |
| `merkle` | `leafHash`, `buildTree` (padded to a power of two, minimum 1024, filler `keccak256("offmap-pad" \|\| uint32 index)`), `root`, `proof`, `verify`. Positional hashing, never sorted pairs |
| `statement` | `commit(ledger)`, `buildStatement`, `checkInvariants` |
| `notes` | `createNote`, `verifyNote(note, root)` |

Leaf: `keccak256(keccak(cohortId) || keccak(userId) || uint256 collateral || uint256 debt || uint256 nonce || bytes32 salt)`.

The salt source is injected (`ctx.saltFor`); the agent passes a CSPRNG (`randomSalt()`).

Run `pnpm test`.
