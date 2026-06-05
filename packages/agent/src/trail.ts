/**
 * Per-node trail commit pipeline:
 *   1. Seal-encrypt payload (stub today)
 *   2. PUT to Walrus → blob_id
 *   3. commitment = keccak256(encrypted bytes)
 *   4. append_node on the Delegation contract
 *   5. Verify: re-fetch blob, recompute hash — reject on mismatch
 */
import { keccak_256 } from '@noble/hashes/sha3';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { computeEncryptionId, sealEncrypt } from './seal.js';
import { walrusPut, walrusGet } from './walrus.js';

// Testnet native USDC — the type parameter for Delegation<T>
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

export interface DecisionNode {
  index:           number;
  memory_used:     string;
  data_inputs:     string[];
  active_policies: string[];
  action:          string;
  outcome:         string;
  timestamp:       string;
}

export interface TrailCommitment {
  nodeIndex:    number;
  blobId:       string;
  encryptionId: string; // hex-encoded 32 bytes
  commitment:   string; // hex-encoded 32 bytes (keccak256)
  txDigest:     string;
}

function log(msg: string) { process.stdout.write(`  ${msg}\n`); }

/**
 * Full commit pipeline for a single decision node.
 * Uses the public Sui fullnode for tx building/execution (Tatum lacks some SDK methods).
 */
export async function commitNode(
  keypair:      Ed25519Keypair,
  packageId:    string,
  delegationId: string,
  node:         DecisionNode,
): Promise<TrailCommitment> {

  // ── 1. Seal encrypt ───────────────────────────────────────────────────────
  log(`[${node.index}] seal-encrypting…`);
  const encId     = computeEncryptionId(delegationId, node.index);
  const encrypted = await sealEncrypt(packageId, encId, node);

  // ── 2. Walrus store ───────────────────────────────────────────────────────
  log(`[${node.index}] storing to Walrus…`);
  const blobId = await walrusPut(encrypted);
  log(`[${node.index}] blob_id = ${blobId}`);

  // ── 3. Commitment = keccak256(encrypted bytes) ────────────────────────────
  const commitment    = keccak_256(encrypted);
  const commitmentHex = Buffer.from(commitment).toString('hex');
  log(`[${node.index}] commitment = ${commitmentHex.slice(0, 16)}…`);

  // ── 4. Public meta (unencrypted skeleton) ─────────────────────────────────
  const publicMeta = Buffer.from(JSON.stringify({
    index:     node.index,
    action:    node.action,
    outcome:   node.outcome,
    timestamp: node.timestamp,
  }), 'utf-8');

  // ── 5. append_node on-chain ───────────────────────────────────────────────
  log(`[${node.index}] anchoring on-chain…`);
  const network   = process.env.SUI_NETWORK ?? 'testnet';
  const client    = new SuiJsonRpcClient({ network: network as 'testnet' | 'mainnet', url: `https://fullnode.${network}.sui.io:443` });
  const sender    = keypair.getPublicKey().toSuiAddress();

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(10_000_000);
  tx.moveCall({
    target:        `${packageId}::escrow::append_node`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(delegationId),
      tx.pure.u64(node.index),
      tx.pure.vector('u8', Array.from(Buffer.from(blobId, 'utf-8'))),
      tx.pure.vector('u8', Array.from(encId)),
      tx.pure.vector('u8', Array.from(commitment)),
      tx.pure.vector('u8', Array.from(publicMeta)),
    ],
  });

  const bytes  = await tx.build({ client });
  const sig    = await keypair.signTransaction(bytes);
  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        sig.signature,
    options:          { showEffects: true },
    requestType:      'WaitForLocalExecution',
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`append_node failed: ${JSON.stringify(result.effects?.status)}`);
  }
  log(`[${node.index}] on-chain ✓  tx=${result.digest}`);

  // ── 6. Verify: re-fetch blob, recompute, compare ──────────────────────────
  log(`[${node.index}] verifying commitment…`);
  const retrieved      = await walrusGet(blobId);
  const recomputed     = keccak_256(retrieved);
  const recomputedHex  = Buffer.from(recomputed).toString('hex');

  if (commitmentHex !== recomputedHex) {
    throw new Error(
      `Commitment mismatch on node ${node.index}:\n  stored   =${commitmentHex}\n  retrieved=${recomputedHex}`,
    );
  }
  log(`[${node.index}] commitment verified ✓`);

  return {
    nodeIndex:    node.index,
    blobId,
    encryptionId: Buffer.from(encId).toString('hex'),
    commitment:   commitmentHex,
    txDigest:     result.digest,
  };
}

/** Call finalize_submission to flip Delegation status → SUBMITTED. */
export async function finalizeSubmission(
  keypair:      Ed25519Keypair,
  packageId:    string,
  delegationId: string,
): Promise<string> {
  log('finalizing submission…');
  const network = process.env.SUI_NETWORK ?? 'testnet';
  const client  = new SuiJsonRpcClient({ network: network as 'testnet' | 'mainnet', url: `https://fullnode.${network}.sui.io:443` });
  const sender  = keypair.getPublicKey().toSuiAddress();

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(10_000_000);
  tx.moveCall({
    target:        `${packageId}::escrow::finalize_submission`,
    typeArguments: [USDC_TYPE],
    arguments:     [tx.object(delegationId)],
  });

  const bytes  = await tx.build({ client });
  const sig    = await keypair.signTransaction(bytes);
  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        sig.signature,
    options:          { showEffects: true },
    requestType:      'WaitForLocalExecution',
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`finalize_submission failed: ${JSON.stringify(result.effects?.status)}`);
  }
  log(`finalize_submission ✓  tx=${result.digest}`);
  return result.digest;
}
