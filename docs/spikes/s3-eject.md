# Spike S3: eject in one transaction on Morpho Blue (Base)

**Question.** Can one user's share of a pooled cohort position on Morpho Blue move into a position owned by the user's own wallet, atomically, without the cohort or the helper keeping access to the user's account?

**What was run.** `contracts/base/src/EjectHelper.sol`, tested with Foundry on a fork of Base mainnet against the real cbBTC/USDC market `0x9103c3b4…191836` (`contracts/base/test/EjectHelper.t.sol`, run `forge test`).

Flow inside one call from the cohort account:
1. The user's signed Morpho authorization of the helper is applied (`setAuthorizationWithSig`).
2. Morpho flash loan of USDC.
3. Repay the user's borrow shares on the cohort position.
4. Withdraw the user's collateral from the cohort (the cohort authorized the helper once).
5. Supply that collateral to the user's own position and borrow the repaid amount there.
6. Flash loan repaid; the user's signed revocation is applied, so the helper keeps no access.

**Output.**
```
[PASS] test_ejectMovesUserShareToOwnWallet() (gas: 469252)
[PASS] test_onlyCohortCanEjectItsOwnPosition() (gas: 248413)
[PASS] test_rejectsGrantForAnotherAccount() (gas: 104050)
```
Cohort collateral and debt shares fall by exactly the user's share; the user's position holds the same collateral and debt; the helper holds zero tokens and is no longer authorized by the user.

**Verdict.** Pass. Eject works on real Morpho liquidity on Base in one transaction, about 470k gas. Next: the NEAR contract signs this call for the cohort's chain signatures address after verifying the user's note and Merkle proof.
