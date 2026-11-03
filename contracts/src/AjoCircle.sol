// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, SafeToken} from "./SafeToken.sol";

/// @title AjoCircle — rotating savings (Esusu / Ajo) circles, enforced onchain
/// @notice A circle is a fixed, ordered list of members and a fixed contribution.
///         Every round, each member contributes once. The whole pot goes to the
///         member whose turn it is, in the order agreed when the circle was
///         opened. Nobody holds the money in between: the moment the last
///         member pays, the contract pays out. If a round's time runs out with
///         people still owing, anyone can close the round: the recipient gets
///         what was collected and the defaulters are marked in the book for
///         everyone to see.
/// @dev    Members must `approve` this contract on the token before `contribute`.
contract AjoCircle {
    using SafeToken for IERC20;

    uint256 public constant MAX_MEMBERS = 50;

    struct Circle {
        string name;
        address organizer;
        uint96 contribution; // per member, per round, in token units
        uint64 startTime; // round 0 opens here
        uint64 roundEndsAt; // deadline of the current round
        uint32 roundDuration; // seconds each round lasts
        uint32 currentRound; // index into the member list: whose turn it is
        uint32 paidCount; // members who have paid in the current round
        uint128 pot; // collected in the current round
        bool finished;
    }

    struct MemberView {
        address member;
        bool paidThisRound;
        uint32 missed; // rounds this member failed to pay
        uint256 received; // what this member was paid out on their turn
    }

    IERC20 public immutable token;

    Circle[] private _circles;
    mapping(uint256 => address[]) private _members;
    mapping(uint256 => mapping(address => bool)) public isMember;
    // circleId => round => member => paid?
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public paidInRound;
    mapping(uint256 => mapping(address => uint32)) public missedRounds;
    // circleId => round => amount paid out that round
    mapping(uint256 => mapping(uint256 => uint256)) public payoutOfRound;

    event CircleCreated(uint256 indexed id, string name, address indexed organizer, uint96 contribution, uint256 members);
    event Contributed(uint256 indexed id, uint256 indexed round, address indexed member, uint256 amount);
    event PaidOut(uint256 indexed id, uint256 indexed round, address indexed recipient, uint256 amount, uint256 defaulters);
    event CircleFinished(uint256 indexed id);

    error CircleNotFound();
    error CircleFinishedAlready();
    error NotAMember();
    error AlreadyPaidThisRound();
    error RoundNotOpen();
    error RoundOverdue();
    error RoundStillOpen();
    error BadMembers();
    error ZeroAmount();
    error ZeroDuration();
    error EmptyName();
    error ZeroAddress();

    modifier exists(uint256 id) {
        if (id >= _circles.length) revert CircleNotFound();
        _;
    }

    constructor(IERC20 _token) {
        if (address(_token) == address(0)) revert ZeroAddress();
        token = _token;
    }

    // ---------- opening a circle ----------

    /// @param members      payout order: members[0] collects in round 0, members[1] in round 1, ...
    /// @param startTime    when round 0 opens (0 = now)
    /// @param roundDuration seconds per round, e.g. 7 days for a weekly Ajo
    function createCircle(
        string calldata name,
        address[] calldata members,
        uint96 contribution,
        uint64 startTime,
        uint32 roundDuration
    ) external returns (uint256 id) {
        if (bytes(name).length == 0) revert EmptyName();
        if (contribution == 0) revert ZeroAmount();
        if (roundDuration == 0) revert ZeroDuration();
        if (members.length < 2 || members.length > MAX_MEMBERS) revert BadMembers();

        id = _circles.length;
        for (uint256 i = 0; i < members.length; i++) {
            address m = members[i];
            if (m == address(0) || isMember[id][m]) revert BadMembers();
            isMember[id][m] = true;
            _members[id].push(m);
        }

        uint64 start = startTime == 0 ? uint64(block.timestamp) : startTime;
        _circles.push(
            Circle({
                name: name,
                organizer: msg.sender,
                contribution: contribution,
                startTime: start,
                roundEndsAt: start + roundDuration,
                roundDuration: roundDuration,
                currentRound: 0,
                paidCount: 0,
                pot: 0,
                finished: false
            })
        );
        emit CircleCreated(id, name, msg.sender, contribution, members.length);
    }

    // ---------- each round ----------

    /// @notice Pay your contribution for the current round. If you're the last
    ///         one to pay, the pot goes straight to this round's recipient.
    function contribute(uint256 id) external exists(id) {
        Circle storage c = _circles[id];
        if (c.finished) revert CircleFinishedAlready();
        if (!isMember[id][msg.sender]) revert NotAMember();
        if (block.timestamp < c.startTime) revert RoundNotOpen();
        if (block.timestamp > roundDeadline(id)) revert RoundOverdue();
        uint256 round = c.currentRound;
        if (paidInRound[id][round][msg.sender]) revert AlreadyPaidThisRound();

        paidInRound[id][round][msg.sender] = true;
        c.paidCount += 1;
        c.pot += c.contribution;

        token.safeTransferFrom(msg.sender, address(this), c.contribution);
        emit Contributed(id, round, msg.sender, c.contribution);

        if (c.paidCount == _members[id].length) _payout(id);
    }

    /// @notice After a round's deadline, anyone can close it: the recipient
    ///         gets whatever was collected and non-payers are marked.
    function closeRound(uint256 id) external exists(id) {
        Circle storage c = _circles[id];
        if (c.finished) revert CircleFinishedAlready();
        if (block.timestamp <= roundDeadline(id)) revert RoundStillOpen();
        _payout(id);
    }

    function _payout(uint256 id) private {
        Circle storage c = _circles[id];
        address[] storage list = _members[id];
        uint256 round = c.currentRound;
        address recipient = list[round];
        uint256 amount = c.pot;

        uint256 defaulters;
        for (uint256 i = 0; i < list.length; i++) {
            if (!paidInRound[id][round][list[i]]) {
                missedRounds[id][list[i]] += 1;
                defaulters++;
            }
        }

        payoutOfRound[id][round] = amount;
        c.pot = 0;
        c.paidCount = 0;
        c.currentRound += 1;
        // Next turn keeps the agreed calendar when things run on time, but if this
        // turn was closed late, the next member still gets a full window to be paid,
        // so a late close can never skip someone's turn.
        uint64 next = c.roundEndsAt + c.roundDuration;
        if (next <= block.timestamp) next = uint64(block.timestamp) + c.roundDuration;
        c.roundEndsAt = next;
        if (c.currentRound == list.length) {
            c.finished = true;
            emit CircleFinished(id);
        }

        if (amount > 0) token.safeTransfer(recipient, amount);
        emit PaidOut(id, round, recipient, amount, defaulters);
    }

    // ---------- views ----------

    /// @notice End of the current round's window (unix seconds).
    function roundDeadline(uint256 id) public view exists(id) returns (uint256) {
        return _circles[id].roundEndsAt;
    }

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    function getCircle(uint256 id) external view exists(id) returns (Circle memory) {
        return _circles[id];
    }

    function getAllCircles() external view returns (Circle[] memory) {
        return _circles;
    }

    function getMembers(uint256 id) external view exists(id) returns (MemberView[] memory out) {
        Circle storage c = _circles[id];
        address[] storage list = _members[id];
        out = new MemberView[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            address m = list[i];
            out[i] = MemberView({
                member: m,
                paidThisRound: !c.finished && paidInRound[id][c.currentRound][m],
                missed: missedRounds[id][m],
                received: i < c.currentRound ? payoutOfRound[id][i] : 0
            });
        }
    }
}
