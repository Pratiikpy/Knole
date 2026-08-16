// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

interface IJournalDayAnchor {
    function journaledDayCount(address user) external view returns (uint32);
    /// Days journaled as of the END of UTC day `day` — the deadline-safe read.
    function countAtDay(address user, uint64 day) external view returns (uint32);
}

/**
 * KnoleCommitment - "stake it, journal N days, get it back."
 *
 * A commitment contract, never a wager. The legal planks are STRUCTURAL:
 *  - The outcome is fully user-controlled (their own journaling, proven by the on-chain
 *    JournalDayAnchor this contract reads directly - no off-chain oracle, no operator judgment).
 *  - No upside, ever: a staker can NEVER receive more than they staked. There is no pool, no
 *    prize, no cross-transfer between stakers.
 *  - Counterparty neutrality: forfeited remainders go to a burn address or a fixed charity
 *    address chosen at stake time - the operator cannot receive funds and holds no sweep power.
 *  - Failure still pays back completion: a missed goal refunds stake * achieved / goal.
 *
 * Mechanics from the audited design:
 *  - Instant release the moment the goal count is hit - no waiting for the window to end.
 *  - 24h cooling-off: full refund, no questions.
 *  - Grace x2, automatic and retroactive: at window end, achieved >= goal - 2 still counts as
 *    full success.
 *  - 48h appeal delay: after the window ends, the forfeit remainder cannot be captured for 48h;
 *    the user's completion share is claimable immediately.
 *  - Oracle-down -> user's favor: the owner's ONLY power over funds is enabling userFavor, a
 *    one-way switch that lets every staker exit with a FULL refund (used if the anchoring
 *    pipeline ever breaks). The owner can help stakers; it cannot take from them.
 *  - No weakening: after cooling-off a commitment cannot be edited or cancelled - strictly
 *    stronger than a 7-day akrasia timelock, and simpler to verify.
 *  - Challenge-a-friend: paired commitments share a pairId for the UI; funds stay strictly
 *    per-staker.
 */
contract KnoleCommitment is Ownable, ReentrancyGuard {
    using Address for address payable;

    IJournalDayAnchor public immutable anchor;
    address public immutable charity;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint256 public constant MIN_STAKE = 0.05 ether;
    uint256 public constant MAX_STAKE = 100 ether;
    uint32 public constant GRACE_DAYS = 2;
    uint256 public constant COOLING_OFF = 24 hours;
    uint256 public constant APPEAL_DELAY = 48 hours;
    uint32 public constant MIN_GOAL = 3;
    uint32 public constant MAX_WINDOW_DAYS = 120;

    enum Dest {
        Burn,
        Charity
    }
    enum State {
        Active,
        Released,
        Settled,
        Cancelled
    }

    struct Commitment {
        address staker;
        uint96 stake;
        uint32 goalDays;
        uint32 startCount; // anchor.journaledDayCount at creation
        uint64 createdAt;
        uint64 windowEnd;
        Dest dest;
        State state;
        uint64 pairId; // 0 = solo; shared id links friend challenges (funds stay per-staker)
        // The last UTC day that counts toward this commitment. Settlement reads the anchor's
        // HISTORICAL count as of this day, so the result is a fact about the window rather than
        // about when someone happened to call: previously the count was read live at exit time,
        // which meant days journaled months late still satisfied the goal, and a stranger calling
        // settle first could freeze a number the staker was still improving.
        uint64 windowEndDay;
    }

    uint256 public nextId = 1;
    uint64 public nextPairId = 1;
    mapping(uint256 => Commitment) public commitments;
    mapping(address => uint256[]) public byStaker;

    /// One-way, global: when true every ACTIVE commitment can exit with a full refund.
    bool public userFavor;

    event Committed(
        uint256 indexed id,
        address indexed staker,
        uint256 stake,
        uint32 goalDays,
        uint64 windowEnd,
        Dest dest,
        uint64 pairId
    );
    event Released(uint256 indexed id, address indexed staker, uint256 amount, uint32 achieved);
    event Settled(
        uint256 indexed id,
        address indexed staker,
        uint256 refunded,
        uint256 forfeited,
        uint32 achieved
    );
    event Cancelled(uint256 indexed id, address indexed staker, uint256 amount);
    event UserFavorEnabled();

    error BadParams();
    error NotStaker();
    error NotActive();
    error GoalNotReached();
    error WindowNotOver();
    error AppealWindowOpen();
    error CoolingOffOver();
    error TransferBanned();

    constructor(address anchor_, address charity_) Ownable(msg.sender) {
        require(anchor_ != address(0) && charity_ != address(0), "zero addr");
        anchor = IJournalDayAnchor(anchor_);
        charity = charity_;
    }

    // ── create ───────────────────────────────────────────

    function commit(uint32 goalDays, uint32 windowDays, Dest dest) external payable returns (uint256 id) {
        return _commit(goalDays, windowDays, dest, 0);
    }

    /// Challenge a friend: caller stakes now and gets a pairId to share; the friend commits with
    /// commitPaired(pairId, ...). Purely a UI link - each side's funds settle on their OWN journaling.
    function commitWithPair(uint32 goalDays, uint32 windowDays, Dest dest)
        external
        payable
        returns (uint256 id, uint64 pairId)
    {
        pairId = nextPairId++;
        id = _commit(goalDays, windowDays, dest, pairId);
    }

    function commitPaired(uint64 pairId, uint32 goalDays, uint32 windowDays, Dest dest)
        external
        payable
        returns (uint256 id)
    {
        if (pairId == 0 || pairId >= nextPairId) revert BadParams();
        return _commit(goalDays, windowDays, dest, pairId);
    }

    function _commit(uint32 goalDays, uint32 windowDays, Dest dest, uint64 pairId)
        internal
        returns (uint256 id)
    {
        // userFavor means the anchoring pipeline is known-broken: every new commitment would be
        // instantly refundable and mean nothing. Stop taking them rather than take money for a
        // promise the contract can no longer keep.
        if (userFavor) revert BadParams();
        if (msg.value < MIN_STAKE || msg.value > MAX_STAKE) revert BadParams();
        if (goalDays < MIN_GOAL || windowDays < goalDays || windowDays > MAX_WINDOW_DAYS) revert BadParams();

        id = nextId++;
        commitments[id] = Commitment({
            staker: msg.sender,
            stake: uint96(msg.value),
            goalDays: goalDays,
            startCount: anchor.journaledDayCount(msg.sender),
            createdAt: uint64(block.timestamp),
            windowEnd: uint64(block.timestamp + uint256(windowDays) * 1 days),
            dest: dest,
            state: State.Active,
            pairId: pairId,
            windowEndDay: uint64((block.timestamp + uint256(windowDays) * 1 days) / 1 days)
        });
        byStaker[msg.sender].push(id);
        emit Committed(id, msg.sender, msg.value, goalDays, commitments[id].windowEnd, dest, pairId);
    }

    // ── progress ─────────────────────────────────────────

    /// Days journaled INSIDE the window. While the window is open this is the live count; once it
    /// closes it is the anchor's historical count as of the final day — permanently fixed, so it
    /// cannot drift with later journaling and does not depend on who calls first.
    function achievedDays(uint256 id) public view returns (uint32) {
        Commitment storage c = commitments[id];
        uint32 counted = block.timestamp > c.windowEnd
            ? anchor.countAtDay(c.staker, c.windowEndDay)
            : anchor.journaledDayCount(c.staker);
        return counted > c.startCount ? counted - c.startCount : 0;
    }

    // ── exits ────────────────────────────────────────────

    /// Full refund within 24h of creation - no questions, no penalty.
    function coolOff(uint256 id) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.staker != msg.sender) revert NotStaker();
        if (c.state != State.Active) revert NotActive();
        if (block.timestamp > c.createdAt + COOLING_OFF) revert CoolingOffOver();
        c.state = State.Cancelled;
        emit Cancelled(id, msg.sender, c.stake);
        payable(msg.sender).sendValue(c.stake);
    }

    /// The felt-magic path: claimable the MOMENT the goal count is reached - mid-window included.
    function release(uint256 id) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.staker != msg.sender) revert NotStaker();
        if (c.state != State.Active) revert NotActive();
        uint32 achieved = achievedDays(id);
        bool favored = userFavor;
        if (!favored) {
            // At window end the automatic, retroactive grace applies; before it, the full goal must be hit.
            if (block.timestamp > c.windowEnd) {
                // uint256 math: a saturated anchor count would have panicked in uint32 and locked
                // the stake permanently.
                if (uint256(achieved) + GRACE_DAYS < c.goalDays) revert GoalNotReached();
            } else {
                if (achieved < c.goalDays) revert GoalNotReached();
            }
        }
        c.state = State.Released;
        emit Released(id, msg.sender, c.stake, achieved);
        payable(msg.sender).sendValue(c.stake);
    }

    /// Missed-goal settlement: refunds stake * achieved / goal to the staker, sends the remainder
    /// to the chosen burn/charity destination. Callable by ANYONE only after the 48h appeal delay,
    /// or by the staker themselves at window end (accepting their partial immediately).
    function settle(uint256 id) external nonReentrant {
        Commitment storage c = commitments[id];
        // An id that was never created has state Active(0) and windowEnd 0, so every guard below
        // passed: settle(999999) succeeded and emitted a phantom Released for anyone to index.
        if (c.staker == address(0)) revert BadParams();
        if (c.state != State.Active) revert NotActive();
        if (block.timestamp <= c.windowEnd) revert WindowNotOver();
        if (msg.sender != c.staker && block.timestamp <= c.windowEnd + APPEAL_DELAY) {
            revert AppealWindowOpen();
        }

        uint32 achieved = achievedDays(id);
        // Grace and userFavor both resolve to a full release, whoever calls.
        if (userFavor || uint256(achieved) + GRACE_DAYS >= c.goalDays) {
            c.state = State.Released;
            emit Released(id, c.staker, c.stake, achieved);
            payable(c.staker).sendValue(c.stake);
            return;
        }

        uint256 refund = (uint256(c.stake) * achieved) / c.goalDays;
        uint256 forfeit = c.stake - refund;
        c.state = State.Settled;
        emit Settled(id, c.staker, refund, forfeit, achieved);
        if (refund > 0) payable(c.staker).sendValue(refund);
        if (forfeit > 0) {
            // A charity address that reverts on receive would otherwise revert the WHOLE
            // settlement, stranding the staker's refund with no exit but the global userFavor
            // switch. Burn is a codeless address and always accepts, so it is the safe fallback.
            address dest_ = c.dest == Dest.Burn ? BURN : charity;
            (bool sent, ) = dest_.call{value: forfeit}("");
            if (!sent) payable(BURN).sendValue(forfeit);
        }
    }

    // ── the owner's only power: helping stakers ──────────

    /// One-way. If the anchoring pipeline ever breaks, every active commitment becomes fully
    /// refundable via release(). The owner cannot move funds anywhere else, ever.
    function enableUserFavor() external onlyOwner {
        userFavor = true;
        emit UserFavorEnabled();
    }

    // ── views ────────────────────────────────────────────

    function commitmentsOf(address staker) external view returns (uint256[] memory) {
        return byStaker[staker];
    }

    /// No plain-ETH deposits - funds enter only through commit().
    receive() external payable {
        revert TransferBanned();
    }
}
