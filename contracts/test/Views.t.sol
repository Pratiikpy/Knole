// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoleTestBase} from "./KnoleTestBase.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";
import {IERC7857Authorize} from "../interfaces/IERC7857Authorize.sol";
import {IERC7857Cloneable} from "../interfaces/IERC7857Cloneable.sol";

contract ViewsTest is KnoleTestBase {
    function test_GetterParity() public {
        uint256 id = _mint(alice, "parity");
        IERC7857.IntelligentData[] memory a = nft.getIntelligentDatas(id);
        IERC7857.IntelligentData[] memory b = nft.intelligentDatasOf(id);
        assertEq(a.length, b.length);
        assertEq(a[0].dataHash, b[0].dataHash);
        assertEq(a[0].dataDescription, b[0].dataDescription);
    }

    function test_Getters_NonexistentToken_Revert() public {
        vm.expectRevert(bytes("nonexistent token"));
        nft.getIntelligentDatas(999);
        vm.expectRevert(bytes("nonexistent token"));
        nft.intelligentDatasOf(999);
    }

    /// Pins the exact interface ids the live /verify page checks on-chain — if an interface ever
    /// drifts, this fails before the marketing claim can go stale.
    function test_SupportsInterface_WellKnownIds() public view {
        assertEq(type(IERC7857).interfaceId, bytes4(0x4b396f04), "IERC7857 id drifted");
        assertEq(type(IERC7857Authorize).interfaceId, bytes4(0x35d39512), "Authorize id drifted");
        assertEq(type(IERC7857Cloneable).interfaceId, bytes4(0xd79f01c7), "Cloneable id drifted");

        assertTrue(nft.supportsInterface(0x4b396f04), "ERC-7857");
        assertTrue(nft.supportsInterface(0x35d39512), "ERC-7857 Authorize");
        assertTrue(nft.supportsInterface(0xd79f01c7), "ERC-7857 Cloneable");
        assertTrue(nft.supportsInterface(0x80ac58cd), "ERC-721");
        assertTrue(nft.supportsInterface(0x780e9d63), "ERC-721 Enumerable");
        assertTrue(nft.supportsInterface(0x7965db0b), "AccessControl");
        assertTrue(nft.supportsInterface(0x01ffc9a7), "ERC-165");
        assertFalse(nft.supportsInterface(0xdeadbeef), "control id must be false");
    }

    function test_Verifier_DefaultZero() public view {
        assertEq(address(nft.verifier()), address(0));
    }

    function test_NameSymbol() public view {
        assertEq(nft.name(), "Knole Memory");
        assertEq(nft.symbol(), "KNOLE");
    }
}
