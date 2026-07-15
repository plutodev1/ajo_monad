// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AjoBook — an onchain dues book for a community
/// @notice "Ajo" is the Nigerian word for group contributions. This contract
///         replaces the WhatsApp spreadsheet-and-receipts routine: an admin
///         opens a campaign (e.g. "July dues", "Lagos meetup fund"), members
///         pay MON directly, and every payment is publicly recorded forever.
contract AjoBook {
    struct Campaign {
        string name;
        string details;
        uint96 duesAmount; // fixed amount per payment; 0 means any amount is welcome
        uint64 deadline; // unix timestamp; 0 means no deadline
        uint128 totalCollected;
        uint32 payerCount; // unique payers
        bool closed;
    }

    struct PaymentView {
        address member;
        string name;
        uint256 amount;
    }

    address public admin;
    string public communityName;

    Campaign[] private _campaigns;
    // campaignId => member => total paid into that campaign
    mapping(uint256 => mapping(address => uint256)) public paidAmount;
    // campaignId => list of unique payers, in order of first payment
    mapping(uint256 => address[]) private _payers;
    // optional display name so the ledger reads like a real dues book
    mapping(address => string) public memberName;

    event CampaignCreated(uint256 indexed id, string name, uint96 duesAmount, uint64 deadline);
    event CampaignClosed(uint256 indexed id);
    event DuesPaid(uint256 indexed id, address indexed member, uint256 amount, string memberDisplayName);
    event MemberNamed(address indexed member, string name);
    event Withdrawn(address indexed to, uint256 amount);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotAdmin();
    error CampaignNotFound();
    error CampaignIsClosed();
    error DeadlinePassed();
    error WrongAmount(uint256 expected, uint256 sent);
    error ZeroAmount();
    error WithdrawFailed();
    error EmptyName();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier exists(uint256 id) {
        if (id >= _campaigns.length) revert CampaignNotFound();
        _;
    }

    constructor(string memory _communityName) {
        admin = msg.sender;
        communityName = _communityName;
    }

    // ---------- admin ----------

    function createCampaign(string calldata name, string calldata details, uint96 duesAmount, uint64 deadline)
        external
        onlyAdmin
        returns (uint256 id)
    {
        if (bytes(name).length == 0) revert EmptyName();
        _campaigns.push(
            Campaign({
                name: name,
                details: details,
                duesAmount: duesAmount,
                deadline: deadline,
                totalCollected: 0,
                payerCount: 0,
                closed: false
            })
        );
        id = _campaigns.length - 1;
        emit CampaignCreated(id, name, duesAmount, deadline);
    }

    function closeCampaign(uint256 id) external onlyAdmin exists(id) {
        _campaigns[id].closed = true;
        emit CampaignClosed(id);
    }

    function withdraw(address payable to, uint256 amount) external onlyAdmin {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // ---------- members ----------

    /// @notice Pay dues into a campaign. If the campaign has a fixed dues
    ///         amount, you must send exactly that amount.
    function payDues(uint256 id) external payable exists(id) {
        Campaign storage c = _campaigns[id];
        if (c.closed) revert CampaignIsClosed();
        if (c.deadline != 0 && block.timestamp > c.deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroAmount();
        if (c.duesAmount != 0 && msg.value != c.duesAmount) revert WrongAmount(c.duesAmount, msg.value);

        if (paidAmount[id][msg.sender] == 0) {
            _payers[id].push(msg.sender);
            c.payerCount += 1;
        }
        paidAmount[id][msg.sender] += msg.value;
        c.totalCollected += uint128(msg.value);

        emit DuesPaid(id, msg.sender, msg.value, memberName[msg.sender]);
    }

    /// @notice Set the display name shown next to your address in the ledger.
    function setMyName(string calldata name) external {
        memberName[msg.sender] = name;
        emit MemberNamed(msg.sender, name);
    }

    // ---------- views ----------

    function campaignCount() external view returns (uint256) {
        return _campaigns.length;
    }

    function getCampaign(uint256 id) external view exists(id) returns (Campaign memory) {
        return _campaigns[id];
    }

    function getAllCampaigns() external view returns (Campaign[] memory) {
        return _campaigns;
    }

    /// @notice The full ledger page for a campaign: every payer with their
    ///         display name and total paid.
    function getLedger(uint256 id) external view exists(id) returns (PaymentView[] memory page) {
        address[] storage list = _payers[id];
        page = new PaymentView[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            address m = list[i];
            page[i] = PaymentView({member: m, name: memberName[m], amount: paidAmount[id][m]});
        }
    }

    receive() external payable {}
}
