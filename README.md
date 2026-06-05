# Provenant

**A proof-gated escrow on Sui. Agents get paid because they can prove how they decided.**

---

## What it is

Provenant is a smart-contract framework that turns agent accountability into a payment condition. A principal locks USDC in a shared Sui escrow object and specifies a task. An AI agent performs the task — but every decision it makes is encrypted with [Seal](https://seal.mystenlabs.com/), stored as a [Walrus](https://walrus.xyz/) blob, and keccak256-committed on-chain before the next step begins. When the trail is complete, the agent finalizes its submission. The principal verifies that every commitment matches its blob, uses their Seal session key to decrypt the private reasoning, and approves — at which point the smart contract releases the USDC automatically and increments the agent's on-chain reputation record.

There is no trusted intermediary and no "just trust me." The proof trail is cryptographically bound to the payment: tamper any blob and the commitment check fails; skip a node and the trail is incomplete; forge a node without the Seal key and decryption fails. Each settled task increments the agent's `AgentRecord` — a verifiable reputation object that accumulates across delegations. The escrow contract, the Walrus blobs, and the Seal encryption are all independently verifiable, and every layer is auditable without any privileged access.

---

## Live testnet deployment

| Object | ID |
|---|---|
| **Escrow package** | [`0x22e1c6fb79aaa2256e133b05b4e3d4a825640e3130cc0da6ff114ffd8a149d88`](https://suiscan.xyz/testnet/object/0x22e1c6fb79aaa2256e133b05b4e3d4a825640e3130cc0da6ff114ffd8a149d88) |
| **AgentRegistry** | [`0x337d0584d1cf2f338e318deeddb67f0a9303fcc5961804b607170dc3e076eca1`](https://suiscan.xyz/testnet/object/0x337d0584d1cf2f338e318deeddb67f0a9303fcc5961804b607170dc3e076eca1) |
| **Settled delegation** | [`0x802fc79d0fbdc357d2527930de6fb118d41ce9910527a377d00bffdec632abe3`](https://suiscan.xyz/testnet/object/0x802fc79d0fbdc357d2527930de6fb118d41ce9910527a377d00bffdec632abe3) |
| **AgentRecord** | [`0x1c70d143829de903821f74bd7c0cb53526d213072313b2efc9da217194290dd2`](https://suiscan.xyz/testnet/object/0x1c70d143829de903821f74bd7c0cb53526d213072313b2efc9da217194290dd2) |
| **Settlement tx** | [`9s5nckT4MG2RAwNGYue6xabFdPzs2vUcGrdtmVzVdxww`](https://suiscan.xyz/testnet/tx/9s5nckT4MG2RAwNGYue6xabFdPzs2vUcGrdtmVzVdxww) |
| **Seal package (testnet)** | [`0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3`](https://suiscan.xyz/testnet/object/0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3) |
| **Network** | Sui testnet · testnet USDC |
| **Inspector** | `npm run dev` → [http://localhost:3000/inspector](http://localhost:3000/inspector) |

---

## Tech stack

| Layer | Role |
|---|---|
| **[Sui](https://sui.io)** (Move 2024) | Shared escrow object, `FUNDED → CLAIMED → SUBMITTED → SETTLED` state machine, on-chain keccak256 commitment anchoring, `AgentRecord` reputation tracking via dynamic object fields, `seal_approve_node` IBE policy |
| **[Walrus](https://walrus.xyz)** (testnet) | Decentralised blob storage for Seal-encrypted decision-node payloads. Content-addressed and tamper-evident — retrieve any blob by ID and re-hash to verify. 5-epoch retention (~10 weeks). |
| **[Seal](https://seal.mystenlabs.com)** | IBE threshold encryption over BLS12-381. Each decision node is encrypted independently with a unique identity. Decryption requires the principal to pass the on-chain `seal_approve_node` policy dry-run — the key server only releases key shares if the policy approves. |
| **[Tatum](https://tatum.io)** | Sui RPC gateway used by the agent for all on-chain reads. Every `suix_getAllBalances` and `sui_getObject` call is logged verbatim as a `data_inputs` entry in the decision trail. |
| **[Next.js](https://nextjs.org)** 16 + Tailwind | Inspector frontend — reads delegation state from Tatum, renders the full decision trail with Walrus blob IDs and keccak256 commitments, calls `/api/decrypt` to reveal Seal-encrypted node payloads on demand. |

---

## How to run end-to-end

### Prerequisites

- Node.js ≥ 18
- `sui` CLI on PATH — install via [suiup](https://github.com/MystenLabs/suiup)
- A `.env` file at the project root — copy `env.example` and fill in your keys
- A Sui testnet wallet with SUI (gas) and testnet USDC

```sh
# 0 — Install dependencies
npm install

# 1 — Verify environment: Tatum RPC, Walrus round-trip, Seal, mock delegation
npm run preflight

# 2 — Principal creates a delegation and locks 1 USDC in the escrow contract
cd packages/agent
npx tsx src/create_delegation.ts
# Copy the printed DELEGATION_OBJECT_ID into .env before continuing

# 3 — Agent performs the treasury analysis
#     Claim → Seal-encrypt 3 decision nodes → PUT to Walrus
#     → keccak256-commit on-chain → finalize submission
npx tsx src/agent.ts

# 4 — Principal verifies every commitment, inspects task criteria, settles escrow
#     Calls verify_and_settle → 1 USDC released → AgentRecord.tasks_completed++
npx tsx src/verify_and_settle.ts

# 5 — Open the inspector to decrypt and read the private reasoning
cd ../..
npm run dev
# Open http://localhost:3000/inspector
# Click "Reveal" on each node to Seal-decrypt the private decision payload
```

---

## Build order

| Step | What is built | Entry point |
|---|---|---|
| **0 — Preflight** | Environment check: Tatum RPC, Walrus PUT/GET, Seal stub, mock Delegation | `npm run preflight` |
| **1 — Move contract** | `Delegation<T>`, `AgentRecord`, `AgentRegistry`, `seal_approve_node` policy deployed to testnet | `sui client publish` in `packages/contracts/` |
| **2 — Seal encryption** | Real IBE encrypt via `@mysten/seal` wired into trail pipeline (`SEAL_STUB=false`) | `packages/agent/src/seal.ts` |
| **3 — Agent runtime** | Full treasury analysis: claim → encrypt → store → commit → finalize | `packages/agent/src/agent.ts` |
| **4 — Frontend** | Next.js inspector: delegation state, per-node Seal decrypt, settlement panel | `src/app/inspector/page.tsx` + API routes |
| **5 — Full E2E** | End-to-end run with real USDC settlement and on-chain AgentRecord verification | `create_delegation → agent → verify_and_settle` |

---

## Repository layout

```
provenant/
├── packages/
│   ├── contracts/
│   │   └── sources/escrow.move        Delegation<T>, AgentRecord, AgentRegistry, seal_approve_node
│   └── agent/src/
│       ├── preflight.ts               Step 0 — environment check
│       ├── create_delegation.ts       Fund a new Delegation on-chain
│       ├── seal.ts                    SealClient factory + IBE encrypt
│       ├── walrus.ts                  Walrus PUT / GET helpers
│       ├── trail.ts                   Per-node commit pipeline (Seal → Walrus → keccak256 → chain)
│       ├── agent.ts                   Treasury analysis agent runtime
│       └── verify_and_settle.ts       Verify commitments + settle + inspect AgentRecord
└── src/app/
    ├── page.tsx                       Landing page
    ├── inspector/page.tsx             Decision-trail inspector UI
    └── api/
        ├── delegation/route.ts        Reads Delegation object via Tatum
        ├── decrypt/route.ts           Seal-decrypts a node blob via key servers
        └── settle/route.ts            Calls verify_and_settle from the browser
```

---

## How the proof works

```
Principal                Agent                    Seal key servers      Walrus / Sui
    │                       │                             │                   │
    │  create_and_fund()    │                             │                   │
    │──────────────────────►│ [1 USDC locked on-chain]   │                   │
    │                       │                             │                   │
    │                       │  claim()                    │                   │
    │                       │─────────────────────────────────────────────── ►│
    │                       │                             │                   │
    │                    for each decision node:          │                   │
    │                       │  IBE encrypt(payload, id)   │                   │
    │                       │────────────────────────────►│ (fetch pub keys)  │
    │                       │  ◄─ encryptedObject         │                   │
    │                       │  PUT blob ──────────────────────────────────── ►│
    │                       │  ◄─ blob_id                                     │
    │                       │  commitment = keccak256(blob)                   │
    │                       │  append_node(blob_id, encryption_id, commitment)│
    │                       │─────────────────────────────────────────────── ►│ Sui tx
    │                       │                             │                   │
    │                       │  finalize_submission()      │                   │
    │                       │─────────────────────────────────────────────── ►│ Sui tx
    │                       │                             │                   │
    │  fetch each blob ─────────────────────────────────────────────────────►│
    │  keccak256 == on-chain commitment? ✓ (all 3 nodes)  │                   │
    │                       │                             │                   │
    │  Seal decrypt — reveal private reasoning            │                   │
    │─────────────────────────────────────────────────── ►│ seal_approve_node │
    │                       │                             │  dry-run on Sui   │
    │                       │                             │ ─► key shares     │
    │  IBE decrypt → plaintext payload                    │                   │
    │                       │                             │                   │
    │  verify_and_settle()  │                             │                   │
    │──────────────────────────────────────────────────────────────────────── ►│ Sui tx
    │  [1 USDC → agent]     │                             │                   │
    │  [AgentRecord.tasks_completed++]                    │                   │
```

---

*The agent got paid because it could prove how it decided — and only the principal could see the private reasoning.*
