// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {JournalDayAnchor} from "../JournalDayAnchor.sol";

contract JournalDayAnchorTest is Test {
    JournalDayAnchor internal anchor;
    address internal server = makeAddr("server");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_700_000_000); // a real-ish timestamp, not day 0
        vm.prank(server);
        anchor = new JournalDayAnchor();
    }

    function test_FirstRecord_IncrementsAndEmits() public {
        uint64 day = anchor.currentDay();
        vm.prank(server);
        vm.expectEmit(true, true, false, true);
        emit JournalDayAnchor.DayJournaled(alice, day, 1);
        anchor.recordDay(alice);

        assertEq(anchor.journaledDayCount(alice), 1);
        assertTrue(anchor.hasJournaledToday(alice));
        (bool ever, uint64 last) = anchor.lastJournaledDay(alice);
        assertTrue(ever);
        assertEq(last, day);
    }

    function test_SameDay_Idempotent() public {
        vm.startPrank(server);
        anchor.recordDay(alice);
        anchor.recordDay(alice);
        anchor.recordDay(alice);
        vm.stopPrank();
        assertEq(anchor.journaledDayCount(alice), 1, "multiple entries, one day");
    }

    function test_NextDay_Increments() public {
        vm.prank(server);
        anchor.recordDay(alice);
        vm.warp(block.timestamp + 1 days);
        vm.prank(server);
        anchor.recordDay(alice);
        assertEq(anchor.journaledDayCount(alice), 2);
    }

    function test_DayBoundary_Exact() public {
        // 23:59:59 and 00:00:01 of the next UTC day are two distinct days; same-day seconds are one.
        uint256 dayStart = (block.timestamp / 1 days) * 1 days;
        vm.warp(dayStart + 86_399); // 23:59:59
        vm.prank(server);
        anchor.recordDay(alice);
        vm.warp(dayStart + 86_400); // 00:00:00 next day
        vm.prank(server);
        anchor.recordDay(alice);
        assertEq(anchor.journaledDayCount(alice), 2, "midnight boundary splits days");
        assertTrue(anchor.hasJournaledToday(alice));
    }

    function test_UsersIndependent() public {
        vm.startPrank(server);
        anchor.recordDay(alice);
        anchor.recordDay(bob);
        vm.stopPrank();
        assertEq(anchor.journaledDayCount(alice), 1);
        assertEq(anchor.journaledDayCount(bob), 1);
        vm.warp(block.timestamp + 1 days);
        vm.prank(server);
        anchor.recordDay(alice);
        assertEq(anchor.journaledDayCount(alice), 2);
        assertEq(anchor.journaledDayCount(bob), 1, "bob unaffected");
        assertFalse(anchor.hasJournaledToday(bob));
    }

    function test_Batch_SkipsDuplicatesAndZero() public {
        address[] memory users = new address[](4);
        users[0] = alice;
        users[1] = bob;
        users[2] = alice; // duplicate in the same batch
        users[3] = address(0); // skipped, never reverts the sweep
        vm.prank(server);
        anchor.recordDays(users);
        assertEq(anchor.journaledDayCount(alice), 1);
        assertEq(anchor.journaledDayCount(bob), 1);
    }

    function test_NonAnchor_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        anchor.recordDay(alice);
        address[] memory users = new address[](1);
        users[0] = alice;
        vm.prank(alice);
        vm.expectRevert();
        anchor.recordDays(users);
    }

    function test_ZeroUser_Reverts() public {
        vm.prank(server);
        vm.expectRevert(bytes("zero user"));
        anchor.recordDay(address(0));
    }

    /// Random walks through time can only ever increment by 0 or 1 per distinct day, monotonically.
    function testFuzz_AtMostOnePerDay_Monotonic(uint32[16] memory hops) public {
        uint32 lastCount;
        uint64 lastRecordedDay = type(uint64).max;
        uint256 distinctDays;
        for (uint256 i = 0; i < hops.length; i++) {
            vm.warp(block.timestamp + bound(hops[i], 0, 3 days));
            uint64 day = anchor.currentDay();
            vm.prank(server);
            anchor.recordDay(alice);
            uint32 count = anchor.journaledDayCount(alice);
            assertGe(count, lastCount, "monotonic");
            assertLe(count - lastCount, 1, "at most +1 per call");
            if (day != lastRecordedDay) {
                distinctDays++;
                lastRecordedDay = day;
            }
            lastCount = count;
        }
        assertEq(lastCount, distinctDays, "count == distinct days touched");
    }
}
