// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EjectHelper} from "../src/EjectHelper.sol";
import {IMorpho, IERC20Min, MarketParams, Authorization, Signature} from "../src/IMorpho.sol";

/// Spike S3: eject one user's share from a pooled cohort position into the user's own wallet,
/// on a fork of Base mainnet, against the real Morpho Blue cbBTC/USDC market.
contract EjectHelperForkTest is Test {
    IMorpho constant MORPHO = IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb);
    bytes32 constant MARKET = 0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836;
    bytes32 constant AUTH_TYPEHASH =
        keccak256("Authorization(address authorizer,address authorized,bool isAuthorized,uint256 nonce,uint256 deadline)");

    EjectHelper helper;
    MarketParams mp;
    address cohort = makeAddr("cohort");
    uint256 userKey = 0xB11D;
    address user;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC", string("https://mainnet.base.org")));
        helper = new EjectHelper(MORPHO);
        (address l, address c, address o, address i, uint256 lltv) = MORPHO.idToMarketParams(MARKET);
        mp = MarketParams(l, c, o, i, lltv);
        user = vm.addr(userKey);

        // cohort: 0.10 cbBTC collateral, borrow 2,000 USDC (low LTV), and authorize the helper once
        deal(mp.collateralToken, cohort, 10_000_000);
        vm.startPrank(cohort);
        IERC20Min(mp.collateralToken).approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, 10_000_000, cohort, "");
        MORPHO.borrow(mp, 2_000e6, 0, cohort, cohort);
        MORPHO.setAuthorization(address(helper), true);
        vm.stopPrank();
    }

    function _sign(bool on, uint256 nonce_) internal view returns (Authorization memory a, Signature memory s) {
        a = Authorization(user, address(helper), on, nonce_, block.timestamp + 1 hours);
        bytes32 h = keccak256(abi.encode(AUTH_TYPEHASH, a.authorizer, a.authorized, a.isAuthorized, a.nonce, a.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", MORPHO.DOMAIN_SEPARATOR(), h));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(userKey, digest);
        s = Signature(v, r, ss);
    }

    function test_ejectMovesUserShareToOwnWallet() public {
        (, uint128 cohortSharesBefore, uint128 cohortCollBefore) = MORPHO.position(MARKET, cohort);

        // the user owns 40% of the cohort
        uint256 userColl = uint256(cohortCollBefore) * 40 / 100;
        uint256 userShares = uint256(cohortSharesBefore) * 40 / 100;

        uint256 n = MORPHO.nonce(user);
        (Authorization memory g, Signature memory gs) = _sign(true, n);
        (Authorization memory r, Signature memory rs) = _sign(false, n + 1);

        vm.prank(cohort);
        helper.eject(mp, user, userColl, userShares, 801e6, g, gs, r, rs);

        (, uint128 cohortSharesAfter, uint128 cohortCollAfter) = MORPHO.position(MARKET, cohort);
        (, uint128 userSharesAfter, uint128 userCollAfter) = MORPHO.position(MARKET, user);

        assertEq(cohortCollAfter, cohortCollBefore - userColl, "cohort collateral");
        assertEq(cohortSharesAfter, cohortSharesBefore - userShares, "cohort debt shares");
        assertEq(userCollAfter, userColl, "user collateral");
        assertApproxEqRel(userSharesAfter, userShares, 1e12, "user debt shares");
        assertFalse(MORPHO.isAuthorized(user, address(helper)), "helper must not keep access");
        assertEq(IERC20Min(mp.loanToken).balanceOf(address(helper)), 0, "no loan token left");
        assertEq(IERC20Min(mp.collateralToken).balanceOf(address(helper)), 0, "no collateral left");
    }

    function test_onlyCohortCanEjectItsOwnPosition() public {
        uint256 n = MORPHO.nonce(user);
        (Authorization memory g, Signature memory gs) = _sign(true, n);
        (Authorization memory r, Signature memory rs) = _sign(false, n + 1);
        address stranger = makeAddr("stranger");
        // a stranger has no position and has not authorized the helper: withdraw from the stranger fails
        vm.prank(stranger);
        vm.expectRevert();
        helper.eject(mp, user, 1_000_000, 1, 1e6, g, gs, r, rs);
    }

    function test_rejectsGrantForAnotherAccount() public {
        uint256 n = MORPHO.nonce(user);
        (Authorization memory g, Signature memory gs) = _sign(true, n);
        (Authorization memory r, Signature memory rs) = _sign(false, n + 1);
        vm.prank(cohort);
        vm.expectRevert(EjectHelper.WrongAuthorizer.selector);
        helper.eject(mp, makeAddr("other"), 1_000_000, 1, 1e6, g, gs, r, rs);
    }
}
