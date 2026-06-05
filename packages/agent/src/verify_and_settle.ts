/**
 * Step 3 — Verification + Settlement.
 *
 * For each TrailNode in Delegation.nodes[]:
 *   1. Decode blob_id (UTF-8 bytes → string)
 *   2. Fetch blob from Walrus
 *   3. Recompute keccak256(blob) — compare against on-chain commitment
 *   4. Log PASS / FAIL
 *
 * Confirm task criteria:
 *   - portfolio read (Tatum data)
 *   - composition analysis
 *   - rebalance recommendation
 *
 * If all checks pass → call verify_and_settle as principal.
 * Verify final status = 3 (SETTLED) and budget = 0.
 *
 * Run: tsx src/verify_and_settle.ts
 */
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { keccak_256 } from '@noble/hashes/sha3';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const TATUM_API_KEY  = process.env.TATUM_API_KEY!;
const AGENT_KEY      = process.env.AGENT_PRIVATE_KEY!;
const PACKAGE_ID     = process.env.PROVENANT_PACKAGE_ID!;
const DELEGATION_ID  = process.env.DELEGATION_OBJECT_ID!;
const REGISTRY_ID    = process.env.AGENT_REGISTRY_ID!;
const SUI_NETWORK    = process.env.SUI_NETWORK ?? 'testnet';
const WALRUS_AGG     = process.env.WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';

const TATUM_RPC  = `https://sui-${SUI_NETWORK}.gateway.tatum.io`;
const PUBLIC_RPC = `https://fullnode.${SUI_NETWORK}.sui.io:443`;
const USDC_TYPE  = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
// Sui shared Clock object (exists on every Sui network)
const CLOCK_ID   = '0x0000000000000000000000000000000000000000000000000000000000000006';

// ── helpers ───────────────────────────────────────────────────────────────────

function mark(ok: boolean) { return ok ? '✓ PASS' : '✗ FAIL'; }

async function tatumRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(TATUM_RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': TATUM_API_KEY },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Tatum ${method} HTTP ${res.status}`);
  const body = await res.json() as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Tatum RPC: ${body.error.message}`);
  return body.result as T;
}

async function walrusGet(blobId: string): Promise<Buffer> {
  const res = await fetch(`${WALRUS_AGG}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus GET HTTP ${res.status} for ${blobId}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Provenant Verifier  ·  Step 3 — Verify + Settle');
  console.log('══════════════════════════════════════════════════════\n');

  // ── 1. Read Delegation from chain ─────────────────────────────────────────
  console.log('── Reading Delegation from chain (Tatum RPC) ────────────');

  const obj = await tatumRpc<{
    data: {
      content: {
        fields: {
          status:       number;
          budget:       string;
          principal:    string;
          deadline_ms:  string;
          nodes: Array<{
            fields: {
              index:         number;
              blob_id:       number[];
              encryption_id: number[];
              commitment:    number[];
              public_meta:   number[];
            };
          }>;
        };
      };
    };
  }>('sui_getObject', [DELEGATION_ID, { showContent: true }]);

  const fields = obj.data.content.fields;
  console.log(`  status:    ${fields.status}  (0=FUNDED 1=CLAIMED 2=SUBMITTED 3=SETTLED)`);
  console.log(`  budget:    ${fields.budget} (${(Number(fields.budget)/1e6).toFixed(6)} USDC)`);
  console.log(`  principal: ${fields.principal}`);
  console.log(`  nodes:     ${fields.nodes.length}`);

  if (fields.status !== 2) {
    throw new Error(`Delegation status is ${fields.status} — expected 2 (SUBMITTED) before settlement`);
  }
  if (fields.nodes.length === 0) {
    throw new Error('No nodes found in Delegation — cannot verify empty trail');
  }

  // ── 2. Verify each node: fetch blob → recompute keccak256 → compare ───────
  console.log('\n── Commitment verification ──────────────────────────────');

  const results: Array<{
    index:      number;
    blobId:     string;
    onChain:    string;
    recomputed: string;
    pass:       boolean;
    meta:       Record<string, unknown>;
  }> = [];

  for (const node of fields.nodes) {
    const f          = node.fields;
    const blobId     = Buffer.from(f.blob_id).toString('utf-8');
    const onChain    = Buffer.from(f.commitment).toString('hex');
    const metaStr    = Buffer.from(f.public_meta).toString('utf-8');
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(metaStr); } catch { /* keep empty */ }

    process.stdout.write(`  Node ${f.index} (blob=${blobId.slice(0,20)}…)  `);

    let pass = false;
    let recomputed = '';
    try {
      const blob   = await walrusGet(blobId);
      recomputed   = Buffer.from(keccak_256(blob)).toString('hex');
      pass         = recomputed === onChain;
    } catch (e: unknown) {
      recomputed = `FETCH_ERROR: ${(e as Error).message}`;
    }

    console.log(mark(pass));
    if (!pass) {
      console.log(`    on-chain:   ${onChain}`);
      console.log(`    recomputed: ${recomputed}`);
    }

    results.push({ index: f.index, blobId, onChain, recomputed, pass, meta });
  }

  const allPass = results.every(r => r.pass);
  console.log(`\n  ${allPass ? '✓ ALL commitments verified' : '✗ COMMITMENT MISMATCH — settlement blocked'}`);

  if (!allPass) {
    throw new Error('One or more commitment checks failed — cannot settle');
  }

  // ── 3. Confirm task criteria ──────────────────────────────────────────────
  console.log('\n── Task criteria check ──────────────────────────────────');

  // The public_meta action field identifies what each node recorded.
  // De-duplicate by node index (agent ran twice, so we have index 0 twice).
  const seen = new Set<number>();
  const canonical = results.filter(r => {
    if (seen.has(r.index)) return false;
    seen.add(r.index);
    return true;
  });

  const actions = canonical.map(r => String(r.meta['action'] ?? '').toLowerCase());

  const hasPortfolioRead      = actions.some(a => a.includes('read') || a.includes('balance') || a.includes('portfolio'));
  const hasCompositionAnalysis = actions.some(a => a.includes('compos') || a.includes('analys') || a.includes('alloc'));
  const hasRecommendation     = actions.some(a => a.includes('recommend') || a.includes('rebalanc'));

  console.log(`  ${mark(hasPortfolioRead)}       portfolio read (Tatum on-chain data)`);
  console.log(`  ${mark(hasCompositionAnalysis)}  composition analysis`);
  console.log(`  ${mark(hasRecommendation)}    rebalance recommendation`);

  const criteriaPass = hasPortfolioRead && hasCompositionAnalysis && hasRecommendation;
  if (!criteriaPass) {
    throw new Error('Task criteria not fully satisfied — see above');
  }
  console.log('\n  ✓ All task criteria satisfied');

  // ── 4. Call verify_and_settle as principal ────────────────────────────────
  console.log('\n── Calling verify_and_settle ────────────────────────────');
  console.log(`  Releasing 1.00 USDC to agent ${fields.principal}…`);

  const keypair = Ed25519Keypair.fromSecretKey(AGENT_KEY);
  const sender  = keypair.getPublicKey().toSuiAddress();
  const client  = new SuiJsonRpcClient({ network: SUI_NETWORK as "testnet" | "mainnet", url: PUBLIC_RPC });

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(10_000_000);
  if (!REGISTRY_ID) throw new Error('AGENT_REGISTRY_ID missing from .env');
  tx.moveCall({
    target:        `${PACKAGE_ID}::escrow::verify_and_settle`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(DELEGATION_ID),
      tx.object(REGISTRY_ID),
      tx.object(CLOCK_ID),
    ],
  });

  const bytes  = await tx.build({ client });
  const sig    = await keypair.signTransaction(bytes);
  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        sig.signature,
    options:          { showEffects: true, showEvents: true, showBalanceChanges: true },
    requestType:      'WaitForLocalExecution',
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`verify_and_settle failed: ${JSON.stringify(result.effects?.status)}`);
  }

  const settleTx = result.digest;
  console.log(`  ✓ Settlement tx: ${settleTx}`);

  // Log USDC balance change from the tx
  const usdcChange = result.balanceChanges?.find(b => b.coinType?.includes('usdc'));
  if (usdcChange) {
    console.log(`  USDC transfer: ${(Math.abs(Number(usdcChange.amount))/1e6).toFixed(6)} USDC → ${usdcChange.owner}`);
  }

  // ── 5. Final verification: status=3, budget=0 ────────────────────────────
  console.log('\n── Final on-chain state (Tatum RPC) ────────────────────');

  const finalObj = await tatumRpc<{
    data: { content: { fields: { status: number; budget: string } } };
  }>('sui_getObject', [DELEGATION_ID, { showContent: true }]);

  const final = finalObj.data.content.fields;
  const statusPass = final.status === 3;
  const budgetPass = final.budget === '0';

  console.log(`  ${mark(statusPass)}  status = ${final.status}  (expected 3 = SETTLED)`);
  console.log(`  ${mark(budgetPass)}  budget = ${final.budget}  (expected 0 — funds released)`);

  if (!statusPass || !budgetPass) {
    throw new Error('Post-settlement state check failed');
  }

  // ── 6. Verify AgentRecord on-chain ───────────────────────────────────────
  console.log('\n── AgentRecord verification (Tatum RPC) ────────────────');

  const registryFields = await tatumRpc<{
    data: { content: { fields: { id: { id: string } } } };
  }>('sui_getObject', [REGISTRY_ID, { showContent: true }]);
  console.log(`  Registry: ${REGISTRY_ID}`);

  // Fetch the agent's AgentRecord via dynamic field lookup
  const agentRecord = await tatumRpc<{
    data: {
      objectId: string;
      content: {
        fields: {
          agent:           string;
          tasks_completed: string;
          tasks_accepted:  string;
          disputes:        string;
        };
      };
    } | null;
  }>('suix_getDynamicFieldObject', [
    REGISTRY_ID,
    { type: 'address', value: keypair.getPublicKey().toSuiAddress() },
  ]);

  if (!agentRecord.data) {
    throw new Error('AgentRecord not found — verify_and_settle did not create it');
  }
  const ar = agentRecord.data.content.fields;
  console.log(`  AgentRecord: ${agentRecord.data.objectId}`);
  console.log(`    agent:           ${ar.agent}`);
  console.log(`    tasks_completed: ${ar.tasks_completed}`);
  console.log(`    tasks_accepted:  ${ar.tasks_accepted}`);
  console.log(`    disputes:        ${ar.disputes}`);
  console.log(`  ✓ AgentRecord exists and tasks_completed=${ar.tasks_completed}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SETTLEMENT COMPLETE');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Delegation:  ${DELEGATION_ID}`);
  console.log(`  Status:      3 (SETTLED)`);
  console.log(`  Budget:      0 (1.00 USDC released to agent)`);
  console.log(`  Settle tx:   ${settleTx}`);
  console.log(`  AgentRecord: ${agentRecord.data!.objectId}`);
  console.log(`  Explorer:`);
  console.log(`    Delegation: https://suiscan.xyz/${SUI_NETWORK}/object/${DELEGATION_ID}`);
  console.log(`    Registry:   https://suiscan.xyz/${SUI_NETWORK}/object/${REGISTRY_ID}`);
  console.log(`    Tx:         https://suiscan.xyz/${SUI_NETWORK}/tx/${settleTx}`);
  console.log('\n  "The agent got paid because it could prove how it decided."');
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch((e: unknown) => {
  console.error('\n✗ Verification failed:', (e as Error).message);
  process.exit(1);
});

