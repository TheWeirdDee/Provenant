/// Provenant escrow — proof-gated delegation with decision trail.
/// Generic over coin type T so callers pass the USDC coin directly;
/// no USDC package dependency needed in Move.toml.
module provenant::escrow {
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::dynamic_object_field;
    use sui::event;

    // ── Status ───────────────────────────────────────────────────────────────
    const FUNDED:    u8 = 0;
    const CLAIMED:   u8 = 1;
    const SUBMITTED: u8 = 2;
    const SETTLED:   u8 = 3;
    const REFUNDED:  u8 = 4;
    const DISPUTED:  u8 = 5;

    // ── Errors ───────────────────────────────────────────────────────────────
    const ENotPrincipal:      u64 = 1;
    const ENotAgent:          u64 = 2;
    const EWrongStatus:       u64 = 3;
    const EDeadlinePassed:    u64 = 4;
    const EDeadlineNotReached: u64 = 5;

    // ── Structs ──────────────────────────────────────────────────────────────

    /// One decision node committed to the on-chain trail.
    public struct TrailNode has store, drop {
        index:         u64,
        blob_id:       vector<u8>,   // Walrus blob (Seal-encrypted payload)
        encryption_id: vector<u8>,   // Seal identity for this node
        commitment:    vector<u8>,   // keccak256 of the encrypted blob
        public_meta:   vector<u8>,   // clear: action/outcome/timestamp summary
    }

    /// Shared object — funds locked here until settled or refunded.
    public struct Delegation<phantom T> has key {
        id:            UID,
        principal:     address,
        agent:         address,
        task_spec:     vector<u8>,
        criteria_hash: vector<u8>,
        budget:        Balance<T>,
        deadline_ms:   u64,
        nodes:         vector<TrailNode>,
        status:        u8,
    }

    /// Per-agent reputation record.
    /// Stored as a dynamic object field of AgentRegistry, keyed by agent address.
    public struct AgentRecord has key, store {
        id:              UID,
        agent:           address,
        tasks_completed: u64,   // incremented on every successful verify_and_settle
        tasks_accepted:  u64,   // incremented when agent claims + settles
        disputes:        u64,   // incremented on dispute
    }

    /// Shared singleton registry — holds AgentRecord objects as dynamic fields.
    /// Created once by `init` at deploy time.
    public struct AgentRegistry has key {
        id: UID,
    }

    // ── Events ───────────────────────────────────────────────────────────────

    public struct DelegationCreated has copy, drop {
        delegation_id: ID,
        principal:     address,
        budget:        u64,
        deadline_ms:   u64,
    }

    public struct DelegationClaimed has copy, drop {
        delegation_id: ID,
        agent:         address,
    }

    public struct NodeAppended has copy, drop {
        delegation_id: ID,
        index:         u64,
    }

    public struct TrailSubmitted has copy, drop {
        delegation_id: ID,
        node_count:    u64,
    }

    public struct DelegationSettled has copy, drop {
        delegation_id: ID,
        agent:         address,
        amount:        u64,
    }

    public struct DelegationRefunded has copy, drop {
        delegation_id: ID,
        principal:     address,
        amount:        u64,
    }

    public struct AgentRecordUpdated has copy, drop {
        agent:           address,
        tasks_completed: u64,
        tasks_accepted:  u64,
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    /// Called once at package publish — creates and shares the AgentRegistry.
    fun init(ctx: &mut TxContext) {
        transfer::share_object(AgentRegistry { id: object::new(ctx) });
    }

    // ── Entry functions ──────────────────────────────────────────────────────

    /// Principal creates a delegation and locks funds in the shared object.
    public entry fun create_and_fund<T>(
        payment:       Coin<T>,
        task_spec:     vector<u8>,
        criteria_hash: vector<u8>,
        deadline_ms:   u64,
        ctx:           &mut TxContext,
    ) {
        let sender        = ctx.sender();
        let budget_amount = payment.value();
        let delegation    = Delegation<T> {
            id:            object::new(ctx),
            principal:     sender,
            agent:         @0x0,
            task_spec,
            criteria_hash,
            budget:        payment.into_balance(),
            deadline_ms,
            nodes:         vector[],
            status:        FUNDED,
        };
        let delegation_id = object::id(&delegation);
        event::emit(DelegationCreated { delegation_id, principal: sender, budget: budget_amount, deadline_ms });
        transfer::share_object(delegation);
    }

    /// Agent claims the delegation (sets themselves as the executor).
    public entry fun claim<T>(
        delegation: &mut Delegation<T>,
        ctx:        &mut TxContext,
    ) {
        assert!(delegation.status == FUNDED, EWrongStatus);
        delegation.agent  = ctx.sender();
        delegation.status = CLAIMED;
        event::emit(DelegationClaimed { delegation_id: object::id(delegation), agent: ctx.sender() });
    }

    /// Agent appends one decision node. Call once per node (or batch in a PTB).
    public entry fun append_node<T>(
        delegation:    &mut Delegation<T>,
        index:         u64,
        blob_id:       vector<u8>,
        encryption_id: vector<u8>,
        commitment:    vector<u8>,
        public_meta:   vector<u8>,
        ctx:           &mut TxContext,
    ) {
        assert!(delegation.status == CLAIMED, EWrongStatus);
        assert!(delegation.agent == ctx.sender(), ENotAgent);
        let delegation_id = object::id(delegation);
        delegation.nodes.push_back(TrailNode { index, blob_id, encryption_id, commitment, public_meta });
        event::emit(NodeAppended { delegation_id, index });
    }

    /// Agent finalises the submission after all nodes are appended.
    public entry fun finalize_submission<T>(
        delegation: &mut Delegation<T>,
        ctx:        &mut TxContext,
    ) {
        assert!(delegation.status == CLAIMED, EWrongStatus);
        assert!(delegation.agent == ctx.sender(), ENotAgent);
        let node_count    = delegation.nodes.length();
        delegation.status = SUBMITTED;
        event::emit(TrailSubmitted { delegation_id: object::id(delegation), node_count });
    }

    /// Principal approves the trail; funds released to agent.
    /// Also creates or updates the agent's AgentRecord in the shared registry.
    public entry fun verify_and_settle<T>(
        delegation: &mut Delegation<T>,
        registry:   &mut AgentRegistry,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(delegation.status == SUBMITTED, EWrongStatus);
        assert!(delegation.principal == ctx.sender(), ENotPrincipal);
        assert!(clock::timestamp_ms(clock) <= delegation.deadline_ms, EDeadlinePassed);

        delegation.status = SETTLED;
        let agent  = delegation.agent;
        let amount = balance::value(&delegation.budget);
        let payout = coin::from_balance(balance::withdraw_all(&mut delegation.budget), ctx);
        event::emit(DelegationSettled { delegation_id: object::id(delegation), agent, amount });
        transfer::public_transfer(payout, agent);

        // Create or update the agent's reputation record.
        if (dynamic_object_field::exists_<address>(&registry.id, agent)) {
            let record: &mut AgentRecord = dynamic_object_field::borrow_mut(&mut registry.id, agent);
            record.tasks_completed = record.tasks_completed + 1;
            record.tasks_accepted  = record.tasks_accepted  + 1;
            event::emit(AgentRecordUpdated {
                agent,
                tasks_completed: record.tasks_completed,
                tasks_accepted:  record.tasks_accepted,
            });
        } else {
            dynamic_object_field::add(&mut registry.id, agent, AgentRecord {
                id:              object::new(ctx),
                agent,
                tasks_completed: 1,
                tasks_accepted:  1,
                disputes:        0,
            });
            event::emit(AgentRecordUpdated { agent, tasks_completed: 1, tasks_accepted: 1 });
        };
    }

    /// Anyone can trigger a refund once the deadline has passed without settlement.
    public entry fun refund_on_timeout<T>(
        delegation: &mut Delegation<T>,
        clock:      &Clock,
        ctx:        &mut TxContext,
    ) {
        assert!(delegation.status != SETTLED && delegation.status != REFUNDED, EWrongStatus);
        assert!(clock::timestamp_ms(clock) > delegation.deadline_ms, EDeadlineNotReached);
        delegation.status = REFUNDED;
        let principal = delegation.principal;
        let amount    = balance::value(&delegation.budget);
        let refund    = coin::from_balance(balance::withdraw_all(&mut delegation.budget), ctx);
        event::emit(DelegationRefunded { delegation_id: object::id(delegation), principal, amount });
        transfer::public_transfer(refund, principal);
    }

    /// Principal disputes a submitted trail (funds held; v1 = principal override).
    public entry fun dispute<T>(
        delegation: &mut Delegation<T>,
        registry:   &mut AgentRegistry,
        ctx:        &mut TxContext,
    ) {
        assert!(delegation.status == SUBMITTED, EWrongStatus);
        assert!(delegation.principal == ctx.sender(), ENotPrincipal);
        delegation.status = DISPUTED;
        let agent = delegation.agent;
        if (dynamic_object_field::exists_<address>(&registry.id, agent)) {
            let record: &mut AgentRecord = dynamic_object_field::borrow_mut(&mut registry.id, agent);
            record.disputes = record.disputes + 1;
        };
    }

    // ── Seal policy ──────────────────────────────────────────────────────────

    /// Called by Seal key servers via dry-run to gate decryption to the principal.
    /// MUST have no side effects (dry-runnable).
    public fun seal_approve_node<T>(
        _id:        vector<u8>,
        delegation: &Delegation<T>,
        ctx:        &TxContext,
    ) {
        assert!(delegation.principal == ctx.sender(), ENotPrincipal);
    }
}
