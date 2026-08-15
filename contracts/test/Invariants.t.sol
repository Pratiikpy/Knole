// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {KnoleAgenticID} from "../KnoleAgenticID.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";

/// Multi-actor handler: performs random valid sequences of every user action while keeping ghost
/// accounting that the invariants check against. Transfers assert grant-clearing inline, so the
/// property is checked after EVERY ownership change the fuzzer finds, not just crafted ones.
contract Handler is Test {
    KnoleAgenticID public nft;
    address public admin;
    address[3] public actors;

    uint256 public ghostMints;
    uint256 public ghostClones;
    uint256 public ghostFees;
    uint256 public ghostWithdrawn;
    uint256 internal nonce;

    IERC7857.TransferValidityProof[] internal noProofs;

    constructor(KnoleAgenticID _nft, address _admin) {
        nft = _nft;
        admin = _admin;
        actors[0] = makeAddr("actor0");
        actors[1] = makeAddr("actor1");
        actors[2] = makeAddr("actor2");
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 3];
    }

    function _existingToken(uint256 seed) internal view returns (uint256) {
        uint256 supply = nft.totalSupply();
        return supply == 0 ? 0 : (seed % supply) + 1;
    }

    function _data(string memory tag) internal returns (IERC7857.IntelligentData[] memory d) {
        nonce++;
        string memory s = string.concat(tag, "-", vm.toString(nonce));
        d = new IERC7857.IntelligentData[](1);
        d[0] = IERC7857.IntelligentData(string.concat("0g://", s), keccak256(bytes(s)));
    }

    function mint(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        uint256 fee = nft.mintFee();
        vm.deal(a, fee);
        vm.prank(a);
        nft.iMint{value: fee}(a, _data("mint"));
        ghostMints++;
        ghostFees += fee;
    }

    function evolve(uint256 tokenSeed) external {
        uint256 id = _existingToken(tokenSeed);
        if (id == 0) return;
        address owner = nft.ownerOf(id);
        vm.prank(owner);
        nft.evolve(id, _data("evolve"));
    }

    function authorize(uint256 tokenSeed, uint256 userSeed) external {
        uint256 id = _existingToken(tokenSeed);
        if (id == 0) return;
        address owner = nft.ownerOf(id);
        address user = _actor(userSeed);
        if (nft.isAuthorizedUser(id, user) || nft.authorizedUsersOf(id).length >= 100) return;
        vm.prank(owner);
        nft.authorizeUsage(id, user);
    }

    function revoke(uint256 tokenSeed) external {
        uint256 id = _existingToken(tokenSeed);
        if (id == 0) return;
        address[] memory users = nft.authorizedUsersOf(id);
        if (users.length == 0) return;
        vm.prank(nft.ownerOf(id));
        nft.revokeAuthorization(id, users[0]);
    }

    function transferOwn(uint256 tokenSeed, uint256 toSeed) external {
        uint256 id = _existingToken(tokenSeed);
        if (id == 0) return;
        address owner = nft.ownerOf(id);
        address to = _actor(toSeed);
        vm.prank(owner);
        nft.iTransferFrom(owner, to, id, noProofs);
        // The load-bearing property: EVERY ownership change strips usage grants.
        assertEq(nft.authorizedUsersOf(id).length, 0, "grants must clear on transfer");
        assertEq(nft.ownerOf(id), to);
    }

    function clone(uint256 tokenSeed, uint256 toSeed) external {
        uint256 id = _existingToken(tokenSeed);
        if (id == 0) return;
        address owner = nft.ownerOf(id);
        vm.prank(owner);
        uint256 newId = nft.iCloneFrom(owner, _actor(toSeed), id, noProofs);
        ghostClones++;
        assertEq(nft.authorizedUsersOf(newId).length, 0, "clones never inherit grants");
    }

    function withdraw() external {
        ghostWithdrawn += address(nft).balance;
        vm.prank(admin);
        nft.withdraw();
    }
}

contract InvariantsTest is Test {
    KnoleAgenticID internal nft;
    Handler internal handler;
    address internal admin = makeAddr("admin");

    function setUp() public {
        vm.prank(admin);
        nft = new KnoleAgenticID(0.01 ether);
        handler = new Handler(nft, admin);
        targetContract(address(handler));
    }

    /// Every existing token is fully-formed: version >= 1 and at least one IntelligentData entry.
    function invariant_TokenIntegrity() public view {
        uint256 supply = nft.totalSupply();
        for (uint256 id = 1; id <= supply; id++) {
            assertGe(nft.version(id), 1);
            assertGe(nft.getIntelligentDatas(id).length, 1);
        }
    }

    /// No burn path exists, so supply is exactly mints + clones and ids are densely sequential.
    function invariant_SupplyAccounting() public {
        uint256 supply = nft.totalSupply();
        assertEq(supply, handler.ghostMints() + handler.ghostClones());
        if (supply > 0) nft.ownerOf(supply); // last id exists
        vm.expectRevert();
        nft.ownerOf(supply + 1); // next id does not
    }

    /// The contract can never hold less than fees-in minus fees-withdrawn (exact, no other inflows).
    function invariant_Solvency() public view {
        assertEq(address(nft).balance, handler.ghostFees() - handler.ghostWithdrawn());
    }

    /// Grant sets stay consistent: capped, and every listed user maps back to true.
    function invariant_GrantSetConsistency() public view {
        uint256 supply = nft.totalSupply();
        for (uint256 id = 1; id <= supply; id++) {
            address[] memory users = nft.authorizedUsersOf(id);
            assertLe(users.length, 100);
            for (uint256 i = 0; i < users.length; i++) {
                assertTrue(nft.isAuthorizedUser(id, users[i]));
            }
        }
    }

    /// Clone lineage points strictly backwards: a clone's source always predates it.
    function invariant_CloneLineage() public view {
        uint256 supply = nft.totalSupply();
        for (uint256 id = 1; id <= supply; id++) {
            uint256 src = nft.cloneSource(id);
            if (src != 0) assertLt(src, id);
        }
    }
}
