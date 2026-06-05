import { DecisionNode, PublicMeta, SealedNode, TrailManifest } from './types';
import { sealEncryptNode } from '../seal/client';
import { storeBlob } from '../walrus/client';
import { anchorTrailNode } from '../sui/contract';
import { keccak256, toUtf8Bytes } from 'ethers';

// ─── Trail State ──────────────────────────────────────────────────────────────
// Maintained in memory during agent execution.
// The full manifest is written to disk after each node so a crash is recoverable.

let trail: SealedNode[] = [];
let nodeIndex = 0;

export function getTrail() { return trail; }
export function getNextIndex() { return nodeIndex; }

// ─── Emit Node ────────────────────────────────────────────────────────────────
// Call this BEFORE executing the action it describes.
// The agent must not proceed if this throws.

export async function emitNode(
  partial: Omit<DecisionNode, 'index' | 'timestamp'>,
  delegationId: string,
  opts: { dry?: boolean } = {}
): Promise<SealedNode> {
  const node: DecisionNode = {
    ...partial,
    index: nodeIndex,
    timestamp: new Date().toISOString(),
  };

  console.log(`\n[NODE ${node.index}] ${node.action}`);
  console.log(`  outcome: ${node.outcome}`);

  if (opts.dry) {
    // Dry mode: skip Seal/Walrus/Sui — used during preflight and testing
    const stub: SealedNode = {
      node,
      blob_id: `stub_blob_${node.index}`,
      encryption_id: deriveEncryptionId(delegationId, node.index),
      commitment: `stub_commitment_${node.index}`,
      public_meta: buildPublicMeta(node),
    };
    trail.push(stub);
    nodeIndex++;
    return stub;
  }

  // 1. Serialize node payload
  const payload = Buffer.from(JSON.stringify(node));

  // 2. Derive Seal identity for this node
  const encryption_id = deriveEncryptionId(delegationId, node.index);

  // 3. Seal-encrypt the payload
  const encryptedPayload = await sealEncryptNode(payload, encryption_id);

  // 4. Compute commitment: keccak256(encrypted_node)
  const commitment = keccak256(encryptedPayload);

  // 5. Store encrypted blob on Walrus → get blob_id
  const blob_id = await storeBlob(encryptedPayload);

  // 6. Anchor TrailNode on Sui (appends to Delegation object)
  await anchorTrailNode({
    delegationId,
    index: node.index,
    blob_id,
    encryption_id,
    commitment,
    public_meta: buildPublicMeta(node),
  });

  const sealed: SealedNode = {
    node,
    blob_id,
    encryption_id,
    commitment,
    public_meta: buildPublicMeta(node),
  };

  trail.push(sealed);
  nodeIndex++;

  // Persist manifest to disk after each node (crash recovery)
  await persistManifest(delegationId);

  return sealed;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveEncryptionId(delegationId: string, nodeIndex: number): string {
  return keccak256(toUtf8Bytes(`${delegationId}::${nodeIndex}`));
}

function buildPublicMeta(node: DecisionNode): PublicMeta {
  return {
    index: node.index,
    action: node.action,
    outcome: node.outcome,
    timestamp: node.timestamp,
    references_nodes: [], // TODO: parse from memory_used
    data_sources: node.data_inputs.map(d => d.split('(')[0].trim()),
  };
}

async function persistManifest(delegationId: string) {
  const { writeFileSync } = await import('fs');
  const manifest: Partial<TrailManifest> = {
    delegation_id: delegationId,
    nodes: trail.map(s => ({
      index: s.node.index,
      blob_id: s.blob_id,
      encryption_id: s.encryption_id,
      commitment: s.commitment,
    })),
    status: 'IN_PROGRESS',
  };
  writeFileSync(
    `provenant_trail_${delegationId.slice(0, 8)}.json`,
    JSON.stringify(manifest, null, 2)
  );
}
