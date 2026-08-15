// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoleTestBase, ReenteringReceiver, RejectingReceiver} from "./KnoleTestBase.sol";
import {KnoleAgenticID} from "../KnoleAgenticID.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";

contract MintTest is KnoleTestBase {
    function test_iMint_HappyPath() public {
        vm.prank(alice);
        uint256 id = nft.iMint(alice, _data("genesis"));

        assertEq(id, 1, "first token id");
        assertEq(nft.ownerOf(id), alice, "caller-owned");
        assertEq(nft.version(id), 1, "version starts at 1");
        assertGt(nft.updatedAt(id), 0, "updatedAt set");
        IERC7857.IntelligentData[] memory d = nft.getIntelligentDatas(id);
        assertEq(d.length, 1);
        assertEq(d[0].dataHash, keccak256("genesis"));
        assertEq(nft.totalSupply(), 1);
    }

    function test_iMint_EmitsIntelligentDataSet() public {
        IERC7857.IntelligentData[] memory d = _data("emit-check");
        vm.expectEmit(true, false, false, true);
        emit IERC7857.IntelligentDataSet(1, d);
        vm.prank(alice);
        nft.iMint(alice, d);
    }

    function test_iMint_SequentialIds() public {
        assertEq(_mint(alice, "a"), 1);
        assertEq(_mint(bob, "b"), 2);
        assertEq(_mint(alice, "c"), 3);
    }

    function test_iMint_RevertsOnEmptyData() public {
        IERC7857.IntelligentData[] memory empty = new IERC7857.IntelligentData[](0);
        vm.prank(alice);
        vm.expectRevert(bytes("no data"));
        nft.iMint(alice, empty);
    }

    function test_iMint_MultiEntryData() public {
        vm.prank(alice);
        uint256 id = nft.iMint(alice, _dataN("multi", 5));
        assertEq(nft.getIntelligentDatas(id).length, 5);
    }

    function test_iMint_ToRejectingReceiver_RevertsAtomically() public {
        RejectingReceiver r = new RejectingReceiver();
        vm.prank(alice);
        vm.expectRevert();
        nft.iMint(address(r), _data("rejected"));
        assertEq(nft.totalSupply(), 0, "nothing minted");
    }

    function test_iMintWithRole_MinterOk_StrangerReverts() public {
        vm.prank(admin);
        uint256 id = nft.iMintWithRole(bob, _data("server-mint"));
        assertEq(nft.ownerOf(id), bob);
        assertEq(nft.version(id), 1);

        vm.prank(alice);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        nft.iMintWithRole(alice, _data("nope"));
    }

    /// Documents the CEI-ordering gap: during onERC721Received the token exists but its
    /// IntelligentData is still empty and version is 0 — and a reentrant `evolve` from the receiver
    /// is silently overwritten by the outer mint. v1.1 must write state before _safeMint, making the
    /// mid-callback view already consistent (version 1, data set).
    function test_iMint_StateVisibleDuringReceiverCallback() public {
        ReenteringReceiver r = new ReenteringReceiver();
        r.setNft(nft);
        r.setArm(false);
        vm.prank(alice);
        nft.iMint(address(r), _data("cei"));
        assertEq(r.seenVersion(), 1, "version must already be 1 inside the callback (CEI)");
        assertEq(r.seenDataLen(), 1, "data must already be set inside the callback (CEI)");
    }

    function test_iMint_ReenteringEvolveCannotBeSilentlyOverwritten() public {
        ReenteringReceiver r = new ReenteringReceiver();
        r.setNft(nft);
        r.setArm(true);
        vm.prank(alice);
        uint256 id = nft.iMint(address(r), _data("outer"));
        // With CEI ordering the receiver's evolve lands AFTER the mint's writes, so the final state
        // must reflect the evolve (version 2, attacker data) rather than a silent overwrite to v1.
        assertEq(nft.version(id), 2, "reentrant evolve must not be silently erased");
        assertEq(nft.getIntelligentDatas(id)[0].dataHash, keccak256("attacker"));
    }
}

contract MintFeeTest is KnoleTestBase {
    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        nft = new KnoleAgenticID(0.05 ether);
    }

    function test_ExactFeeOk() public {
        vm.prank(alice);
        uint256 id = nft.iMint{value: 0.05 ether}(alice, _data("paid"));
        assertEq(nft.ownerOf(id), alice);
        assertEq(address(nft).balance, 0.05 ether);
    }

    function test_UnderpayReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient mint fee"));
        nft.iMint{value: 0.049 ether}(alice, _data("cheap"));
    }

    function test_OverpayKept_DeliberateChoice() public {
        vm.prank(alice);
        nft.iMint{value: 1 ether}(alice, _data("generous"));
        assertEq(address(nft).balance, 1 ether, "excess kept by design (documented)");
    }

    function test_RoleMintTakesNoFee() public {
        vm.prank(admin);
        nft.iMintWithRole(bob, _data("free-server-mint"));
        assertEq(address(nft).balance, 0);
    }

    function testFuzz_FeeBoundary(uint96 value) public {
        vm.deal(alice, type(uint96).max);
        vm.prank(alice);
        if (value < 0.05 ether) {
            vm.expectRevert(bytes("insufficient mint fee"));
            nft.iMint{value: value}(alice, _data("fuzz"));
        } else {
            uint256 id = nft.iMint{value: value}(alice, _data("fuzz"));
            assertEq(nft.ownerOf(id), alice);
        }
    }
}
