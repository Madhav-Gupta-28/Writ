// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// The USDC ERC-20 interface on Arc. 6 decimals. ARCHITECTURE.md §3.3.
interface IUSDC {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function isBlacklisted(address who) external view returns (bool);
}

/// Arc PQ Signature Verify precompile. Verified live on mainnet 2026-10-06.
/// Reverts on wrong vk/sig length; returns false for a bad signature. §3.4.
interface IPQVerify {
    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata sig)
        external view returns (bool);
}

/// A standing USDC payment order. Funding is ECDSA, execution is permissionless,
/// amendment is SLH-DSA only. See ARCHITECTURE.md.
///
/// Core slice: open, fund, execute, amend. Not yet implemented: quarantine,
/// cancelByPq, rotateKey, resolveQuarantine, the wallet-cancel dance, reclaim,
/// and the EIP-3009 entry points.
contract Writ {
    // ---------------------------------------------------------------- constants

    IUSDC     public constant USDC = IUSDC(0x3600000000000000000000000000000000000000);
    IPQVerify public constant PQ   = IPQVerify(0x1800000000000000000000000000000000000004);

    uint256 public constant PQ_PUBKEY_LEN = 32;    // §3.4, enforced by revert in the precompile
    uint256 public constant PQ_SIG_LEN    = 7856;  // §3.4

    /// 18-decimal native gas accounting -> 6-decimal ERC-20 amounts. §3.10, §6.2.
    uint256 public constant NATIVE_TO_ERC20 = 1e12;

    uint64  public constant WALLET_CANCEL_DELAY = 30 days;  // §5.7
    uint64  public constant RECLAIM_GRACE       = 30 days;  // §5.8
    uint128 public constant EXECUTOR_TIP        = 10_000;   // 0.01 USDC, 6dp
    uint256 public constant REIMBURSE_OVERHEAD  = 30_000;   // gas after the measurement point. ESTIMATE

    uint64  public constant MIN_PERIOD = 1 hours;
    uint64  public constant MAX_PERIOD = 365 days;

    bytes32 public constant DOMAIN_TAG = keccak256("WRIT_V1");

    // ---------------------------------------------------------------- types

    enum State { None, Active, Quarantined, Cancelled, Completed }

    enum Action { Amend, Cancel, RotateKey, ResolveQuarantine, VetoWalletCancel }

    struct Obligation {
        address  payer;            // funds it; cannot redirect it
        address  beneficiary;      // receives every period
        uint128  amountPerPeriod;  // USDC, 6dp
        uint128  balance;          // USDC held for this obligation, 6dp
        uint128  maxExecutorFee;   // per-execution cap, 6dp
        uint64   periodSeconds;
        uint64   nextDueAt;
        uint64   endTime;          // MANDATORY. the lost-key backstop. §2.4
        uint64   pqNonce;          // increments on every successful PQ action
        uint64   cancelReadyAt;    // 0 = none; set by beginWalletCancel
        uint32   periodsPaid;
        State    state;
        bytes32  pqKey;            // SLH-DSA-SHA2-128s public key, exactly 32 bytes
        bytes32  ref;              // reconciliation reference. §3.7 — no native memo exists
    }

    /// The terms a payer chooses at open. §5.2.
    struct Terms {
        address  beneficiary;
        uint128  amountPerPeriod;
        uint64   periodSeconds;
        uint64   startAt;
        uint64   endTime;
        uint128  maxExecutorFee;
        bytes32  pqKey;
        bytes32  ref;
    }

    // ---------------------------------------------------------------- storage

    mapping(uint256 => Obligation) public obligations;
    uint256 public nextId = 1;

    uint256 public totalCommitted;   // Σ obligations[*].balance — invariant anchor, §10

    bool private transient _entered;

    // ---------------------------------------------------------------- events

    event Opened(uint256 indexed id, address indexed payer, address indexed beneficiary,
                 uint128 amountPerPeriod, uint64 periodSeconds, uint64 endTime,
                 bytes32 pqKey, bytes32 ref);
    event Funded(uint256 indexed id, address indexed from, uint128 amount, uint128 newBalance);

    /// The reconciliation record. Arc's Memo predeploy cannot be reached from a
    /// contract (§3.7), so this event is the canonical reference, not a Memo log.
    event Paid(uint256 indexed id, address indexed beneficiary, uint128 amount,
               uint32 periodIndex, bytes32 ref);

    event Amended(uint256 indexed id, address indexed newBeneficiary, uint128 newAmount,
                  uint64 newPeriodSeconds, uint64 newEndTime, uint64 pqNonce);
    event Completed(uint256 indexed id);
    event ExecutorPaid(uint256 indexed id, address indexed executor, uint128 fee);
    event PQVerified(uint256 indexed id, Action action, bytes32 digest, uint64 pqNonce);

    // ---------------------------------------------------------------- errors (§5.10)

    error NotActive();
    error NotFundable();
    error NotDue();
    error Underfunded();

    error Expired();
    error BadSignatureLength();
    error BadSignature();

    error InvalidBeneficiary();
    error BeneficiaryBlacklisted();
    error InvalidPqKey();
    error ZeroAmount();
    error InvalidPeriod();
    error StartInPast();
    error InvalidEndTime();
    error InvalidExecutorFee();
    error InsufficientInitialFunding();

    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    // ---------------------------------------------------------------- open / fund (§5.8)

    /// Payer = msg.sender. Pulls initialFunding with transferFrom (needs a prior approve).
    function open(Terms calldata t, uint128 initialFunding)
        external nonReentrant returns (uint256 id)
    {
        id = _open(t, msg.sender, initialFunding);
        if (!USDC.transferFrom(msg.sender, address(this), initialFunding)) revert TransferFailed();
    }

    /// Anyone may top up any live obligation.
    function fund(uint256 id, uint128 amount) external nonReentrant {
        _credit(id, amount, msg.sender);
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    function _open(Terms calldata t, address payer, uint128 initialFunding)
        private returns (uint256 id)
    {
        // Validation order follows the §5.8 table.
        _checkBeneficiary(t.beneficiary);
        if (t.pqKey == bytes32(0)) revert InvalidPqKey();
        _checkAmountAndPeriod(t.amountPerPeriod, t.periodSeconds);
        // A past start would make every missed period payable at once.
        if (t.startAt < block.timestamp) revert StartInPast();
        if (t.endTime <= t.startAt || uint256(t.endTime) < uint256(t.startAt) + t.periodSeconds) {
            revert InvalidEndTime();
        }
        _checkExecutorFee(t.maxExecutorFee, t.amountPerPeriod);
        if (initialFunding < t.amountPerPeriod) revert InsufficientInitialFunding();

        id = nextId++;
        Obligation storage o = obligations[id];
        o.payer           = payer;
        o.beneficiary     = t.beneficiary;
        o.amountPerPeriod = t.amountPerPeriod;
        o.balance         = initialFunding;
        o.maxExecutorFee  = t.maxExecutorFee;
        o.periodSeconds   = t.periodSeconds;
        o.nextDueAt       = t.startAt;
        o.endTime         = t.endTime;
        o.state           = State.Active;
        o.pqKey           = t.pqKey;
        o.ref             = t.ref;
        totalCommitted   += initialFunding;

        emit Opened(id, payer, t.beneficiary, t.amountPerPeriod, t.periodSeconds,
                    t.endTime, t.pqKey, t.ref);
        emit Funded(id, payer, initialFunding, initialFunding);
    }

    /// Every top-up ends here. None, Cancelled and Completed would strand the deposit.
    function _credit(uint256 id, uint128 amount, address from) private {
        Obligation storage o = obligations[id];
        if (o.state != State.Active && o.state != State.Quarantined) revert NotFundable();
        if (amount == 0) revert ZeroAmount();
        o.balance      += amount;
        totalCommitted += amount;
        emit Funded(id, from, amount, o.balance);
    }

    // ---------------------------------------------------------------- execute (§5.4)

    /// Pays one period. Permissionless; the caller is reimbursed from the obligation.
    function execute(uint256 id) external nonReentrant {
        uint256 gasStart = gasleft();
        Obligation storage o = obligations[id];

        if (o.state != State.Active)       revert NotActive();
        if (block.timestamp < o.nextDueAt) revert NotDue();

        // TODO(quarantine): the isBlacklisted pre-screen (§5.4) lands with the
        // quarantine slice. Until then a blocklisted beneficiary makes this revert.

        uint128 amt = o.amountPerPeriod;
        if (o.balance < amt) revert Underfunded();

        // effects before interaction
        o.balance      -= amt;
        totalCommitted -= amt;
        o.nextDueAt    += o.periodSeconds;
        uint32 idx      = ++o.periodsPaid;

        if (!USDC.transfer(o.beneficiary, amt)) revert TransferFailed();
        emit Paid(id, o.beneficiary, amt, idx, o.ref);

        if (o.nextDueAt > o.endTime) {
            o.state = State.Completed;
            emit Completed(id);
        }

        _payExecutor(id, o, gasStart);
    }

    /// §5.5. The only place the 18-decimal and 6-decimal conventions meet.
    function _payExecutor(uint256 id, Obligation storage o, uint256 gasStart) private {
        uint256 gasUsed = gasStart - gasleft() + REIMBURSE_OVERHEAD;
        // tx.gasprice is 18-decimal native USDC. §3.10. Computed in uint256 and
        // capped before narrowing, so an extreme gas price cannot truncate.
        uint256 fee = gasUsed * tx.gasprice / NATIVE_TO_ERC20 + EXECUTOR_TIP;

        if (fee > o.maxExecutorFee) fee = o.maxExecutorFee;
        if (fee > o.balance)        fee = o.balance;
        if (fee == 0) return;

        uint128 fee128  = uint128(fee);
        o.balance      -= fee128;
        totalCommitted -= fee128;
        if (!USDC.transfer(msg.sender, fee128)) revert TransferFailed();
        emit ExecutorPaid(id, msg.sender, fee128);
    }

    // ---------------------------------------------------------------- PQ path (§5.6)

    /// Must match shared/digest.ts byte for byte.
    function digestFor(uint256 id, Action action, bytes memory payload, uint64 deadline)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(
            DOMAIN_TAG,
            block.chainid,
            address(this),
            id,
            uint8(action),
            keccak256(payload),
            obligations[id].pqNonce,
            deadline
        ));
    }

    /// Changes terms. Active only; nextDueAt is kept and the new period applies
    /// after the next payment. §5.6.
    function amend(
        uint256 id, address newBeneficiary, uint128 newAmount,
        uint64 newPeriodSeconds, uint64 newEndTime, uint128 newMaxExecutorFee,
        uint64 deadline, bytes calldata pqSig
    ) external nonReentrant {
        Obligation storage o = obligations[id];
        if (o.state != State.Active) revert NotActive();

        // Validate before paying for the 433k-gas verification.
        _checkBeneficiary(newBeneficiary);
        _checkAmountAndPeriod(newAmount, newPeriodSeconds);
        if (newEndTime < o.nextDueAt || newEndTime < block.timestamp) revert InvalidEndTime();
        _checkExecutorFee(newMaxExecutorFee, newAmount);

        uint64 nonce = o.pqNonce;
        _requirePq(id, o, Action.Amend,
            abi.encode(newBeneficiary, newAmount, newPeriodSeconds, newEndTime, newMaxExecutorFee),
            deadline, pqSig);

        o.beneficiary     = newBeneficiary;
        o.amountPerPeriod = newAmount;
        o.periodSeconds   = newPeriodSeconds;
        o.endTime         = newEndTime;
        o.maxExecutorFee  = newMaxExecutorFee;

        emit Amended(id, newBeneficiary, newAmount, newPeriodSeconds, newEndTime, nonce);
    }

    function _requirePq(
        uint256 id, Obligation storage o,
        Action action, bytes memory payload,
        uint64 deadline, bytes calldata pqSig
    ) private {
        if (block.timestamp > deadline) revert Expired();

        // §3.4: the precompile REVERTS on a wrong length instead of returning
        // false. Validate here so a malformed signature yields a typed error.
        if (pqSig.length != PQ_SIG_LEN) revert BadSignatureLength();

        bytes32 d = digestFor(id, action, payload, deadline);

        bool ok = PQ.verifySlhDsaSha2128s(
            abi.encodePacked(o.pqKey),   // exactly 32 bytes, structurally
            abi.encodePacked(d),         // 32 bytes; the precompile accepts any length
            pqSig
        );
        if (!ok) revert BadSignature();

        emit PQVerified(id, action, d, o.pqNonce);
        o.pqNonce++;                     // consume the nonce only on success
    }

    // ---------------------------------------------------------------- term checks

    function _checkBeneficiary(address b) private view {
        if (b == address(0) || b == address(this)) revert InvalidBeneficiary();
        if (USDC.isBlacklisted(b)) revert BeneficiaryBlacklisted();
    }

    function _checkAmountAndPeriod(uint128 amount, uint64 period) private pure {
        if (amount == 0) revert ZeroAmount();
        if (period < MIN_PERIOD || period > MAX_PERIOD) revert InvalidPeriod();
    }

    function _checkExecutorFee(uint128 fee, uint128 amount) private pure {
        if (fee == 0 || fee >= amount) revert InvalidExecutorFee();
    }
}
