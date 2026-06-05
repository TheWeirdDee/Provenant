# Provenant — Product Requirements

**One-liner:** A proof-gated escrow on Sui. A principal funds an AI agent for a task; the agent's decision trail is stored encrypted on Walrus with per-node selective disclosure via Seal; a commitment is anchored on a Sui object; and the escrow releases USDC only against a verified trail. The agent gets paid because it can prove how it decided — and only the principal can see the private reasoning.

> **Context:** Built on Sui. Walrus and Tatum are first-class dependencies, not add-ons.

---

## 1. Problem & Approach

Once you delegate real authority (and money) to an autonomous agent, the trust question stops being "who are you?" and becomes "why did you do that?" Today the answer is screenshots and self-reported logs — fragile and gameable.

Provenant makes the proof native: an agent's decision history becomes the artifact that unlocks payment. Each decision records the memory, data, permissions, and outcome behind an action. The sensitive parts stay encrypted but are selectively inspectable by the principal, and settlement is gated on the trail checking out.

**The stack is load-bearing:**

- **Walrus** stores the decision-node payloads (potentially large: context, source data, reasoning) durably, content-addressably, and tamper-evidently.
- **Seal** encrypts each node and gates decryption to the principal via an on-chain policy — auditable yet private.
- **Sui** holds the escrow, the ownership, the commitment anchor, and the programmable settlement logic.
- **Tatum** is how the agent reads live chain state (and how the system verifies on-chain claims), via RPC, Data API, and MCP.

Remove any one and the capability degrades to "cheaper logging" or "trust me."

---

## 2. Core User Story

A principal wants an agent to perform a real task (default: treasury analysis + a rebalance recommendation) and will pay for it — but only if the agent can show why it decided what it did, with sensitive parts private. Provenant turns that proof into the thing that releases the escrow.

---

## 3. Actors

| Actor | Role |
|-------|------|
| **Principal** | Human/org. Creates and funds a delegation, sets acceptance criteria + the Seal access policy, inspects the trail, approves or disputes. |
| **Agent** | TypeScript AI agent. Performs the task, emits a decision node per significant action, encrypts + stores each node, anchors commitments on Sui, submits for settlement. |
| **Verifier** | v1 is the principal: machine-checkable criteria are validated automatically; content is inspected via selective decrypt; the principal authorizes release. (Third-party arbiter is out of scope for v1.) |

---

## 4. Architecture & Data Flow

### Happy Path

1. **Create + fund delegation.** Principal calls the escrow contract: `task_spec`, `criteria_hash`, `budget` (USDC), `seal_policy` reference, `deadline`. Funds lock in escrow; a `Delegation` Sui object is created (`status: Funded`).

2. **Agent executes.** Agent claims the delegation and performs the task. For each significant action it builds a decision node:
   ```
   { memory_used, data_inputs (incl. chain reads via Tatum MCP), active_policies, action, outcome, timestamp }
   ```

3. **Encrypt per node + store.** Each node's sensitive payload is Seal-encrypted under a unique `encryption_id` (e.g. `hash(delegation_id || node_index)`), then stored as its own Walrus blob → `blob_id`. A small public skeleton (action/outcome/timestamp + which prior nodes/data it referenced) stays in clear so the graph is auditable without decryption.

4. **Anchor commitments.** Agent appends to the `Delegation` object a `TrailNode` per node: `{ index, blob_id, encryption_id, commitment = keccak256(encrypted_node), public_meta }`. Status → `Submitted`. This binds exactly which blobs belong to this delegation, immutably.

5. **Verify.** The principal:
   - (a) Recomputes each commitment from the retrieved Walrus blob (tamper check)
   - (b) Validates machine-checkable criteria — e.g. confirms any on-chain action the agent claims actually happened, via Tatum Data API
   - (c) Selectively decrypts the nodes they want to inspect through the Seal policy

6. **Settle.** Trail valid + principal approves → escrow releases funds to the agent; `AgentRecord` increments. Status → `Settled`.

### Selective Disclosure Model

Seal decryption is all-or-nothing per encrypted identity, so each node is encrypted independently as its own blob. The principal can decrypt node `k` (via its `seal_approve` policy) without touching the others. The public skeleton renders the full decision graph to anyone; the encrypted payloads require the policy to reveal. This is the supported, recommended Seal + Walrus pattern.

### Failure & Edge States

| State | Trigger | Behavior |
|-------|---------|----------|
| Timeout | No submission before deadline | Escrow refunds principal |
| Missing/partial trail | Submitted with missing nodes | Verification fails → no payout |
| Tamper | `keccak256(retrieved blob) != committed` | Rejected; funds held |
| Seal failure | Policy/`encryption_id` mismatch, `SessionKey` expired | Inspection blocked → re-approve / dispute |
| Blob expired | Walrus epochs lapsed | Unverifiable; mitigation: buy buffer epochs or `permanent=true` |
| Dispute | Principal rejects despite valid trail | Funds held; v1 = principal override window |
| Partial work | Milestone delivery | Out of scope v1 (all-or-nothing) |

---

## 5. Target Demo (Acceptance Scenario)

On a completed delegation, the principal opens the inspector:

- The decision graph renders from the public skeleton (nodes + edges: which memory/data fed which action)
- Principal clicks a private reasoning node → a `SessionKey` + `seal_approve` dry-run runs → that node decrypts live for the authorized principal only; the rest stay sealed
- Principal approves → settlement tx fires on Sui (visible on Explorer) → `AgentRecord` updates

**Target line:** *"The agent got paid because it could prove how it decided — and only the principal could see the private reasoning."*

---

## 6. Tech Stack (Validated, as of late May 2026)

| Layer | Choice |
|-------|--------|
| Contracts | Sui Move (CLI via `suiup`, ~1.4x+) |
| Storage | Walrus — `@mysten/walrus` |
| Encryption / access | Seal — `@mysten/seal` |
| Chain I/O | Tatum Sui RPC + Data API |
| Agent chain reads | Tatum MCP — `@tatumio/blockchain-mcp` (`gateway_execute_rpc`) |
| Agent runtime | TypeScript + an LLM |
| Payments | Native USDC on Sui |
| Frontend | Next.js / React (inspector + delegation flow) |
| Memory (optional, v2) | MemWal — `@mysten-incubation/memwal` |

---

## 7. On-Chain Objects (Move Sketch)

```move
struct TrailNode has store {
  index: u64,
  blob_id: vector<u8>,        // Walrus blob (Seal-encrypted node payload)
  encryption_id: vector<u8>,  // Seal identity for this node
  commitment: vector<u8>,     // keccak256 of the encrypted node
  public_meta: vector<u8>,    // clear: action/outcome/timestamp summary
}

struct Delegation has key {
  id: UID,
  principal: address,
  agent: address,             // set on claim
  task_spec: vector<u8>,      // or hash + a Walrus blob for the full spec
  criteria_hash: vector<u8>,
  budget: Balance<USDC>,
  deadline_ms: u64,
  nodes: vector<TrailNode>,
  status: u8,                 // Funded|Claimed|Submitted|Settled|Refunded|Disputed
}

struct AgentRecord has key {
  id: UID,
  agent: address,
  tasks_completed: u64,
  tasks_accepted: u64,
  disputes: u64,
}

// Seal policy gating decryption to the principal (evaluated by key servers via dry-run)
public fun seal_approve_node(id: vector<u8>, d: &Delegation, ctx: &TxContext) { /* assert sender == d.principal */ }
```

**Entry functions:** `create_and_fund`, `claim`, `submit(nodes)`, `verify_and_settle`, `refund_on_timeout`, `dispute`

---

## 8. Walrus + Seal Integration

### Walrus

```typescript
walrusClient.writeBlob({ blob, epochs, deletable | permanent, signer }) → { blobId, blobObject }
// Or HTTP:
PUT /v1/blobs?epochs=N&deletable=true
GET /v1/blobs/{blobId}
```

- Blobs are Sui objects (carry `blob_id` + a `Storage` resource); store `blob_id` directly in `TrailNode`.
- **Epoch ≈ 2 weeks** (mainnet), max ~53; cost ≈ $0.023/GB/mo (pay WAL + SUI gas).
- Buy buffer epochs or use `permanent=true` so trails outlive the submission/judging window.

### Seal

```typescript
// Configure
SealClient configured from the on-chain KeyServer list
SessionKey (user-signed, short TTL) for decrypt

// Encrypt per node
sealClient.encrypt({ threshold, packageId, id: encryption_id, data })
  → encryptedObject → store on Walrus
// For large payloads: layered encryption (Seal-wrap an AES key; AES-encrypt the data)

// Decrypt
build Transaction calling ${PKG}::escrow::seal_approve_node
  with the node's encryption_id (+ the Delegation)
tx.build({ onlyTransactionKind: true }) → txBytes
sealClient.decrypt({ data: encryptedObject, sessionKey, txBytes })
```

**Package IDs:**
- Testnet: `0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3`
- Mainnet: `0xcb83a248bda5f7a0a431e6bf9e96d184e604130ec5218696e3f1211113b447b7`

---

## 9. Tatum Integration

- **RPC:** `https://sui-mainnet.gateway.tatum.io` / `sui-testnet.gateway.tatum.io`, standard `sui_*` methods. Free key via `dashboard.tatum.io`.
- **Data API:** Balances/portfolio, tx history, metadata — used in verification to confirm the agent's claimed on-chain actions.
- **MCP:** `@tatumio/blockchain-mcp` exposes `gateway_execute_rpc` (run any Sui RPC method), `gateway_get_supported_methods`, `gateway_get_supported_chains`. The TS agent uses these to read Sui objects (escrow state, commitments, balances) during reasoning; those reads are logged as `data_inputs` on the relevant decision node.

> Sui is deprecating JSON-RPC in favor of gRPC/GraphQL; routing through the Tatum gateway insulates the build from that churn.

---

## 10. Payments

**USDC coin types (native Circle, live on Sui since Oct 2024):**

- Mainnet: `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`
- Testnet: `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`

**Escrow:** Shared `Delegation` object holding `Balance<USDC>` with a state machine; lock via an entry fn taking a `Coin<USDC>`; conditional release/refund; emit events for off-chain indexing. Lock + object creation in a single PTB.

**Settlement:** The contract enforces escrow integrity, commitment integrity, and deadlines. Content verification is performed off-chain by the principal (Seal decrypt + commitment match + criteria check via Tatum Data API), who then authorizes the on-chain release.

---

## 11. Build Order

| Step | Task |
|------|------|
| **0** | **Environment + integration setup.** Tatum key + Sui RPC wired; Walrus store/retrieve roundtrip working; Seal encrypt → policy-gated decrypt working with a throwaway policy; USDC coin type + a funded test wallet. Pick the working network (testnet for iteration). |
| **1** | **Escrow + delegation contract** — fund, claim, refund-on-timeout (the money spine first). |
| **2** | **Per-node trail commit** — Seal-encrypt a node → Walrus blob → append `TrailNode` to `Delegation`; verify commitment ↔ blob; tamper rejection. |
| **3** | **Agent runtime** — LLM agent performs the task, reads chain via Tatum MCP, emits + commits the node trail. |
| **4** | **Verification + settlement** — criteria check (Tatum Data API), selective decrypt to principal, release/refund. |
| **5** | **Inspector UI + live decrypt** — graph from public skeleton, click-to-decrypt a node, settle button. |
| **6** | **Real on-chain activity + submission** — deploy, publish package IDs, demo video (lead with inspect → decrypt → settle), README. Target mainnet for submission if stable; otherwise testnet with real activity. |

---

## 12. Definition of Done

- Real Sui escrow with real USDC moving (fund, settle, refund-on-timeout), verifiable on Explorer.
- Real Walrus blobs (real `blob_id`s, retrievable); real Seal per-node encryption with working selective decrypt.
- Agent genuinely reads chain via Tatum (RPC + MCP); those reads appear in the trail.
- Tamper check rejects a mismatched commitment.
- Working end-to-end demo, no stubbed layers, no hollow UI. Package IDs published.

---

## 13. Implementation Notes & Pitfalls

1. **Seal identity & session hygiene.** `encryption_id` must match exactly between encrypt and the `seal_approve` call; `SessionKey` TTL expiry requires re-approval; `seal_approve*` must be dry-runnable (no side effects). Mismatches are the most common cause of decrypt failures.

2. **Walrus epoch lifecycle.** Blobs expire; insufficient epochs = data loss mid-judging. Add a buffer or use `permanent=true`; monitor via the on-chain `Blob` / `Storage` objects.

3. **Verify before release.** Anchor commitments (hash + blob IDs) early; ensure off-chain content verification is solid before the release call. Use PTBs where the check is on-chain-expressible.

4. **RPC transport.** Favor the Tatum gateway / gRPC over raw JSON-RPC given the deprecation.

---

## 14. Out of Scope (v2)

- MemWal memory-lineage node (optional, composes cleanly with the Seal + Walrus stack)
- Third-party arbiter + dispute market
- Milestone/partial settlement
- Full agent reputation/credit-score engine (v1 keeps a lightweight `AgentRecord`; the verifiable trail is the defensible core, not a score)
- Multi-agent sub-delegation
- Cross-chain

---

## 15. References

- **Seal:** https://seal-docs.wal.app/UsingSeal · https://docs.sui.io/sui-stack/seal/sui-stack-seal · https://github.com/MystenLabs/seal · [Decentralized Key Server (Mar 2026)](https://blog.sui.io/introducing-decentralized-seal-key-server-testnet/)
- **Walrus:** https://docs.wal.app/ · https://sdk.mystenlabs.com/walrus · https://github.com/MystenLabs/walrus
- **Tatum:** https://tatum.io/mcp · https://github.com/tatumio/blockchain-mcp · https://tatum.io/blog/building-on-sui · https://tatum.io/chain/sui
- **USDC on Sui:** https://www.circle.com/blog/now-available-native-usdc-on-sui · https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui
- **MemWal:** https://github.com/MystenLabs/MemWal
