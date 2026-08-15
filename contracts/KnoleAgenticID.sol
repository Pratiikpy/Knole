// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IERC7857.sol";
import "./interfaces/IERC7857Authorize.sol";
import "./interfaces/IERC7857Cloneable.sol";

/// A pluggable verifier for ERC-7857 transfer/clone re-encryption proofs. When set, iTransferFrom /
/// iCloneFrom require a valid TEE (or ZKP) proof that the encrypted data was re-encrypted for the new
/// owner. Left unset until a 0G TEE oracle is wired, in which case only the current owner may move
/// their own token (an owner carrying their memory across their own wallets never needs re-encryption).
interface IERC7857DataVerifier {
    function verifyTransferValidity(
        IERC7857.TransferValidityProof calldata proof,
        address to
    ) external view returns (bool);
}

/**
 * @title KnoleAgenticID — the Knole memory iNFT (ERC-7857 / Agentic ID)
 *
 * A genuine ERC-7857 implementation (not ERC-721 with a rebrand): the token carries the user's
 * evolving memory/persona as ENCRYPTED IntelligentData — a pointer to the AES-256-GCM-encrypted
 * snapshot on 0G Storage (`0g://<root>`) plus the keccak256 hash of that blob. The plaintext is never
 * on-chain and never readable from the token; only a key the user controls can decrypt it.
 *
 * Implements IERC7857 (encrypted data + verifiable transfer), IERC7857Cloneable, and IERC7857Authorize
 * (grant a 0G agent scoped read access without giving up ownership — Knole's portable-identity grant).
 *
 * Ownership is the user's: `iMint` is public + payable, so the USER mints straight from their own
 * wallet (their address is msg.sender AND the owner). No central wallet sits in the ownership path.
 * `evolve` re-points the token at a fresh encrypted snapshot — the living memory — for the owner only.
 */
contract KnoleAgenticID is
    ERC721Enumerable,
    AccessControl,
    ReentrancyGuard,
    Pausable,
    IERC7857,
    IERC7857Authorize,
    IERC7857Cloneable
{
    /// Raw ERC-721 transfers are disabled per the ERC-7857 standard: every ownership change must go
    /// through iTransferFrom so the re-encryption gate and grant-clearing can never be bypassed.
    error ERC7857UseITransferFrom();

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 private _nextTokenId = 1;
    uint256 public mintFee; // 0 by default — minting your own memory should be free (just gas)
    IERC7857DataVerifier public dataVerifier; // optional TEE/ZKP proof verifier for transfers

    // tokenId => encrypted intelligent data (0G Storage root + hash)
    mapping(uint256 => IntelligentData[]) private _intelligentData;
    // tokenId => version + last update (the living-memory history)
    mapping(uint256 => uint64) public version;
    mapping(uint256 => uint64) public updatedAt;
    // tokenId => scoped-usage grants (authorize a 0G agent to use the identity, never own it)
    mapping(uint256 => address[]) private _authorizedUsers;
    mapping(uint256 => mapping(address => bool)) private _isAuthorizedUser;
    // tokenId => source (for clones)
    mapping(uint256 => uint256) public cloneSource;

    event Evolved(uint256 indexed tokenId, bytes32 newDataHash, uint64 version);
    event DataVerifierUpdated(address indexed verifier);

    constructor(uint256 _mintFee) ERC721("Knole Memory", "KNOLE") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        mintFee = _mintFee;
    }

    // ── Minting — the USER mints their own memory to their own wallet ──────────────────────────────

    /// Mint a memory iNFT carrying encrypted IntelligentData. Public + payable: the caller (the user's
    /// wallet) is both minter and owner. This is the primary, self-custodial path.
    function iMint(
        address to,
        IntelligentData[] calldata datas
    ) external payable nonReentrant whenNotPaused returns (uint256 tokenId) {
        require(msg.value >= mintFee, "insufficient mint fee");
        require(datas.length > 0, "no data");
        tokenId = _nextTokenId++;
        // CEI: all token state is written BEFORE _safeMint, so the onERC721Received callback observes
        // a fully-consistent token and nothing it does (e.g. evolve) can be silently overwritten.
        _setIntelligentData(tokenId, datas);
        version[tokenId] = 1;
        updatedAt[tokenId] = uint64(block.timestamp);
        _safeMint(to, tokenId);
    }

    /// Role-gated mint (migration / server-assisted onboarding only). Kept for operability; the app
    /// mints via the public iMint from the user's own wallet.
    function iMintWithRole(
        address to,
        IntelligentData[] calldata datas
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256 tokenId) {
        require(datas.length > 0, "no data");
        tokenId = _nextTokenId++;
        _setIntelligentData(tokenId, datas);
        version[tokenId] = 1;
        updatedAt[tokenId] = uint64(block.timestamp);
        _safeMint(to, tokenId);
    }

    // ── Living memory — re-point the token at a fresh encrypted snapshot (owner only) ──────────────

    function evolve(uint256 tokenId, IntelligentData[] calldata datas) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(datas.length > 0, "no data");
        _setIntelligentData(tokenId, datas);
        version[tokenId] += 1;
        updatedAt[tokenId] = uint64(block.timestamp);
        // Evolved carries the first entry's hash as the headline; the full array is in the
        // IntelligentDataSet event _setIntelligentData just emitted.
        emit Evolved(tokenId, datas[0].dataHash, version[tokenId]);
    }

    // ── ERC-7857: encrypted intelligent data + verifiable transfer ─────────────────────────────────

    function getIntelligentDatas(
        uint256 tokenId
    ) external view override returns (IntelligentData[] memory) {
        require(_ownerOf(tokenId) != address(0), "nonexistent token");
        return _intelligentData[tokenId];
    }

    /// Production-interface alias (0G AgentNFT names it `intelligentDatasOf`).
    function intelligentDatasOf(
        uint256 tokenId
    ) external view returns (IntelligentData[] memory) {
        require(_ownerOf(tokenId) != address(0), "nonexistent token");
        return _intelligentData[tokenId];
    }

    /// The configured re-encryption proof verifier (address(0) until a 0G TEE oracle is wired).
    function verifier() external view returns (IERC7857DataVerifier) {
        return dataVerifier;
    }

    /// Transfer the token AND re-encrypt its data for the new owner. If a dataVerifier is configured,
    /// every proof must verify (the re-encryption happened correctly in a TEE/ZKP oracle); otherwise
    /// only the owner may move their own token to another of their wallets (no re-encryption needed).
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external override nonReentrant whenNotPaused {
        require(ownerOf(tokenId) == from, "not owner");
        require(to != address(0), "zero recipient");
        // Standard ERC-721 authorization ALWAYS applies — a valid-shaped proof alone must never be
        // enough to move a token (official 0G pattern).
        _checkAuthorized(from, msg.sender, tokenId);
        _checkMoveAuth(from, tokenId, proofs, to);
        _transfer(from, to, tokenId); // grants are cleared inside _update — no path can bypass it
        emit IntelligentTransfer(from, to, tokenId);
    }

    function iCloneFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external override nonReentrant whenNotPaused returns (uint256 newTokenId) {
        require(ownerOf(tokenId) == from, "not owner");
        require(to != address(0), "zero recipient");
        _checkAuthorized(from, msg.sender, tokenId);
        _checkMoveAuth(from, tokenId, proofs, to);
        newTokenId = _nextTokenId++;
        // CEI: clone state written before _safeMint (see iMint).
        _copyIntelligentData(tokenId, newTokenId);
        version[newTokenId] = 1;
        updatedAt[newTokenId] = uint64(block.timestamp);
        cloneSource[newTokenId] = tokenId;
        _safeMint(to, newTokenId);
        emit IntelligentClone(from, to, tokenId, newTokenId);
    }

    // ── Raw ERC-721 transfers are closed (ERC-7857): every move goes through iTransferFrom ─────────

    function transferFrom(address, address, uint256) public pure override(ERC721, IERC721) {
        revert ERC7857UseITransferFrom();
    }

    function safeTransferFrom(
        address,
        address,
        uint256,
        bytes memory
    ) public pure override(ERC721, IERC721) {
        revert ERC7857UseITransferFrom();
    }

    // ── ERC-7857 Authorize: grant a 0G agent scoped usage without giving up ownership ──────────────

    function authorizeUsage(uint256 tokenId, address user) external override whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(user != address(0), "zero user");
        require(!_isAuthorizedUser[tokenId][user], "already authorized");
        require(_authorizedUsers[tokenId].length < 100, "max authorizations");
        _authorizedUsers[tokenId].push(user);
        _isAuthorizedUser[tokenId][user] = true;
        emit UsageAuthorized(tokenId, user);
    }

    function revokeAuthorization(uint256 tokenId, address user) external override {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(_isAuthorizedUser[tokenId][user], "not authorized");
        _isAuthorizedUser[tokenId][user] = false;
        address[] storage users = _authorizedUsers[tokenId];
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == user) {
                users[i] = users[users.length - 1];
                users.pop();
                break;
            }
        }
        emit UsageRevoked(tokenId, user);
    }

    function isAuthorizedUser(
        uint256 tokenId,
        address user
    ) external view override returns (bool) {
        return _isAuthorizedUser[tokenId][user];
    }

    function authorizedUsersOf(
        uint256 tokenId
    ) external view override returns (address[] memory) {
        return _authorizedUsers[tokenId];
    }

    function batchAuthorizeUsage(
        uint256[] calldata tokenIds,
        address user
    ) external override whenNotPaused {
        require(user != address(0), "zero user");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(ownerOf(tokenIds[i]) == msg.sender, "not owner");
            if (!_isAuthorizedUser[tokenIds[i]][user]) {
                require(_authorizedUsers[tokenIds[i]].length < 100, "max authorizations");
                _authorizedUsers[tokenIds[i]].push(user);
                _isAuthorizedUser[tokenIds[i]][user] = true;
                emit UsageAuthorized(tokenIds[i], user);
            }
        }
    }

    // ── Admin ──────────────────────────────────────────────────────────────────────────────────────

    function setDataVerifier(address _verifier) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dataVerifier = IERC7857DataVerifier(_verifier);
        emit DataVerifierUpdated(_verifier);
    }

    function setMintFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintFee = newFee;
    }

    function withdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        // sendValue, not transfer: the 2300-gas stipend would brick withdrawal to a Safe admin.
        Address.sendValue(payable(msg.sender), address(this).balance);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ── Internal ────────────────────────────────────────────────────────────────────────────────────

    function _setIntelligentData(uint256 tokenId, IntelligentData[] calldata datas) internal {
        delete _intelligentData[tokenId];
        for (uint256 i = 0; i < datas.length; i++) _intelligentData[tokenId].push(datas[i]);
        emit IntelligentDataSet(tokenId, datas);
    }

    /// Copy a source token's data to a clone, emitting IntelligentDataSet so indexers see the clone's
    /// data exactly like a minted token's (v1.0 pushed raw and emitted nothing — clones were blind).
    function _copyIntelligentData(uint256 fromTokenId, uint256 toTokenId) internal {
        IntelligentData[] storage src = _intelligentData[fromTokenId];
        IntelligentData[] memory copied = new IntelligentData[](src.length);
        for (uint256 i = 0; i < src.length; i++) {
            _intelligentData[toTokenId].push(src[i]);
            copied[i] = src[i];
        }
        emit IntelligentDataSet(toTokenId, copied);
    }

    function _checkMoveAuth(
        address from,
        uint256 /* tokenId */,
        TransferValidityProof[] calldata proofs,
        address to
    ) internal view {
        if (address(dataVerifier) != address(0)) {
            require(proofs.length > 0, "proof required");
            for (uint256 i = 0; i < proofs.length; i++) {
                require(dataVerifier.verifyTransferValidity(proofs[i], to), "invalid proof");
            }
        } else {
            // No oracle wired yet: only the owner may move their OWN token (no re-encryption needed
            // when the data stays under the same person's key across their own wallets).
            require(msg.sender == from, "verifier required for third-party move");
        }
    }

    function _clearAuthorizations(uint256 tokenId) internal {
        address[] storage users = _authorizedUsers[tokenId];
        for (uint256 i = 0; i < users.length; i++) _isAuthorizedUser[tokenId][users[i]] = false;
        delete _authorizedUsers[tokenId];
    }

    // OZ 5.x plumbing for ERC721Enumerable + AccessControl — and the grant-clearing choke point:
    // EVERY ownership change passes through _update, so usage grants are cleared here (official 0G
    // pattern) and no transfer path — iTransferFrom or otherwise — can carry grants to a new owner.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721Enumerable) returns (address) {
        if (_ownerOf(tokenId) != address(0)) _clearAuthorizations(tokenId); // transfer, not mint
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Enumerable, AccessControl) returns (bool) {
        return
            interfaceId == type(IERC7857).interfaceId ||
            interfaceId == type(IERC7857Authorize).interfaceId ||
            interfaceId == type(IERC7857Cloneable).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
