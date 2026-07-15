// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AjoBook} from "../src/AjoBook.sol";

contract AjoBookTest is Test {
    AjoBook book;
    address admin = address(this);
    address ada = makeAddr("ada");
    address bayo = makeAddr("bayo");
    address chi = makeAddr("chi");

    function setUp() public {
        book = new AjoBook("ChainConnect NG");
        vm.deal(ada, 100 ether);
        vm.deal(bayo, 100 ether);
        vm.deal(chi, 100 ether);
    }

    function test_InitialState() public view {
        assertEq(book.admin(), admin);
        assertEq(book.communityName(), "ChainConnect NG");
        assertEq(book.campaignCount(), 0);
    }

    function test_CreateCampaign() public {
        uint256 id = book.createCampaign("July Dues", "Monthly dues", 1 ether, 0);
        assertEq(id, 0);
        assertEq(book.campaignCount(), 1);
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.name, "July Dues");
        assertEq(c.duesAmount, 1 ether);
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
        book.createCampaign("July Dues", "", 1 ether, 0);
        vm.prank(ada);
        book.payDues{value: 1 ether}(0);

        assertEq(book.paidAmount(0, ada), 1 ether);
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.totalCollected, 1 ether);
        assertEq(c.payerCount, 1);
        assertEq(address(book).balance, 1 ether);
    }

    function test_RevertWhen_WrongFixedAmount() public {
        book.createCampaign("July Dues", "", 1 ether, 0);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(AjoBook.WrongAmount.selector, 1 ether, 0.5 ether));
        book.payDues{value: 0.5 ether}(0);
    }

    function test_OpenAmountCampaign() public {
        book.createCampaign("Event Fund", "", 0, 0);
        vm.prank(ada);
        book.payDues{value: 0.3 ether}(0);
        vm.prank(bayo);
        book.payDues{value: 2 ether}(0);
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.totalCollected, 2.3 ether);
        assertEq(c.payerCount, 2);
    }

    function test_RevertWhen_ZeroValue() public {
        book.createCampaign("Event Fund", "", 0, 0);
        vm.prank(ada);
        vm.expectRevert(AjoBook.ZeroAmount.selector);
        book.payDues{value: 0}(0);
    }

    function test_RepeatPayerCountedOnce() public {
        book.createCampaign("Event Fund", "", 0, 0);
        vm.startPrank(ada);
        book.payDues{value: 1 ether}(0);
        book.payDues{value: 1 ether}(0);
        vm.stopPrank();
        AjoBook.Campaign memory c = book.getCampaign(0);
        assertEq(c.payerCount, 1);
        assertEq(book.paidAmount(0, ada), 2 ether);
    }

    function test_Deadline() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        book.createCampaign("July Dues", "", 1 ether, deadline);
        vm.warp(deadline + 1);
        vm.prank(ada);
        vm.expectRevert(AjoBook.DeadlinePassed.selector);
        book.payDues{value: 1 ether}(0);
    }

    function test_RevertWhen_PayingClosedCampaign() public {
        book.createCampaign("July Dues", "", 1 ether, 0);
        book.closeCampaign(0);
        vm.prank(ada);
        vm.expectRevert(AjoBook.CampaignIsClosed.selector);
        book.payDues{value: 1 ether}(0);
    }

    function test_RevertWhen_UnknownCampaign() public {
        vm.prank(ada);
        vm.expectRevert(AjoBook.CampaignNotFound.selector);
        book.payDues{value: 1 ether}(7);
    }

    function test_LedgerWithNames() public {
        book.createCampaign("July Dues", "", 1 ether, 0);
        vm.prank(ada);
        book.setMyName("Ada from Enugu");
        vm.prank(ada);
        book.payDues{value: 1 ether}(0);
        vm.prank(bayo);
        book.payDues{value: 1 ether}(0);

        AjoBook.PaymentView[] memory page = book.getLedger(0);
        assertEq(page.length, 2);
        assertEq(page[0].member, ada);
        assertEq(page[0].name, "Ada from Enugu");
        assertEq(page[0].amount, 1 ether);
        assertEq(page[1].member, bayo);
        assertEq(page[1].name, "");
    }

    function test_Withdraw() public {
        book.createCampaign("July Dues", "", 1 ether, 0);
        vm.prank(ada);
        book.payDues{value: 1 ether}(0);

        address payable treasury = payable(makeAddr("treasury"));
        book.withdraw(treasury, 1 ether);
        assertEq(treasury.balance, 1 ether);
        assertEq(address(book).balance, 0);
    }

    function test_RevertWhen_NonAdminWithdraws() public {
        vm.prank(ada);
        vm.expectRevert(AjoBook.NotAdmin.selector);
        book.withdraw(payable(ada), 0);
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
        vm.deal(chi, amount);
        vm.prank(chi);
        book.payDues{value: amount}(0);
        assertEq(book.paidAmount(0, chi), amount);
    }
}
