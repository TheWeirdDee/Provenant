module provenant::escrow {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin, Balance};
    use sui::clock::{Self, Clock};
    use sui::event;

    // ─── USDC coin type (testnet) ─────────────────────────────────────────────
    // Swap for mainnet address before mainnet deploy
    // use 0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC;

    // ─── Status constants ─────────────────────────────────────────────────────
    const STATUS_FUNDED: u8    = 0;
    const STATUS_CLAIMED: u8   = 1;
    const STATUS_SUBMITTED: u8 = 2;
    const STATUS_SETTLED: u8   = 3;
    const STATUS_REFUNDED: u8  = 4;
    const STATUS_DISPUTED: u8  = 5;

    // ─── Error codes ──────────────────────────────────────────────────────────
    const E_NOT_PRINCIPAL: u64     = 1;
    const E_NOT_AGENT: u64         = 2;
    const E_WRONG_STATUS: u64      = 3;
    const E_DEADLINE_PASSED: u64   = 4;
    const E_DEADLINE_NOT_PASSED: u64 = 5;
    const E_ALREADY_CLAIMED: u64   = 6;

    // ─── Structs ──────────────────────────────────────────────────────────────

    public struct TrailNode has store, copy, drop {
        index: u64,
        blob_id: vector<u8>,        // Walrus blob ID (Seal-encrypted payload)
        encryption_id: vector<u8>,  // Seal identity: keccak256(delegation_id || index)
        commitment: vector<u8>,     // keccak256(encrypted_node) — tamper anchor
        public_meta: vector<u8>,    // Clear: action/outcome/timestamp JSON
    }

    public struct Delegation<phantom COIN> has key {
        id: UID,
        principal: address,
        agent: address,             // Set on claim; zero address until claimed
        task_spec: vector<u8>,      // Task description (or keccak256 + Walrus blob for large specs)
        criteria_hash: vector<u8>,  // Hash of acceptance criteria
        budget: Balance<COIN>,
        deadline_ms: u64,
        nodes: vector<TrailNode>,
        status: u8,
    }

    public struct AgentRecord has key {
        id: UID,
        agent: address,
        tasks_completed: u64,
        tasks_accepted: u64,
        disputes: u64,
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    public struct DelegationFunded has copy, drop {
        delegation_id: address,
        principal: address,
        budget_amount: u64,
        deadline_ms: u64,
    }

    public struct DelegationClaimed has copy, drop {
        delegation_id: address,
        agent: address,
    }

    public struct TrailNodeAnchored has copy, drop {
        delegation_id: address,
        index: u64,
        blob_id: vector<u8>,
        commitment: vector<u8>,
    }

    public struct DelegationSettled has copy, drop {
        delegation_id: address,
        agent: address,
        amount: u64,
    }

    public struct DelegationRefunded has copy, drop {
        delegation_id: address,
        principal: address,
        amount: u64,
    }

    // ─── Entry functions ──────────────────────────────────────────────────────

    /// Principal creates and funds a delegation in a single PTB.
    public entry fun create_and_fund<COIN>(
        payment: Coin<COIN>,
        task_spec: vector<u8>,
        criteria_hash: vector<u8>,
        deadline_ms: u64,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        let delegation = Delegation<COIN> {
            id: object::new(ctx),
            principal: tx_context::sender(ctx),
            agent: @0x0,
            task_spec,
            criteria_hash,
            budget: coin::into_balance(payment),
            deadline_ms,
            nodes: vector::empty(),
            status: STATUS_FUNDED,
        };

        event::emit(DelegationFunded {
            delegation_id: object::uid_to_address(&delegation.id),
            principal: tx_context::sender(ctx),
            budget_amount: amount,
            deadline_ms,
        });

        transfer::share_object(delegation);
    }

    /// Agent claims an open delegation.
    public entry fun claim<COIN>(
        delegation: &mut Delegation<COIN>,
        ctx: &mut TxContext,
    ) {
        assert!(delegation.status == STATUS_FUNDED, E_WRONG_STATUS);
        assert!(delegation.agent == @0x0, E_ALREADY_CLAIMED);

        delegation.agent = tx_context::sender(ctx);
        delegation.status = STATUS_CLAIMED;

        event::emit(DelegationClaimed {
            delegation_id: object::uid_to_address(&delegation.id),
            agent: tx_context::sender(ctx),
        });
    }

    /// Agent appends a trail node. Called once per decision node.
    public entry fun submit_node<COIN>(
        delegation: &mut Delegation<COIN>,
        index: u64,
        blob_id: vector<u8>,
        encryption_id: vector<u8>,
        commitment: vector<u8>,
        public_meta: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(
            delegation.status == STATUS_CLAIMED || delegation.status == STATUS_SUBMITTED,
            E_WRONG_STATUS
        );
        assert!(tx_context::sender(ctx) == delegation.agent, E_NOT_AGENT);

        let node = TrailNode { index, blob_id, encryption_id, commitment, public_meta };
        vector::push_back(&mut delegation.nodes, node);
        delegation.status = STATUS_SUBMITTED;

        event::emit(TrailNodeAnchored {
            delegation_id: object::uid_to_address(&delegation.id),
            index,
            blob_id,
            commitment,
        });
    }

    /// Principal verifies trail off-chain and authorizes release.
    public entry fun verify_and_settle<COIN>(
        delegation: &mut Delegation<COIN>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(delegation.status == STATUS_SUBMITTED, E_WRONG_STATUS);
        assert!(tx_context::sender(ctx) == delegation.principal, E_NOT_PRINCIPAL);
        assert!(clock::timestamp_ms(clock) <= delegation.deadline_ms, E_DEADLINE_PASSED);

        let amount = sui::balance::value(&delegation.budget);
        let payout = coin::from_balance(
            sui::balance::split(&mut delegation.budget, amount),
            ctx,
        );
        transfer::public_transfer(payout, delegation.agent);
        delegation.status = STATUS_SETTLED;

        event::emit(DelegationSettled {
            delegation_id: object::uid_to_address(&delegation.id),
            agent: delegation.agent,
            amount,
        });
    }

    /// Refund principal if deadline has passed with no valid submission.
    public entry fun refund_on_timeout<COIN>(
        delegation: &mut Delegation<COIN>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(
            delegation.status == STATUS_FUNDED
            || delegation.status == STATUS_CLAIMED
            || delegation.status == STATUS_SUBMITTED,
            E_WRONG_STATUS
        );
        assert!(clock::timestamp_ms(clock) > delegation.deadline_ms, E_DEADLINE_NOT_PASSED);

        let amount = sui::balance::value(&delegation.budget);
        let refund = coin::from_balance(
            sui::balance::split(&mut delegation.budget, amount),
            ctx,
        );
        transfer::public_transfer(refund, delegation.principal);
        delegation.status = STATUS_REFUNDED;

        event::emit(DelegationRefunded {
            delegation_id: object::uid_to_address(&delegation.id),
            principal: delegation.principal,
            amount,
        });
    }

    /// Principal raises a dispute.
    public entry fun dispute<COIN>(
        delegation: &mut Delegation<COIN>,
        ctx: &mut TxContext,
    ) {
        assert!(delegation.status == STATUS_SUBMITTED, E_WRONG_STATUS);
        assert!(tx_context::sender(ctx) == delegation.principal, E_NOT_PRINCIPAL);
        delegation.status = STATUS_DISPUTED;
    }

    // ─── Seal access policy ───────────────────────────────────────────────────
    // Called by Seal key servers via dry-run to gate decryption.
    // The encryption_id must match a node in this delegation,
    // and only the principal can decrypt.

    public fun seal_approve_node<COIN>(
        id: vector<u8>,
        delegation: &Delegation<COIN>,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == delegation.principal, E_NOT_PRINCIPAL);
        // Verify id matches a registered encryption_id in the trail
        let i = 0u64;
        let len = vector::length(&delegation.nodes);
        let found = false;
        while (i < len) {
            let node = vector::borrow(&delegation.nodes, i);
            if (node.encryption_id == id) {
                found = true;
                break
            };
            i = i + 1;
        };
        assert!(found, E_NOT_PRINCIPAL);
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public fun status<COIN>(d: &Delegation<COIN>): u8 { d.status }
    public fun principal<COIN>(d: &Delegation<COIN>): address { d.principal }
    public fun agent<COIN>(d: &Delegation<COIN>): address { d.agent }
    public fun node_count<COIN>(d: &Delegation<COIN>): u64 { vector::length(&d.nodes) }
}
