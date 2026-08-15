// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {KnoleAgenticID, IERC7857DataVerifier} from "../KnoleAgenticID.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";
import {IERC7857Authorize} from "../interfaces/IERC7857Authorize.sol";
import {IERC7857Cloneable} from "../interfaces/IERC7857Cloneable.sol";

/// A verifier double whose verdict is set per-test: `setResult(false)` makes every proof invalid,
/// `setResult(true)` makes every proof valid. Mirrors the shape the contract calls, nothing more.
contract MockVerifier is IERC7857DataVerifier {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verifyTransferValidity(
        IERC7857.TransferValidityProof calldata,
        address
    ) external view returns (bool) {
        return result;
    }
}

/// An ERC721 receiver that accepts tokens — and, when armed, re-enters `evolve` from inside
/// onERC721Received to document the state-after-_safeMint ordering bug.
contract ReenteringReceiver {
    KnoleAgenticID public nft;
    bool public arm;
    uint256 public seenVersion;
    uint256 public seenDataLen;

    function setNft(KnoleAgenticID n) external {
        nft = n;
    }

    function setArm(bool a) external {
        arm = a;
    }

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        seenVersion = nft.version(tokenId);
        seenDataLen = nft.getIntelligentDatas(tokenId).length;
        if (arm) {
            IERC7857.IntelligentData[] memory d = new IERC7857.IntelligentData[](1);
            d[0] = IERC7857.IntelligentData("0g://attacker", keccak256("attacker"));
            nft.evolve(tokenId, d);
        }
        return this.onERC721Received.selector;
    }
}

/// A receiver that rejects every token, for atomic-revert tests.
contract RejectingReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

abstract contract KnoleTestBase is Test {
    KnoleAgenticID internal nft;
    MockVerifier internal verifier;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    IERC7857.TransferValidityProof[] internal noProofs;

    function setUp() public virtual {
        vm.prank(admin);
        nft = new KnoleAgenticID(0);
        verifier = new MockVerifier();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    /// One-element IntelligentData[] with a deterministic hash derived from the seed.
    function _data(string memory seed) internal pure returns (IERC7857.IntelligentData[] memory d) {
        d = new IERC7857.IntelligentData[](1);
        d[0] = IERC7857.IntelligentData(
            string.concat("0g://", seed),
            keccak256(bytes(seed))
        );
    }

    function _dataN(string memory seed, uint256 n) internal pure returns (IERC7857.IntelligentData[] memory d) {
        d = new IERC7857.IntelligentData[](n);
        for (uint256 i = 0; i < n; i++) {
            string memory s = string.concat(seed, "-", vm.toString(i));
            d[i] = IERC7857.IntelligentData(string.concat("0g://", s), keccak256(bytes(s)));
        }
    }

    function _mint(address to, string memory seed) internal returns (uint256 id) {
        vm.prank(to);
        id = nft.iMint(to, _data(seed));
    }

    function _oneProof() internal pure returns (IERC7857.TransferValidityProof[] memory p) {
        p = new IERC7857.TransferValidityProof[](1);
        p[0] = IERC7857.TransferValidityProof(
            IERC7857.AccessProof(hex"01", hex"02"),
            IERC7857.OwnershipProof(hex"03", hex"04", 1)
        );
    }
}
