// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// The USDC ERC-20 interface on Arc. 6 decimals. ARCHITECTURE.md §3.3, §3.8.
interface IUSDC {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function isBlacklisted(address who) external view returns (bool);
    function receiveWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external;
}

/// Arc PQ Signature Verify precompile. Verified live on mainnet 2026-10-06.
/// Reverts on wrong vk/sig length; returns false for a bad signature. §3.4.
interface IPQVerify {
    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata sig)
        external view returns (bool);
}

/// A standing USDC payment order. Funding is ECDSA, execution is permissionless,
/// amendment is SLH-DSA only. See ARCHITECTURE.md.
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

    bytes32 public constant DOMAIN_TAG    = keccak256("WRIT_V1");
    bytes32 public constant OPEN_AUTH_TAG = keccak256("WRIT_V1_OPEN_AUTH");
    bytes32 public constant FUND_AUTH_TAG = keccak256("WRIT_V1_FUND_AUTH");

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

    /// EIP-3009 `receiveWithAuthorization` fields other than from / to / value.
    struct Authorization {
        uint256  validAfter;
        uint256  validBefore;
        bytes32  nonce;
        uint8    v;
        bytes32  r;
        bytes32  s;
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

    event Quarantined(uint256 indexed id, address indexed beneficiary, uint64 at);
    /// newBeneficiary == address(0) means the quarantine was resolved by cancelling.
    event QuarantineResolved(uint256 indexed id, address indexed newBeneficiary);
    /// pqNonce in Amended / KeyRotated / WalletCancelVetoed is the nonce that
    /// authorized the action, as in PQVerified.
    event Amended(uint256 indexed id, address indexed newBeneficiary, uint128 newAmount,
                  uint64 newPeriodSeconds, uint64 newEndTime, uint64 pqNonce);
    event KeyRotated(uint256 indexed id, bytes32 newPqKey, uint64 pqNonce);
    event Cancelled(uint256 indexed id, uint128 refunded, bool byPqKey);
    event Reclaimed(uint256 indexed id, uint128 refunded);
    event WalletCancelBegun(uint256 indexed id, uint64 readyAt);
    event WalletCancelVetoed(uint256 indexed id, uint64 pqNonce);
    event Completed(uint256 indexed id);
    event ExecutorPaid(uint256 indexed id, address indexed executor, uint128 fee);
    event PQVerified(uint256 indexed id, Action action, bytes32 digest, uint64 pqNonce);

    // ---------------------------------------------------------------- errors (§5.10)

    error NotActive();
    error NotQuarantined();
    error NotFundable();
    error NotDue();
    error Underfunded();
    error TooEarly();

    error NotPayer();
    error NoCancelPending();
    error CancelNotReady();

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

    error BadAuthorizationNonce();

    error TransferFailed();
    error PayerBlacklisted();

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

    /// The EIP-3009 nonce a payer must sign to open obligation `id` with terms `t`.
    /// chainid is not included: the USDC EIP-712 domain already binds the chain.
    function openAuthNonce(uint256 id, Terms calldata t) public view returns (bytes32) {
        return keccak256(abi.encode(OPEN_AUTH_TAG, address(this), id, keccak256(abi.encode(t))));
    }

    /// Open and fund in one transaction, no approve. Payer = from, not
    /// msg.sender, so a relayer may submit it: the nonce binds the id and the
    /// terms, so the authorization can only open exactly what the payer signed.
    function openWithAuthorization(
        Terms calldata t, address from, uint128 initialFunding, Authorization calldata a
    ) external nonReentrant returns (uint256 id) {
        id = nextId;
        if (a.nonce != openAuthNonce(id, t)) revert BadAuthorizationNonce();
        _open(t, from, initialFunding);
        USDC.receiveWithAuthorization(from, address(this), initialFunding,
                                      a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    /// Anyone may top up any live obligation.
    function fund(uint256 id, uint128 amount) external nonReentrant {
        _credit(id, amount, msg.sender);
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    function fundAuthNonce(uint256 id, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(FUND_AUTH_TAG, address(this), id, salt));
    }

    /// EIP-3009 top-up. The nonce commits to the id; a fresh `salt` makes each
    /// top-up's nonce unique.
    function fundWithAuthorization(
        uint256 id, address from, uint128 value, bytes32 salt, Authorization calldata a
    ) external nonReentrant {
        if (a.nonce != fundAuthNonce(id, salt)) revert BadAuthorizationNonce();
        _credit(id, value, from);
        USDC.receiveWithAuthorization(from, address(this), value,
                                      a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
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
        // One period must be payable *with* its executor fee, or the first
        // execute would pay the beneficiary and leave the executor nothing.
        // Matches the runway formula in §6.3.
        if (uint256(initialFunding) < uint256(t.amountPerPeriod) + t.maxExecutorFee) {
            revert InsufficientInitialFunding();
        }

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

        // ---- the Arc-specific refusal. §1.3, §2.3 ----
        // A transfer to a blocklisted address reverts, consumes gas, and produces
        // no receipt. Read first; it is free.
        if (USDC.isBlacklisted(o.beneficiary)) {
            o.state = State.Quarantined;
            emit Quarantined(id, o.beneficiary, uint64(block.timestamp));
            _payExecutor(id, o, gasStart);       // paid, because this advanced state
            return;
        }

        uint128 amt = o.amountPerPeriod;
        // Reserve the executor fee alongside the payment. Without this the last
        // period of every obligation pays the beneficiary in full and leaves the
        // executor nothing, so a rational executor simulates, sees a zero fee
        // and never submits it. §5.5, §6.3.
        if (uint256(o.balance) < uint256(amt) + o.maxExecutorFee) revert Underfunded();

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

    /// Cancel and refund the payer. Active or Quarantined.
    function cancelByPq(uint256 id, uint64 deadline, bytes calldata pqSig) external nonReentrant {
        Obligation storage o = obligations[id];
        _requireLive(o);
        _requirePq(id, o, Action.Cancel, "", deadline, pqSig);
        _refundAndClose(id, o, true);
    }

    /// Replace the key card. Signed by the key being replaced. Active or Quarantined.
    function rotateKey(uint256 id, bytes32 newPqKey, uint64 deadline, bytes calldata pqSig)
        external nonReentrant
    {
        Obligation storage o = obligations[id];
        _requireLive(o);
        if (newPqKey == bytes32(0)) revert InvalidPqKey();
        uint64 nonce = o.pqNonce;
        _requirePq(id, o, Action.RotateKey, abi.encode(newPqKey), deadline, pqSig);
        o.pqKey = newPqKey;
        emit KeyRotated(id, newPqKey, nonce);
    }

    /// Point a quarantined obligation at a successor, or cancel it with address(0).
    /// nextDueAt is untouched, so the period that triggered quarantine is paid
    /// to the successor on the next execute.
    function resolveQuarantine(uint256 id, address newBeneficiary, uint64 deadline, bytes calldata pqSig)
        external nonReentrant
    {
        Obligation storage o = obligations[id];
        if (o.state != State.Quarantined) revert NotQuarantined();
        if (newBeneficiary != address(0)) _checkBeneficiary(newBeneficiary);

        _requirePq(id, o, Action.ResolveQuarantine, abi.encode(newBeneficiary), deadline, pqSig);

        emit QuarantineResolved(id, newBeneficiary);
        if (newBeneficiary == address(0)) {
            _refundAndClose(id, o, true);
        } else {
            o.beneficiary = newBeneficiary;
            o.state       = State.Active;
        }
    }

    /// Stop a pending wallet cancel. §5.7.
    function vetoWalletCancel(uint256 id, uint64 deadline, bytes calldata pqSig) external nonReentrant {
        Obligation storage o = obligations[id];
        _requireLive(o);
        if (o.cancelReadyAt == 0) revert NoCancelPending();
        uint64 nonce = o.pqNonce;
        _requirePq(id, o, Action.VetoWalletCancel, "", deadline, pqSig);
        o.cancelReadyAt = 0;
        emit WalletCancelVetoed(id, nonce);
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

    // ---------------------------------------------------------------- lost-key backstop (§5.7)

    /// Payer starts a 30-day cancel. Payments continue; the key card can veto.
    /// Calling again restarts the 30 days.
    function beginWalletCancel(uint256 id) external nonReentrant {
        Obligation storage o = obligations[id];
        if (msg.sender != o.payer) revert NotPayer();
        _requireLive(o);
        o.cancelReadyAt = uint64(block.timestamp) + WALLET_CANCEL_DELAY;
        emit WalletCancelBegun(id, o.cancelReadyAt);
    }

    function finalizeWalletCancel(uint256 id) external nonReentrant {
        Obligation storage o = obligations[id];
        if (msg.sender != o.payer) revert NotPayer();
        _requireLive(o);
        if (o.cancelReadyAt == 0) revert NoCancelPending();
        if (block.timestamp < o.cancelReadyAt) revert CancelNotReady();
        _refundAndClose(id, o, false);
    }

    /// After endTime + grace, the payer recovers whatever is left. A Completed
    /// obligation stays Completed; a live one becomes Cancelled. §5.8.
    function reclaim(uint256 id) external nonReentrant {
        Obligation storage o = obligations[id];
        if (msg.sender != o.payer) revert NotPayer();
        if (o.state != State.Active && o.state != State.Quarantined && o.state != State.Completed) {
            revert NotActive();
        }
        if (block.timestamp < uint256(o.endTime) + RECLAIM_GRACE) revert TooEarly();
        if (o.state != State.Completed) o.state = State.Cancelled;
        emit Reclaimed(id, _refundPayer(o));
    }

    function _refundAndClose(uint256 id, Obligation storage o, bool byPq) private {
        o.state = State.Cancelled;
        emit Cancelled(id, _refundPayer(o), byPq);
    }

    /// Sends the whole balance to the payer. Refunds to a frozen payer revert
    /// (§5.7): checked first so the caller gets a typed error, not a gas burn.
    function _refundPayer(Obligation storage o) private returns (uint128 amt) {
        if (USDC.isBlacklisted(o.payer)) revert PayerBlacklisted();
        amt             = o.balance;
        o.balance       = 0;
        o.cancelReadyAt = 0;
        totalCommitted -= amt;
        if (amt > 0 && !USDC.transfer(o.payer, amt)) revert TransferFailed();
    }

    // ---------------------------------------------------------------- term checks

    function _requireLive(Obligation storage o) private view {
        if (o.state != State.Active && o.state != State.Quarantined) revert NotActive();
    }

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
