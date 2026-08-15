// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoleTestBase, RejectingReceiver} from "./KnoleTestBase.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";
import {IERC7857Cloneable} from "../interfaces/IERC7857Cloneable.sol";

contract CloneTest is KnoleTestBase {
    uint256 internal srcId;

    function setUp() public override {
        super.setUp();
        srcId = _mint(alice, "origin");
    }

    function test_Clone_HappyPath() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit IERC7857Cloneable.IntelligentClone(alice, bob, srcId, 2);
        uint256 cloneId = nft.iCloneFrom(alice, bob, srcId, noProofs);

        assertEq(cloneId, 2, "sequential id");
        assertEq(nft.ownerOf(cloneId), bob);
        assertEq(nft.version(cloneId), 1, "clone starts at version 1");
        assertEq(nft.cloneSource(cloneId), srcId);
        IERC7857.IntelligentData[] memory src = nft.getIntelligentDatas(srcId);
        IERC7857.IntelligentData[] memory dup = nft.getIntelligentDatas(cloneId);
        assertEq(dup.length, src.length);
        assertEq(dup[0].dataHash, src[0].dataHash, "data deep-copied");
    }

    /// v1.1: clones emit IntelligentDataSet like any minted token, so indexers see their data
    /// (v1.0 pushed raw storage and emitted nothing — clones were invisible to indexers).
    function test_Clone_EmitsIntelligentDataSet() public {
        IERC7857.IntelligentData[] memory expected = _data("origin");
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit IERC7857.IntelligentDataSet(2, expected);
        nft.iCloneFrom(alice, bob, srcId, noProofs);
    }

    function test_Clone_SourceUntouched() public {
        uint64 vBefore = nft.version(srcId);
        vm.prank(alice);
        nft.iCloneFrom(alice, bob, srcId, noProofs);
        assertEq(nft.ownerOf(srcId), alice, "source still owned by alice");
        assertEq(nft.version(srcId), vBefore);
        assertEq(nft.getIntelligentDatas(srcId)[0].dataHash, keccak256("origin"));
    }

    function test_Clone_AuthorizationsNotInherited() public {
        vm.startPrank(alice);
        nft.authorizeUsage(srcId, carol);
        uint256 cloneId = nft.iCloneFrom(alice, bob, srcId, noProofs);
        vm.stopPrank();
        assertEq(nft.authorizedUsersOf(cloneId).length, 0, "grants never copy to a clone");
        assertTrue(nft.isAuthorizedUser(srcId, carol), "source grants untouched");
    }

    function test_Clone_DivergesIndependently() public {
        vm.prank(alice);
        uint256 cloneId = nft.iCloneFrom(alice, bob, srcId, noProofs);

        vm.prank(alice);
        nft.evolve(srcId, _data("source-evolved"));
        assertEq(nft.getIntelligentDatas(cloneId)[0].dataHash, keccak256("origin"), "clone unaffected");

        vm.prank(bob);
        nft.evolve(cloneId, _data("clone-evolved"));
        assertEq(nft.getIntelligentDatas(srcId)[0].dataHash, keccak256("source-evolved"), "source unaffected");
        assertEq(nft.version(cloneId), 2);
    }

    function test_Clone_OfClone_TracksImmediateParent() public {
        vm.prank(alice);
        uint256 c1 = nft.iCloneFrom(alice, bob, srcId, noProofs);
        vm.prank(bob);
        uint256 c2 = nft.iCloneFrom(bob, carol, c1, noProofs);
        assertEq(nft.cloneSource(c1), srcId);
        assertEq(nft.cloneSource(c2), c1, "clone-of-clone points at its immediate parent");
    }

    function test_Clone_Stranger_Reverts() public {
        vm.prank(carol);
        vm.expectRevert(); // ERC721InsufficientApproval
        nft.iCloneFrom(alice, bob, srcId, noProofs);
    }

    function test_Clone_ApprovedOperator_RevertsWithoutVerifier() public {
        vm.prank(alice);
        nft.approve(carol, srcId);
        vm.prank(carol);
        vm.expectRevert(bytes("verifier required for third-party move"));
        nft.iCloneFrom(alice, bob, srcId, noProofs);
    }

    function test_Clone_ApprovedOperator_WithValidProof_Succeeds() public {
        vm.prank(admin);
        nft.setDataVerifier(address(verifier));
        verifier.setResult(true);
        vm.prank(alice);
        nft.setApprovalForAll(carol, true);
        vm.prank(carol);
        uint256 cloneId = nft.iCloneFrom(alice, bob, srcId, _oneProof());
        assertEq(nft.ownerOf(cloneId), bob);
    }

    function test_Clone_ZeroRecipient_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("zero recipient"));
        nft.iCloneFrom(alice, address(0), srcId, noProofs);
    }

    function test_Clone_ToRejectingReceiver_RevertsAtomically() public {
        RejectingReceiver r = new RejectingReceiver();
        uint256 supplyBefore = nft.totalSupply();
        vm.prank(alice);
        vm.expectRevert();
        nft.iCloneFrom(alice, address(r), srcId, noProofs);
        assertEq(nft.totalSupply(), supplyBefore, "nothing minted");
    }

    function testFuzz_Clone_CopiesArbitraryDataFaithfully(uint8 n) public {
        n = uint8(bound(n, 1, 12));
        vm.startPrank(alice);
        uint256 multi = nft.iMint(alice, _dataN("fuzz-src", n));
        uint256 cloneId = nft.iCloneFrom(alice, bob, multi, noProofs);
        vm.stopPrank();
        IERC7857.IntelligentData[] memory src = nft.getIntelligentDatas(multi);
        IERC7857.IntelligentData[] memory dup = nft.getIntelligentDatas(cloneId);
        assertEq(dup.length, src.length);
        for (uint256 i = 0; i < src.length; i++) {
            assertEq(dup[i].dataHash, src[i].dataHash);
        }
    }
}
