// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoleTestBase} from "./KnoleTestBase.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";

/// The bug-documenting suite. Written as the DESIRED behavior per the ERC-7857 standard (the official
/// 0G implementation mandates that raw ERC-721 transfers revert with ERC7857UseITransferFrom, and
/// clears usage grants inside _update so no path can bypass the clear). These tests FAIL against the
/// v1.0 contract deployed on mainnet — that is the point: they pin the bug before the v1.1 fix.
contract TransferSecurityTest is KnoleTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _mint(alice, "seed");
    }

    // ── Raw ERC-721 paths must be closed (standard: MUST revert) ───────────────────────────────────

    function test_RawTransferFrom_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC7857UseITransferFrom in v1.1
        nft.transferFrom(alice, bob, id);
    }

    function test_RawSafeTransferFrom_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.safeTransferFrom(alice, bob, id);
    }

    function test_RawSafeTransferFromWithData_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.safeTransferFrom(alice, bob, id, "");
    }

    /// The dangerous variant: an APPROVED operator (e.g. a marketplace) must not be able to move the
    /// token through the raw path, bypassing the verifier gate entirely.
    function test_ApprovedOperator_CannotRawTransfer() public {
        vm.prank(alice);
        nft.approve(carol, id);
        vm.prank(carol);
        vm.expectRevert();
        nft.transferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), alice, "token must not move");
    }

    function test_OperatorApprovalForAll_CannotRawTransfer() public {
        vm.prank(alice);
        nft.setApprovalForAll(carol, true);
        vm.prank(carol);
        vm.expectRevert();
        nft.safeTransferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), alice);
    }

    // ── Grants must be cleared on EVERY ownership change ───────────────────────────────────────────

    function test_iTransferFrom_ClearsAuthorizations() public {
        vm.startPrank(alice);
        nft.authorizeUsage(id, bob);
        nft.authorizeUsage(id, carol);
        nft.iTransferFrom(alice, bob, id, noProofs);
        vm.stopPrank();

        assertEq(nft.authorizedUsersOf(id).length, 0, "grants cleared");
        assertFalse(nft.isAuthorizedUser(id, bob));
        assertFalse(nft.isAuthorizedUser(id, carol));
        assertEq(nft.ownerOf(id), bob);
    }

    // ── iTransferFrom semantics (verifier unset: owner-only self-move) ─────────────────────────────

    function test_iTransferFrom_OwnerMove_PreservesDataAndVersion() public {
        vm.startPrank(alice);
        nft.evolve(id, _data("evolved"));
        uint64 v = nft.version(id);
        vm.expectEmit(true, true, true, true);
        emit IERC7857.IntelligentTransfer(alice, bob, id);
        nft.iTransferFrom(alice, bob, id, noProofs);
        vm.stopPrank();

        assertEq(nft.ownerOf(id), bob);
        assertEq(nft.version(id), v, "version survives transfer");
        assertEq(nft.getIntelligentDatas(id)[0].dataHash, keccak256("evolved"));
    }

    /// v1.1 rejects an unapproved stranger at the ERC-721 authorization check, before the verifier
    /// gate is even consulted (ERC721InsufficientApproval). The "verifier required" message is
    /// exercised by the approved-operator test below.
    function test_iTransferFrom_ThirdParty_RevertsWithoutVerifier() public {
        vm.prank(carol);
        vm.expectRevert();
        nft.iTransferFrom(alice, bob, id, noProofs);
        assertEq(nft.ownerOf(id), alice);
    }

    /// Even an approved operator must not pass the iTransferFrom gate while no verifier is wired —
    /// self-custody moves need no re-encryption precisely because the OWNER makes them.
    function test_iTransferFrom_ApprovedOperator_StillRevertsWithoutVerifier() public {
        vm.prank(alice);
        nft.approve(carol, id);
        vm.prank(carol);
        vm.expectRevert(bytes("verifier required for third-party move"));
        nft.iTransferFrom(alice, bob, id, noProofs);
    }

    function test_iTransferFrom_WrongFrom_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        nft.iTransferFrom(bob, carol, id, noProofs);
    }

    function test_iTransferFrom_ZeroRecipient_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("zero recipient"));
        nft.iTransferFrom(alice, address(0), id, noProofs);
    }

    // ── Verifier-set path ──────────────────────────────────────────────────────────────────────────

    function test_VerifierSet_EmptyProofs_Revert() public {
        vm.prank(admin);
        nft.setDataVerifier(address(verifier));
        vm.prank(alice);
        vm.expectRevert(bytes("proof required"));
        nft.iTransferFrom(alice, bob, id, noProofs);
    }

    function test_VerifierSet_InvalidProof_Reverts() public {
        vm.prank(admin);
        nft.setDataVerifier(address(verifier));
        verifier.setResult(false);
        vm.prank(alice);
        vm.expectRevert(bytes("invalid proof"));
        nft.iTransferFrom(alice, bob, id, _oneProof());
    }

    function test_VerifierSet_ValidProof_Transfers() public {
        vm.prank(admin);
        nft.setDataVerifier(address(verifier));
        verifier.setResult(true);
        vm.prank(alice);
        nft.iTransferFrom(alice, bob, id, _oneProof());
        assertEq(nft.ownerOf(id), bob);
    }

    /// v1.1 requirement (official pattern): even WITH a verifier and a valid proof, the caller must
    /// still be the owner or ERC-721-authorized — a valid-shaped proof alone must never move a token.
    function test_VerifierSet_StrangerWithValidProof_CannotMove() public {
        vm.prank(admin);
        nft.setDataVerifier(address(verifier));
        verifier.setResult(true);
        vm.prank(carol); // not owner, not approved
        vm.expectRevert();
        nft.iTransferFrom(alice, bob, id, _oneProof());
        assertEq(nft.ownerOf(id), alice);
    }
}
