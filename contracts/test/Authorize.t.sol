// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoleTestBase} from "./KnoleTestBase.sol";
import {IERC7857Authorize} from "../interfaces/IERC7857Authorize.sol";

contract AuthorizeTest is KnoleTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _mint(alice, "granted");
    }

    function test_Authorize_HappyPath() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit IERC7857Authorize.UsageAuthorized(id, bob);
        nft.authorizeUsage(id, bob);

        assertTrue(nft.isAuthorizedUser(id, bob));
        address[] memory users = nft.authorizedUsersOf(id);
        assertEq(users.length, 1);
        assertEq(users[0], bob);
    }

    function test_Authorize_DoubleGrant_Reverts() public {
        vm.startPrank(alice);
        nft.authorizeUsage(id, bob);
        vm.expectRevert(bytes("already authorized"));
        nft.authorizeUsage(id, bob);
        vm.stopPrank();
    }

    function test_Authorize_ZeroUser_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("zero user"));
        nft.authorizeUsage(id, address(0));
    }

    function test_Authorize_NonOwner_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(bytes("not owner"));
        nft.authorizeUsage(id, carol);
    }

    function test_Revoke_HappyPath() public {
        vm.startPrank(alice);
        nft.authorizeUsage(id, bob);
        vm.expectEmit(true, true, false, false);
        emit IERC7857Authorize.UsageRevoked(id, bob);
        nft.revokeAuthorization(id, bob);
        vm.stopPrank();
        assertFalse(nft.isAuthorizedUser(id, bob));
        assertEq(nft.authorizedUsersOf(id).length, 0);
    }

    /// Swap-and-pop correctness: revoking the middle grant keeps the other two intact.
    function test_Revoke_MiddleElement_KeepsOthers() public {
        address dave = makeAddr("dave");
        vm.startPrank(alice);
        nft.authorizeUsage(id, bob);
        nft.authorizeUsage(id, carol);
        nft.authorizeUsage(id, dave);
        nft.revokeAuthorization(id, carol);
        vm.stopPrank();

        assertFalse(nft.isAuthorizedUser(id, carol));
        assertTrue(nft.isAuthorizedUser(id, bob));
        assertTrue(nft.isAuthorizedUser(id, dave));
        assertEq(nft.authorizedUsersOf(id).length, 2);
    }

    function test_Revoke_NotAuthorized_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not authorized"));
        nft.revokeAuthorization(id, bob);
    }

    function test_Revoke_NonOwner_Reverts() public {
        vm.prank(alice);
        nft.authorizeUsage(id, bob);
        vm.prank(bob);
        vm.expectRevert(bytes("not owner"));
        nft.revokeAuthorization(id, bob);
    }

    function test_Authorize_CapAt100() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 100; i++) {
            nft.authorizeUsage(id, address(uint160(0x1000 + i)));
        }
        vm.expectRevert(bytes("max authorizations"));
        nft.authorizeUsage(id, address(uint160(0x2000)));
        // Revocation from a full list stays workable (swap-and-pop, no unbounded shift).
        nft.revokeAuthorization(id, address(uint160(0x1000 + 50)));
        assertEq(nft.authorizedUsersOf(id).length, 99);
        vm.stopPrank();
    }

    function test_Batch_HappyPath_AndSkipsExisting() public {
        vm.startPrank(alice);
        uint256 id2 = nft.iMint(alice, _data("second"));
        nft.authorizeUsage(id, bob); // pre-existing grant on the first token
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = id2;
        nft.batchAuthorizeUsage(ids, bob); // skips id (already granted), grants id2
        vm.stopPrank();

        assertTrue(nft.isAuthorizedUser(id, bob));
        assertTrue(nft.isAuthorizedUser(id2, bob));
        assertEq(nft.authorizedUsersOf(id).length, 1, "no duplicate from the skip");
    }

    function test_Batch_OneNotOwned_RevertsWhole() public {
        vm.prank(bob);
        uint256 bobsId = nft.iMint(bob, _data("bobs"));
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = bobsId;
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        nft.batchAuthorizeUsage(ids, carol);
        assertFalse(nft.isAuthorizedUser(id, carol), "atomic: nothing granted");
    }

    function test_Batch_ZeroUser_Reverts() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(alice);
        vm.expectRevert(bytes("zero user"));
        nft.batchAuthorizeUsage(ids, address(0));
    }

    function testFuzz_GrantRevoke_SetConsistency(address[8] memory users) public {
        vm.startPrank(alice);
        uint256 granted;
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == address(0) || nft.isAuthorizedUser(id, users[i])) continue;
            nft.authorizeUsage(id, users[i]);
            granted++;
        }
        assertEq(nft.authorizedUsersOf(id).length, granted);
        // Revoke every granted user; the set must drain to empty with mapping in sync.
        address[] memory list = nft.authorizedUsersOf(id);
        for (uint256 i = 0; i < list.length; i++) {
            nft.revokeAuthorization(id, list[i]);
            assertFalse(nft.isAuthorizedUser(id, list[i]));
        }
        assertEq(nft.authorizedUsersOf(id).length, 0);
        vm.stopPrank();
    }
}
