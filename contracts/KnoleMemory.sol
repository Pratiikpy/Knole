// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * KnoleMemory — an ERC-7857-spirit "intelligent NFT" (iNFT) on the 0G chain.
 *
 * The user mints their evolving Knole memory/persona as a token they OWN. The token records a
 * pointer to the ENCRYPTED memory snapshot stored on 0G Storage (the merkle root) plus a hash of the
 * plaintext — the data itself is never on-chain and never readable from the token.
 *
 * Deliberately the *minimal* subset of ERC-7857: mint + evolve, NO transfer-oracle. The full
 * standard's TEE/ZKP machinery exists only to re-encrypt private data to a NEW owner on a sale —
 * Knole's whole thesis is "memory is sacred, not for sale," so that machinery is intentionally
 * absent. That omission IS the product statement:
 *   - approve / setApprovalForAll REVERT  → no marketplace can ever list it.
 *   - direct owner-initiated transfer stays enabled → you can carry it across your OWN wallets.
 *
 * "Only you can read it" is enforced off-chain: the snapshot is encrypted under a key derived from
 * the user's own secret; the token holds only the encrypted root + a hash.
 */
contract KnoleMemory is ERC721, Ownable {
    struct Memory {
        string encryptedURI; // e.g. "0g://<root>" — location of the encrypted snapshot on 0G Storage
        bytes32 dataRoot; // the 0G Storage merkle root of the encrypted blob
        bytes32 metadataHash; // keccak256 of the plaintext snapshot (integrity, not readable)
        uint64 version; // bumps every evolve()
        uint64 updatedAt; // last evolve timestamp
    }

    mapping(uint256 => Memory) public memories;
    uint256 public nextId = 1;

    event Minted(address indexed owner, uint256 indexed tokenId, bytes32 dataRoot);
    event Evolved(uint256 indexed tokenId, bytes32 newRoot, uint64 version);

    // The deployer (Knole's server signer) mints on the user's behalf, straight to the user's wallet.
    constructor() ERC721("Knole Memory", "KNOLE") Ownable(msg.sender) {}

    /// Mint a new memory iNFT to `to`. Owner-authorized only — no oracle, no proof (self-custody).
    function mint(
        address to,
        string calldata encryptedURI,
        bytes32 dataRoot,
        bytes32 metadataHash
    ) external onlyOwner returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
        memories[id] = Memory(encryptedURI, dataRoot, metadataHash, 1, uint64(block.timestamp));
        emit Minted(to, id, dataRoot);
    }

    /// Evolve the memory in place — re-point the token at a fresh encrypted snapshot. Owner only.
    function evolve(
        uint256 tokenId,
        string calldata newURI,
        bytes32 newRoot,
        bytes32 newHash
    ) external {
        require(ownerOf(tokenId) == msg.sender || owner() == msg.sender, "not owner");
        Memory storage m = memories[tokenId];
        m.encryptedURI = newURI;
        m.dataRoot = newRoot;
        m.metadataHash = newHash;
        m.version += 1;
        m.updatedAt = uint64(block.timestamp);
        emit Evolved(tokenId, newRoot, m.version);
    }

    // ── "Memory is sacred, not for sale" — no marketplace can list it. ──
    function approve(address, uint256) public pure override {
        revert("Knole memory is not for sale");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("Knole memory is not for sale");
    }
}
