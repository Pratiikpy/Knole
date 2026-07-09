// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IERC7857.sol";

/**
 * @title IERC7857Cloneable - Cloning extension for ERC-7857
 * @notice Allows duplicating an NFT's intelligent data to a new token
 *         for a different owner, with proof verification.
 */
interface IERC7857Cloneable is IERC7857 {
    event IntelligentClone(
        address indexed from,
        address indexed to,
        uint256 indexed sourceTokenId,
        uint256 newTokenId
    );

    function iCloneFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external returns (uint256);
}
