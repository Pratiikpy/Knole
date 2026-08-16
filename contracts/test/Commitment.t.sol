// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KnoleCommitment} from "../KnoleCommitment.sol";

contract MockAnchor {
    mapping(address => uint32) public journaledDayCount;
    mapping(address => uint64[]) private _days;

    /// n journaling days ending today, matching the real anchor's ascending, append-only shape.
    /// The written history is bounded (a real user cannot have journaled more days than have
    /// elapsed, and fuzzers hand us absurd counts) while the cumulative counter keeps the raw n.
    function setCount(address user, uint32 n) external {
        delete _days[user];
        uint64 today = uint64(block.timestamp / 1 days);
        uint64 m = n;
        // A user cannot have journaled more days than have elapsed; the cumulative counter and the
        // day list must agree, exactly as they do in the deployed anchor.
        if (m > today) m = today;
        journaledDayCount[user] = uint32(m);
        for (uint64 i = 0; i < m; i++) _days[user].push(today - (m - 1 - i));
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

contract CommitmentTest is Test {
    KnoleCommitment cmt;
    MockAnchor anchor;
    address charity = address(0xC4A217);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address stranger = address(0x51);

    function setUp() public {
        // A realistic clock: day arithmetic in the mock anchor looks backwards from "today".
        vm.warp(1000 days);
        anchor = new MockAnchor();
        cmt = new KnoleCommitment(address(anchor), charity);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(stranger, 1 ether);
    }

    function _commit(address who, uint256 stake, uint32 goal, uint32 window) internal returns (uint256) {
        vm.prank(who);
        return cmt.commit{value: stake}(goal, window, KnoleCommitment.Dest.Burn);
    }

    // ── creation guards ──

    function test_RejectsBadParams() public {
        vm.startPrank(alice);
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.commit{value: 0.01 ether}(7, 10, KnoleCommitment.Dest.Burn); // below min stake
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.commit{value: 1 ether}(2, 10, KnoleCommitment.Dest.Burn); // goal below min
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.commit{value: 1 ether}(10, 7, KnoleCommitment.Dest.Burn); // window < goal
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.commit{value: 1 ether}(7, 200, KnoleCommitment.Dest.Burn); // window too long
        vm.stopPrank();
    }

    function test_RejectsPlainTransfers() public {
        vm.prank(alice);
        (bool ok,) = address(cmt).call{value: 1 ether}("");
        assertFalse(ok, "plain ETH must be refused");
    }

    // ── cooling off ──

    function test_CoolingOffFullRefund() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        uint256 before = alice.balance;
        vm.warp(block.timestamp + 23 hours);
        vm.prank(alice);
        cmt.coolOff(id);
        assertEq(alice.balance, before + 1 ether, "full refund in cooling-off");
    }

    function test_CoolingOffExpires() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.CoolingOffOver.selector);
        cmt.coolOff(id);
    }

    function test_CoolOffOnlyStaker() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        vm.prank(bob);
        vm.expectRevert(KnoleCommitment.NotStaker.selector);
        cmt.coolOff(id);
    }

    // ── instant release ──

    function test_InstantReleaseTheMomentGoalHits() public {
        anchor.setCount(alice, 10);
        uint256 id = _commit(alice, 2 ether, 7, 30);
        anchor.setCount(alice, 17); // +7 = goal, mid-window
        uint256 before = alice.balance;
        vm.prank(alice);
        cmt.release(id);
        assertEq(alice.balance, before + 2 ether, "instant full release at goal");
    }

    function test_NoEarlyReleaseBelowGoal() public {
        uint256 id = _commit(alice, 1 ether, 7, 30);
        anchor.setCount(alice, 6); // 6 < 7, window still open - grace does NOT apply early
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.GoalNotReached.selector);
        cmt.release(id);
    }

    // ── grace, retroactive at window end ──

    function test_GraceGrantsFullRefundAtWindowEnd() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        anchor.setCount(alice, 5); // goal-2, inside grace
        vm.warp(block.timestamp + 15 days);
        uint256 before = alice.balance;
        vm.prank(alice);
        cmt.release(id);
        assertEq(alice.balance, before + 1 ether, "grace x2 = full success");
    }

    function test_BeyondGraceCannotRelease() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        anchor.setCount(alice, 4); // goal-3, outside grace
        vm.warp(block.timestamp + 15 days);
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.GoalNotReached.selector);
        cmt.release(id);
    }

    // ── settlement: partial-by-completion, never-more-than-staked ──

    function test_PartialRefundMath() public {
        uint256 id = _commit(alice, 10 ether, 10, 14);
        anchor.setCount(alice, 4); // 4/10 achieved (outside grace)
        vm.warp(block.timestamp + 15 days);
        uint256 aliceBefore = alice.balance;
        uint256 burnBefore = cmt.BURN().balance;
        vm.prank(alice);
        cmt.settle(id);
        assertEq(alice.balance, aliceBefore + 4 ether, "refund = stake * achieved/goal");
        assertEq(cmt.BURN().balance, burnBefore + 6 ether, "remainder burned");
    }

    function test_CharityDestination() public {
        vm.prank(alice);
        uint256 id = cmt.commit{value: 5 ether}(10, 14, KnoleCommitment.Dest.Charity);
        vm.warp(block.timestamp + 15 days); // achieved 0
        vm.prank(alice);
        cmt.settle(id);
        assertEq(charity.balance, 5 ether, "forfeit reaches the fixed charity");
    }

    function test_SettleRespectsAppealDelayForStrangers() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        vm.warp(block.timestamp + 14 days + 1 hours); // window over, appeal open
        vm.prank(stranger);
        vm.expectRevert(KnoleCommitment.AppealWindowOpen.selector);
        cmt.settle(id);
        // the staker themselves may settle immediately
        vm.prank(alice);
        cmt.settle(id);
    }

    function test_StrangerCanSettleAfterAppeal() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        vm.warp(block.timestamp + 14 days + 49 hours);
        vm.prank(stranger);
        cmt.settle(id); // permissionless finalization once the appeal window closes
        (, , , , , , , KnoleCommitment.State st,,) = cmt.commitments(id);
        assertEq(uint8(st), uint8(KnoleCommitment.State.Settled));
    }

    function test_SettleAppliesGraceWhoeverCalls() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        anchor.setCount(alice, 5); // inside grace
        vm.warp(block.timestamp + 14 days + 49 hours);
        uint256 before = alice.balance;
        vm.prank(stranger);
        cmt.settle(id);
        assertEq(alice.balance, before + 1 ether, "grace converts settle into full release");
    }

    function test_NoDoubleExit() public {
        anchor.setCount(alice, 0);
        uint256 id = _commit(alice, 1 ether, 7, 30);
        anchor.setCount(alice, 7);
        vm.prank(alice);
        cmt.release(id);
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.NotActive.selector);
        cmt.release(id);
        vm.warp(block.timestamp + 40 days);
        vm.prank(alice);
        vm.expectRevert(KnoleCommitment.NotActive.selector);
        cmt.settle(id);
    }

    // ── userFavor: the owner's only power is mercy ──

    function test_UserFavorReleasesEveryone() public {
        uint256 id = _commit(alice, 1 ether, 7, 14);
        cmt.enableUserFavor(); // owner (this test contract)
        uint256 before = alice.balance;
        vm.prank(alice);
        cmt.release(id); // 0 achieved, mid-window - and still a full refund
        assertEq(alice.balance, before + 1 ether);
    }

    function test_UserFavorOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        cmt.enableUserFavor();
    }

    // ── friend challenges: linked, never pooled ──

    function test_PairedFundsStayPerStaker() public {
        anchor.setCount(alice, 0);
        anchor.setCount(bob, 0);
        vm.prank(alice);
        (uint256 idA, uint64 pairId) = cmt.commitWithPair{value: 1 ether}(7, 14, KnoleCommitment.Dest.Burn);
        vm.prank(bob);
        uint256 idB = cmt.commitPaired{value: 1 ether}(pairId, 7, 14, KnoleCommitment.Dest.Burn);

        anchor.setCount(alice, 7); // alice succeeds; bob does nothing
        vm.prank(alice);
        cmt.release(idA);

        vm.warp(block.timestamp + 15 days);
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        cmt.settle(idB);
        // bob gets 0 back (0/7 achieved) - and crucially NOT alice's stake
        assertEq(bob.balance, bobBefore, "no cross-transfer between paired stakers");
    }

    function test_PairedRejectsUnknownPair() public {
        vm.prank(bob);
        vm.expectRevert(KnoleCommitment.BadParams.selector);
        cmt.commitPaired{value: 1 ether}(999, 7, 14, KnoleCommitment.Dest.Burn);
    }

    // ── invariant-style sweep: whatever happens, nobody exits with more than staked ──

    function testFuzz_NeverMoreThanStaked(uint32 achieved, uint32 goal, uint96 stakeRaw) public {
        uint32 g = uint32(bound(goal, 3, 60));
        uint96 stake = uint96(bound(stakeRaw, 0.05 ether, 100 ether));
        uint32 a = uint32(bound(achieved, 0, 200));
        vm.deal(alice, stake);
        vm.prank(alice);
        uint256 id = cmt.commit{value: stake}(g, g + 10, KnoleCommitment.Dest.Burn);
        anchor.setCount(alice, a); // a days journaled, all inside the window
        vm.warp(block.timestamp + uint256(g + 11) * 1 days);
        uint32 grace = cmt.GRACE_DAYS();
        vm.prank(alice);
        if (a + grace >= g) {
            cmt.release(id);
        } else {
            cmt.settle(id);
        }
        assertLe(alice.balance, uint256(stake), "the no-upside plank");
    }
}
