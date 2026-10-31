// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AjoBook} from "../src/AjoBook.sol";
import {IERC20} from "../src/SafeToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AjoBookTest is Test {
    AjoBook book;
    MockUSDC usdc;
    uint96 constant D = 5e6; // 5 USDC
    address admin = address(this);
    address ada = makeAddr("ada");
    address bayo = makeAddr("bayo");
    address chi = makeAddr("chi");

    function setUp() public {
        usdc = new MockUSDC();
        book = new AjoBook("ChainConnect NG", IERC20(address(usdc)));
        address[3] memory people = [ada, bayo, chi];
        for (uint256 i = 0; i < 3; i++) {
            usdc.mint(people[i], 1_000e6);
            vm.prank(people[i]);
            usdc.approve(address(book), type(uint256).max);
        }
    }

    function test_InitialState() public view {
        assertEq(book.admin(), admin);
        assertEq(book.communityName(), "ChainConnect NG");
        assertEq(book.campaignCount(), 0);
    }

    function test_CreateCampaign() public {
        uint256 id = book.createCampaign("July Dues", "Monthly dues", D, 0);
        assertEq(id, 0);
        assertEq(book.campaignCount(), 1);
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.name, "July Dues");
        assertEq(c.duesAmount, D);
        assertFalse(c.closed);
    }

    function test_RevertWhen_NonAdminCreates() public {
        vm.prank(ada);
        vm.expectRevert(AjoBook.NotAdmin.selector);
        book.createCampaign("X", "", 0, 0);
    }

    function test_RevertWhen_EmptyCampaignName() public {
        vm.expectRevert(AjoBook.EmptyName.selector);
        book.createCampaign("", "", 0, 0);
    }

    function test_PayFixedDues() public {
        book.createCampaign("July Dues", "", D, 0);
        vm.prank(ada);
        book.payDues(0, D);

        assertEq(book.paidAmount(0, ada), D);
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.totalCollected, D);
        assertEq(c.payerCount, 1);
        assertEq(usdc.balanceOf(address(book)), D);
        assertEq(book.balance(), D);
    }

    function test_RevertWhen_WrongFixedAmount() public {
        book.createCampaign("July Dues", "", D, 0);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(AjoBook.WrongAmount.selector, D, D / 2));
        book.payDues(0, D / 2);
    }

    function test_OpenAmountCampaign() public {
        book.createCampaign("Event Fund", "", 0, 0);
        vm.prank(ada);
        book.payDues(0, 3e5);
        vm.prank(bayo);
        book.payDues(0, 2 * D);
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.totalCollected, 3e5 + 2 * D);
        assertEq(c.payerCount, 2);
    }

    function test_RevertWhen_ZeroValue() public {
        book.createCampaign("Event Fund", "", 0, 0);
        vm.prank(ada);
        vm.expectRevert(AjoBook.ZeroAmount.selector);
        book.payDues(0, 0);
    }

    function test_RepeatPayerCountedOnce() public {
        book.createCampaign("Event Fund", "", 0, 0);
        vm.startPrank(ada);
        book.payDues(0, D);
        book.payDues(0, D);
        vm.stopPrank();
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.payerCount, 1);
        assertEq(book.paidAmount(0, ada), 2 * D);
    }

    function test_Deadline() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        book.createCampaign("July Dues", "", D, deadline);
        vm.warp(deadline + 1);
        vm.prank(ada);
        vm.expectRevert(AjoBook.DeadlinePassed.selector);
        book.payDues(0, D);
    }

    function test_RevertWhen_PayingClosedCampaign() public {
        book.createCampaign("July Dues", "", D, 0);
        book.closeCampaign(0);
        vm.prank(ada);
        vm.expectRevert(AjoBook.CampaignIsClosed.selector);
        book.payDues(0, D);
    }

    function test_RevertWhen_UnknownCampaign() public {
        vm.prank(ada);
        vm.expectRevert(AjoBook.CampaignNotFound.selector);
        book.payDues(7, D);
    }

    function test_LedgerWithNames() public {
        book.createCampaign("July Dues", "", D, 0);
        vm.prank(ada);
        book.setMyName("Ada from Enugu");
        vm.prank(ada);
        book.payDues(0, D);
        vm.prank(bayo);
        book.payDues(0, D);

        AjoBook.PaymentView[] memory page = book.getLedger(0);
        assertEq(page.length, 2);
        assertEq(page[0].member, ada);
        assertEq(page[0].name, "Ada from Enugu");
        assertEq(page[0].amount, D);
        assertEq(page[1].member, bayo);
        assertEq(page[1].name, "");
    }

    function test_Withdraw() public {
        book.createCampaign("July Dues", "", D, 0);
        vm.prank(ada);
        book.payDues(0, D);

        address treasury = makeAddr("treasury");
        book.withdraw(treasury, D);
        assertEq(usdc.balanceOf(treasury), D);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    function test_RevertWhen_NonAdminWithdraws() public {
        vm.prank(ada);
        vm.expectRevert(AjoBook.NotAdmin.selector);
        book.withdraw(ada, 0);
    }

    function test_TransferAdmin() public {
        book.transferAdmin(bayo);
        assertEq(book.admin(), bayo);
        vm.prank(bayo);
        book.createCampaign("New era", "", 0, 0);
        vm.expectRevert(AjoBook.NotAdmin.selector);
        book.createCampaign("Old admin locked out", "", 0, 0);
    }

    function testFuzz_PayOpenCampaign(uint96 amount) public {
        vm.assume(amount > 0);
        book.createCampaign("Fund", "", 0, 0);
        usdc.mint(chi, amount);
        vm.prank(chi);
        book.payDues(0, amount);
        assertEq(book.paidAmount(0, chi), amount);
    }

    function test_RevertWhen_NoApproval() public {
        book.createCampaign("July Dues", "", D, 0);
        address dele = makeAddr("dele");
        usdc.mint(dele, D);
        vm.prank(dele);
        vm.expectRevert();
        book.payDues(0, D);
    }

    function test_RevertWhen_ZeroTokenAddress() public {
        vm.expectRevert(AjoBook.ZeroAddress.selector);
        new AjoBook("X", IERC20(address(0)));
    }
}
