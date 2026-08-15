// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title JournalDayAnchor — the on-chain proof-of-journaling day counter
 *
 * One idempotent counter per wallet: it increments AT MOST once per UTC day, when the anchoring
 * signer attests that this user wrote a qualifying journal entry (a real reflection ran — the
 * anti-cheat verdict lives off-chain in the anchoring pipeline; this contract only records the
 * per-day fact). Contracts can READ it — which Knole's calldata-only anchors never allowed — so
 * commitment escrows (KnoleCommitment) can settle "N journaled days in a window" trustlessly from
 * count deltas.
 *
 * Day boundary is UTC (`block.timestamp / 1 days`), and MUST stay identical to the boundary used by
 * any contract that settles against these counts.
 */
contract JournalDayAnchor is AccessControl {
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");

    // user => total distinct UTC days journaled
    mapping(address => uint32) public journaledDayCount;
    // user => (last recorded day index + 1); +1 so day 0 is distinguishable from "never"
    mapping(address => uint64) private _lastDayPlus1;

    event DayJournaled(address indexed user, uint64 indexed day, uint32 newCount);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ANCHOR_ROLE, msg.sender);
    }

    function currentDay() public view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    /// Record that `user` journaled today. Idempotent: a second call the same UTC day is a no-op,
    /// so the anchoring pipeline can call it on every entry save without over-counting.
    function recordDay(address user) external onlyRole(ANCHOR_ROLE) {
        require(user != address(0), "zero user");
        uint64 day = currentDay();
        if (_lastDayPlus1[user] == day + 1) return; // already recorded today
        _lastDayPlus1[user] = day + 1;
        uint32 count = ++journaledDayCount[user];
        emit DayJournaled(user, day, count);
    }

    /// Batch form for the daily anchoring sweep.
    function recordDays(address[] calldata users) external onlyRole(ANCHOR_ROLE) {
        uint64 day = currentDay();
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            if (user == address(0) || _lastDayPlus1[user] == day + 1) continue;
            _lastDayPlus1[user] = day + 1;
            emit DayJournaled(user, day, ++journaledDayCount[user]);
        }
    }

    function lastJournaledDay(address user) external view returns (bool ever, uint64 day) {
        uint64 stored = _lastDayPlus1[user];
        return stored == 0 ? (false, 0) : (true, stored - 1);
    }

    function hasJournaledToday(address user) external view returns (bool) {
        return _lastDayPlus1[user] == currentDay() + 1;
    }
}
