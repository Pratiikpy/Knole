// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KnoleCommitment} from "../KnoleCommitment.sol";

/// Mirrors the real anchor, including the property that matters most: the day list is APPEND-ONLY.
/// History cannot be rewritten, so a test can't accidentally prove something the deployed contract
/// wouldn't do.
contract MockAnchor2 {
    mapping(address => uint32) public journaledDayCount;
    mapping(address => uint64[]) private _days;
    mapping(address => uint32) private _rawOverride;

    /// Journal `n` days ending today (used for setup, before any deadline has passed).
    function setCount(address user, uint32 n) external {
        delete _days[user];
        journaledDayCount[user] = n;
        uint64 today = uint64(block.timestamp / 1 days);
        for (uint64 i = 0; i < n; i++) _days[user].push(today - (uint64(n) - 1 - i));
    }

    /// Journal `n` more days, starting the day AFTER the last one recorded — the only thing the
    /// real anchor can do.
    function journalMore(address user, uint32 n) external {
        uint64[] storage ds = _days[user];
        uint64 today = uint64(block.timestamp / 1 days);
        uint64 last = ds.length == 0 ? 0 : ds[ds.length - 1];
        // Only ever forward, and never before today: the real anchor can only record the day it is
        // called on, so back-filling would let a test prove something impossible.
        uint64 next = last + 1 > today ? last + 1 : today;
        for (uint64 i = 0; i < n; i++) ds.push(next + i);
        journaledDayCount[user] += n;
    }

    /// Force the LIVE cumulative counter only (for overflow probing); leaves history untouched.
    function setRawCount(address user, uint32 n) external {
        journaledDayCount[user] = n;
    }

    function countAtDay(address user, uint64 day) external view returns (uint32) {
        uint64[] storage ds = _days[user];
        uint256 lo = 0;
        uint256 hi = ds.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (ds[mid] <= day) lo = mid + 1;
            else hi = mid;
        }
        return uint32(lo);
    }
}

contract RevertingCharity {
    receive() external payable {
        revert("no");
    }
}

/// Regressions for the production audit's findings on the money contract. Each test fails against
/// the pre-audit contract and passes now.
contract CommitmentAuditTest is Test {
    KnoleCommitment cmt;
    MockAnchor2 anchor;
    address charity = address(0xC4A217);
    address alice = address(0xA11CE);
    address griefer = address(0x61217);

    function setUp() public {
        // Foundry starts at timestamp 1 (UTC day 0); warp to a realistic clock so day arithmetic
        // in the mock anchor can look backwards without underflowing.
        vm.warp(1000 days);
        anchor = new MockAnchor2();
        cmt = new KnoleCommitment(address(anchor), charity);
        vm.deal(alice, 200 ether);
        vm.deal(griefer, 1 ether);
    }

    function _commit(uint256 stake, uint32 goal, uint32 window) internal returns (uint256) {
        vm.prank(alice);
        return cmt.commit{value: stake}(goal, window, KnoleCommitment.Dest.Burn);
    }

    /// FINDING 1a — the deadline had no teeth: days journaled long after the window closed still
    /// counted toward the goal, so a "30 days in 30" commitment could be released a year late.
    function test_DaysAfterWindowDoNotCount() public {
        uint256 id = _commit(10 ether, 30, 30);
        vm.warp(block.timestamp + 400 days); // window long gone, nothing journaled inside it
        anchor.setCount(alice, 30); // 30 days, all of them AFTER the deadline
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.GoalNotReached.selector);
        cmt.release(id);
    }

    /// FINDING 1b — the outcome must not depend on WHO calls first. A griefer settling and the
    /// staker settling now produce the same number, because the count is frozen at the deadline.
    function test_StrangerCannotChangeTheOutcome() public {
        uint256 id = _commit(10 ether, 30, 30);
        anchor.setCount(alice, 25); // 25 of 30 by the deadline
        vm.warp(block.timestamp + 30 days + 1);
        vm.warp(block.timestamp + 1 days); // past the final counted day

        // The staker keeps journaling afterwards; it cannot rescue the missed window any more...
        anchor.journalMore(alice, 15);
        vm.warp(block.timestamp + 48 hours + 1);
        uint256 before = alice.balance;
        vm.prank(griefer);
        cmt.settle(id);
        uint256 refund = alice.balance - before;
        uint256 staked = 10 ether;
        assertEq(refund, (staked * 25) / 30, "refund must be the frozen 25/30");

        // ...and a stranger cannot make it worse than that either: the same value is fixed.
        assertEq(cmt.achievedDays(id), 25);
    }

    /// Once the window has closed the number is fixed forever, no matter how much is journaled
    /// afterwards and no matter when anyone reads it.
    function test_AchievedIsFixedAfterTheDeadline() public {
        uint256 id = _commit(1 ether, 10, 10);
        anchor.setCount(alice, 4);
        vm.warp(block.timestamp + 10 days + 1);
        assertEq(cmt.achievedDays(id), 4);
        vm.warp(block.timestamp + 1 days); // unambiguously past the final counted day
        anchor.journalMore(alice, 95); // journals a lot, far too late
        assertEq(cmt.achievedDays(id), 4, "the window is over; late days never count");
        vm.warp(block.timestamp + 365 days);
        assertEq(cmt.achievedDays(id), 4, "still fixed a year on");
    }

    /// Mid-window release still works the moment the goal is genuinely hit.
    function test_MidWindowReleaseStillInstant() public {
        uint256 id = _commit(5 ether, 5, 30);
        anchor.setCount(alice, 5);
        uint256 before = alice.balance;
        vm.prank(alice);
        cmt.release(id);
        assertEq(alice.balance - before, 5 ether);
    }

    /// FINDING 7 — settle() on an id that was never created used to succeed and emit a phantom
    /// Released event that any indexer would ingest as real.
    function test_SettleUncreatedIdReverts() public {
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.settle(999_999);
    }

    /// FINDING 10 — a payout destination that reverts must not brick settlement and strand the
    /// staker's own refund.
    function test_RevertingCharityCannotBrickSettlement() public {
        RevertingCharity bad = new RevertingCharity();
        KnoleCommitment c2 = new KnoleCommitment(address(anchor), address(bad));
        vm.prank(alice);
        uint256 id = c2.commit{value: 10 ether}(30, 30, KnoleCommitment.Dest.Charity);
        anchor.setCount(alice, 3);
        vm.warp(block.timestamp + 30 days + 48 hours + 2);
        uint256 before = alice.balance;
        vm.prank(griefer);
        c2.settle(id); // must not revert
        uint256 staked2 = 10 ether;
        assertEq(alice.balance - before, (staked2 * 3) / 30, "staker still gets their partial");
        assertEq(address(c2).balance, 0, "forfeit fell back to burn, nothing stranded");
    }

    /// FINDING 13 — once the pipeline is declared broken, the contract must stop taking money for
    /// a promise it can no longer keep.
    function test_NoNewCommitmentsAfterUserFavor() public {
        cmt.enableUserFavor();
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.commit{value: 1 ether}(10, 10, KnoleCommitment.Dest.Burn);
    }

    /// userFavor still rescues everything already staked.
    function test_UserFavorStillRefundsActiveCommitments() public {
        uint256 id = _commit(3 ether, 30, 30);
        cmt.enableUserFavor();
        uint256 before = alice.balance;
        vm.prank(alice);
        cmt.release(id);
        assertEq(alice.balance - before, 3 ether);
    }

    /// FINDING 11 — a saturated anchor count used to panic in uint32 and lock the stake forever.
    function test_SaturatedAnchorCountCannotBrickExit() public {
        uint256 id = _commit(1 ether, 10, 10);
        anchor.setRawCount(alice, type(uint32).max); // absurd live count
        uint256 before = alice.balance;
        vm.prank(alice);
        cmt.release(id); // mid-window, goal comfortably met; must not panic
        assertEq(alice.balance - before, 1 ether);

        // And after the deadline the historical read governs, so a saturated live counter cannot
        // reach the settlement math at all.
        uint256 id2 = _commit(1 ether, 10, 10);
        vm.warp(block.timestamp + 10 days + 48 hours + 2);
        vm.prank(griefer);
        cmt.settle(id2);
        assertEq(cmt.achievedDays(id2), 0);
    }

    /// Solvency: no exit path can ever pay out more than was staked.
    function testFuzz_NeverPaysMoreThanStaked(uint96 stake, uint32 goal, uint32 achieved) public {
        stake = uint96(bound(stake, 0.05 ether, 100 ether));
        goal = uint32(bound(goal, 3, 100));
        achieved = uint32(bound(achieved, 0, 200));
        vm.deal(alice, uint256(stake) + 1 ether);
        vm.prank(alice);
        uint256 id = cmt.commit{value: stake}(goal, 120, KnoleCommitment.Dest.Burn);
        anchor.setCount(alice, achieved);
        vm.warp(block.timestamp + 120 days + 48 hours + 2);
        uint256 contractBefore = address(cmt).balance;
        vm.prank(griefer);
        cmt.settle(id);
        assertLe(contractBefore - address(cmt).balance, stake, "never more than the stake leaves");
    }
}
