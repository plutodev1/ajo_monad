// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AjoCircle} from "../src/AjoCircle.sol";
import {IERC20} from "../src/SafeToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AjoCircleTest is Test {
    AjoCircle circle;
    MockUSDC usdc;
    address ada = makeAddr("ada");
    address bayo = makeAddr("bayo");
    address chi = makeAddr("chi");
    address outsider = makeAddr("outsider");
    uint96 constant C = 10e6; // 10 USDC per round
    uint32 constant WEEK = 7 days;

    function setUp() public {
        usdc = new MockUSDC();
        circle = new AjoCircle(IERC20(address(usdc)));
        address[4] memory people = [ada, bayo, chi, outsider];
        for (uint256 i = 0; i < 4; i++) {
            usdc.mint(people[i], 1_000e6);
            vm.prank(people[i]);
            usdc.approve(address(circle), type(uint256).max);
        }
    }

    function _members() internal view returns (address[] memory m) {
        m = new address[](3);
        m[0] = ada;
        m[1] = bayo;
        m[2] = chi;
    }

    function _open() internal returns (uint256) {
        return circle.createCircle("Market women weekly", _members(), C, 0, WEEK);
    }

    function test_CreateCircle() public {
        uint256 id = _open();
        AjoCircle.Circle memory c = circle.getCircle(id);
        assertEq(c.name, "Market women weekly");
        assertEq(c.organizer, address(this));
        assertEq(c.contribution, C);
        assertEq(c.currentRound, 0);
        assertEq(circle.circleCount(), 1);
        assertTrue(circle.isMember(id, bayo));
        assertEq(circle.roundDeadline(id), block.timestamp + WEEK);
    }

    function test_RevertWhen_BadMembers() public {
        address[] memory one = new address[](1);
        one[0] = ada;
        vm.expectRevert(AjoCircle.BadMembers.selector);
        circle.createCircle("x", one, C, 0, WEEK);

        address[] memory dup = new address[](2);
        dup[0] = ada;
        dup[1] = ada;
        vm.expectRevert(AjoCircle.BadMembers.selector);
        circle.createCircle("x", dup, C, 0, WEEK);

        address[] memory zero = new address[](2);
        zero[0] = ada;
        vm.expectRevert(AjoCircle.BadMembers.selector);
        circle.createCircle("x", zero, C, 0, WEEK);
    }

    function test_RevertWhen_BadParams() public {
        vm.expectRevert(AjoCircle.ZeroAmount.selector);
        circle.createCircle("x", _members(), 0, 0, WEEK);
        vm.expectRevert(AjoCircle.ZeroDuration.selector);
        circle.createCircle("x", _members(), C, 0, 0);
        vm.expectRevert(AjoCircle.EmptyName.selector);
        circle.createCircle("", _members(), C, 0, WEEK);
    }

    function test_FullRoundPaysRecipientAutomatically() public {
        uint256 id = _open();
        vm.prank(bayo);
        circle.contribute(id);
        vm.prank(chi);
        circle.contribute(id);
        uint256 adaBefore = usdc.balanceOf(ada);
        vm.prank(ada); // last payer triggers payout to ada (round 0's recipient)
        circle.contribute(id);

        assertEq(usdc.balanceOf(ada), adaBefore - C + 3 * C);
        assertEq(usdc.balanceOf(address(circle)), 0);
        AjoCircle.Circle memory c = circle.getCircle(id);
        assertEq(c.currentRound, 1);
        assertEq(c.pot, 0);
        assertEq(circle.payoutOfRound(id, 0), 3 * C);
    }

    function test_WholeCycleEveryoneGetsTheirTurn() public {
        uint256 id = _open();
        address[] memory m = _members();
        for (uint256 r = 0; r < 3; r++) {
            for (uint256 i = 0; i < 3; i++) {
                vm.prank(m[i]);
                circle.contribute(id);
            }
        }
        // everyone paid 3 * C and received 3 * C — net zero, just like a real Ajo
        assertEq(usdc.balanceOf(ada), 1_000e6);
        assertEq(usdc.balanceOf(bayo), 1_000e6);
        assertEq(usdc.balanceOf(chi), 1_000e6);
        assertTrue(circle.getCircle(id).finished);

        vm.prank(ada);
        vm.expectRevert(AjoCircle.CircleFinishedAlready.selector);
        circle.contribute(id);
    }

    function test_RevertWhen_PayingTwiceInARound() public {
        uint256 id = _open();
        vm.startPrank(ada);
        circle.contribute(id);
        vm.expectRevert(AjoCircle.AlreadyPaidThisRound.selector);
        circle.contribute(id);
        vm.stopPrank();
    }

    function test_RevertWhen_Outsider() public {
        uint256 id = _open();
        vm.prank(outsider);
        vm.expectRevert(AjoCircle.NotAMember.selector);
        circle.contribute(id);
    }

    function test_RevertWhen_BeforeStart() public {
        uint256 id = circle.createCircle("later", _members(), C, uint64(block.timestamp + 1 days), WEEK);
        vm.prank(ada);
        vm.expectRevert(AjoCircle.RoundNotOpen.selector);
        circle.contribute(id);
    }

    function test_CloseRoundMarksDefaulters() public {
        uint256 id = _open();
        vm.prank(ada);
        circle.contribute(id);
        vm.prank(bayo);
        circle.contribute(id);

        vm.expectRevert(AjoCircle.RoundStillOpen.selector);
        circle.closeRound(id);

        vm.warp(block.timestamp + WEEK + 1);
        vm.prank(chi);
        vm.expectRevert(AjoCircle.RoundOverdue.selector);
        circle.contribute(id);

        uint256 adaBefore = usdc.balanceOf(ada);
        vm.prank(outsider); // anyone can close an overdue round
        circle.closeRound(id);

        assertEq(usdc.balanceOf(ada), adaBefore + 2 * C);
        assertEq(circle.missedRounds(id, chi), 1);
        assertEq(circle.missedRounds(id, ada), 0);

        AjoCircle.MemberView[] memory view_ = circle.getMembers(id);
        assertEq(view_[0].received, 2 * C);
        assertEq(view_[2].missed, 1);
        assertEq(circle.getCircle(id).currentRound, 1);
    }

    function test_NextRoundKeepsSchedule() public {
        uint256 id = _open();
        uint256 start = block.timestamp;
        address[] memory m = _members();
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(m[i]);
            circle.contribute(id);
        }
        // early payout does not shift the calendar: round 1 still ends 2 weeks after start
        assertEq(circle.roundDeadline(id), start + 2 * uint256(WEEK));
    }

    function testFuzz_ContributionAmounts(uint96 amount) public {
        vm.assume(amount > 0 && amount < 300e6);
        uint256 id = circle.createCircle("fuzz", _members(), amount, 0, WEEK);
        uint256 bayoBefore = usdc.balanceOf(bayo);
        address[] memory m = _members();
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(m[i]);
            circle.contribute(id);
        }
        assertEq(usdc.balanceOf(bayo), bayoBefore - amount);
        assertEq(circle.payoutOfRound(id, 0), uint256(amount) * 3);
    }

    /// A late closeRound must not push the circle into an already-expired turn
    /// (reported by KupiaSec): the next member must still get a full window to be paid.
    function test_LateCloseDoesNotSkipNextTurn() public {
        uint256 id = _open();
        vm.prank(ada);
        circle.contribute(id);
        vm.prank(bayo);
        circle.contribute(id); // chi defaults in round 0

        vm.warp(block.timestamp + 15 days); // closed 8 days late: round 1 slot already over
        circle.closeRound(id);

        // round 1 (bayo's turn) must be open for payments, not instantly closable
        vm.expectRevert(AjoCircle.RoundStillOpen.selector);
        circle.closeRound(id);
        address[] memory m = _members();
        uint256 bayoBefore = usdc.balanceOf(bayo);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(m[i]);
            circle.contribute(id);
        }
        assertEq(usdc.balanceOf(bayo), bayoBefore - C + 3 * C);
        assertEq(circle.missedRounds(id, ada), 0);
        assertEq(circle.missedRounds(id, bayo), 0);
    }
}
