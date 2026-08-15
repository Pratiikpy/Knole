// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoleTestBase} from "./KnoleTestBase.sol";
import {KnoleAgenticID} from "../KnoleAgenticID.sol";

/// An admin that can actually receive ether (a Safe-like contract), for the sendValue path.
contract ReceivingAdmin {
    receive() external payable {}

    function withdrawFrom(KnoleAgenticID nft) external {
        nft.withdraw();
    }
}

/// An admin contract with NO receive function — .transfer would have bricked this forever;
/// sendValue reverts loudly instead of silently stranding fees.
contract NonReceivingAdmin {
    function withdrawFrom(KnoleAgenticID nft) external {
        nft.withdraw();
    }
}

contract AdminPauseTest is KnoleTestBase {
    function test_SetMintFee_AdminOnly() public {
        vm.prank(admin);
        nft.setMintFee(1 ether);
        assertEq(nft.mintFee(), 1 ether);

        vm.prank(alice);
        vm.expectRevert();
        nft.setMintFee(0);
    }

    function test_SetDataVerifier_AdminOnly_Emits() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit KnoleAgenticID.DataVerifierUpdated(address(verifier));
        nft.setDataVerifier(address(verifier));
        assertEq(address(nft.verifier()), address(verifier));

        vm.prank(alice);
        vm.expectRevert();
        nft.setDataVerifier(address(0));
    }

    function test_Withdraw_PaysAdmin_FullBalance() public {
        vm.prank(admin);
        nft.setMintFee(0.1 ether);
        vm.prank(alice);
        nft.iMint{value: 0.1 ether}(alice, _data("fee1"));
        vm.prank(bob);
        nft.iMint{value: 0.1 ether}(bob, _data("fee2"));

        uint256 before = admin.balance;
        vm.prank(admin);
        nft.withdraw();
        assertEq(admin.balance - before, 0.2 ether);
        assertEq(address(nft).balance, 0);
    }

    function test_Withdraw_NonAdmin_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.withdraw();
    }

    function test_Withdraw_ToContractAdmin_WorksViaSendValue() public {
        ReceivingAdmin safe = new ReceivingAdmin();
        vm.startPrank(admin);
        nft.grantRole(nft.DEFAULT_ADMIN_ROLE(), address(safe));
        nft.setMintFee(0.1 ether);
        vm.stopPrank();
        vm.prank(alice);
        nft.iMint{value: 0.1 ether}(alice, _data("safe-fee"));

        safe.withdrawFrom(nft);
        assertEq(address(safe).balance, 0.1 ether, "contract admin receives via sendValue");
    }

    function test_Withdraw_ToNonReceivingContract_RevertsLoudly() public {
        NonReceivingAdmin locked = new NonReceivingAdmin();
        vm.startPrank(admin);
        nft.grantRole(nft.DEFAULT_ADMIN_ROLE(), address(locked));
        nft.setMintFee(0.1 ether);
        vm.stopPrank();
        vm.prank(alice);
        nft.iMint{value: 0.1 ether}(alice, _data("stuck-fee"));

        vm.expectRevert(); // Address.sendValue bubbles a loud FailedCall, never a silent strand
        locked.withdrawFrom(nft);
    }

    function test_Pause_BlocksEveryMutator_UnpauseRestores() public {
        uint256 id = _mint(alice, "pre-pause");

        vm.prank(admin);
        nft.pause();

        bytes memory enforcedPause = abi.encodeWithSignature("EnforcedPause()");
        vm.startPrank(alice);
        vm.expectRevert(enforcedPause);
        nft.iMint(alice, _data("paused"));
        vm.expectRevert(enforcedPause);
        nft.evolve(id, _data("paused"));
        vm.expectRevert(enforcedPause);
        nft.iTransferFrom(alice, bob, id, noProofs);
        vm.expectRevert(enforcedPause);
        nft.iCloneFrom(alice, bob, id, noProofs);
        vm.expectRevert(enforcedPause);
        nft.authorizeUsage(id, bob);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert(enforcedPause);
        nft.iMintWithRole(bob, _data("paused"));

        vm.prank(admin);
        nft.unpause();
        vm.prank(alice);
        nft.evolve(id, _data("resumed"));
        assertEq(nft.version(id), 2);
    }

    function test_Pause_NonAdmin_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.pause();
    }

    function test_MinterRole_Lifecycle() public {
        vm.startPrank(admin);
        nft.grantRole(nft.MINTER_ROLE(), bob);
        vm.stopPrank();
        vm.prank(bob);
        uint256 id = nft.iMintWithRole(carol, _data("bob-minted"));
        assertEq(nft.ownerOf(id), carol);

        vm.startPrank(admin);
        nft.revokeRole(nft.MINTER_ROLE(), bob);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert();
        nft.iMintWithRole(carol, _data("revoked"));
    }
}
