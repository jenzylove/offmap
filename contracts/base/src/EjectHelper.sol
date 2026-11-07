// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMorpho, IERC20Min, MarketParams, Authorization, Signature} from "./IMorpho.sol";

/// @title EjectHelper
/// @notice Moves one user's share out of a pooled cohort position on Morpho Blue into a position
/// owned by the user's own wallet, in one transaction, using a Morpho flash loan.
/// @dev Immutable, no owner. Only the cohort account (a NEAR chain signatures address) can start an
/// eject from its own position. The user's side needs a one time Morpho authorization signed by the
/// user, plus a matching revocation, both consumed inside the same call, so the helper never keeps
/// standing access to the user's position.
contract EjectHelper {
    IMorpho public immutable MORPHO;

    error NotMorpho();
    error WrongAuthorizer();
    error WrongAuthorized();
    error NotRevoked();
    error Leftover();

    event Ejected(bytes32 indexed marketId, address indexed cohort, address indexed user, uint256 collateral, uint256 debtAssets);

    struct EjectData {
        MarketParams mp;
        address cohort;
        address user;
        uint256 collateral;
        uint256 borrowShares;
    }

    constructor(IMorpho morpho) {
        MORPHO = morpho;
    }

    /// @param mp the cohort market
    /// @param user the user's own wallet that receives the position
    /// @param collateral collateral assets to move
    /// @param borrowShares cohort borrow shares that belong to the user
    /// @param flashAssets loan token amount to flash borrow, at least the assets those shares repay
    /// @param grant user's signed authorization of this helper (isAuthorized = true)
    /// @param revoke user's signed revocation (isAuthorized = false, next nonce)
    function eject(
        MarketParams calldata mp,
        address user,
        uint256 collateral,
        uint256 borrowShares,
        uint256 flashAssets,
        Authorization calldata grant,
        Signature calldata grantSig,
        Authorization calldata revoke,
        Signature calldata revokeSig
    ) external {
        if (grant.authorizer != user || revoke.authorizer != user) revert WrongAuthorizer();
        if (grant.authorized != address(this) || revoke.authorized != address(this)) revert WrongAuthorized();
        if (!grant.isAuthorized || revoke.isAuthorized) revert NotRevoked();

        MORPHO.setAuthorizationWithSig(grant, grantSig);

        EjectData memory d = EjectData(mp, msg.sender, user, collateral, borrowShares);
        MORPHO.flashLoan(mp.loanToken, flashAssets, abi.encode(d));

        MORPHO.setAuthorizationWithSig(revoke, revokeSig);

        if (IERC20Min(mp.loanToken).balanceOf(address(this)) != 0) revert Leftover();
        if (IERC20Min(mp.collateralToken).balanceOf(address(this)) != 0) revert Leftover();
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        if (msg.sender != address(MORPHO)) revert NotMorpho();
        EjectData memory d = abi.decode(data, (EjectData));

        // 1. repay the user's share of the cohort debt
        IERC20Min(d.mp.loanToken).approve(address(MORPHO), type(uint256).max);
        (uint256 repaid,) = MORPHO.repay(d.mp, 0, d.borrowShares, d.cohort, "");

        // 2. take the user's collateral out of the cohort (cohort has authorized this helper)
        MORPHO.withdrawCollateral(d.mp, d.collateral, d.cohort, address(this));

        // 3. open the same position at the user's own wallet
        IERC20Min(d.mp.collateralToken).approve(address(MORPHO), d.collateral);
        MORPHO.supplyCollateral(d.mp, d.collateral, d.user, "");
        MORPHO.borrow(d.mp, repaid, 0, d.user, address(this));

        bytes32 id = keccak256(abi.encode(d.mp));
        emit Ejected(id, d.cohort, d.user, d.collateral, repaid);

        // Morpho pulls `assets` back after this returns; approval above covers it.
        assets;
    }
}
