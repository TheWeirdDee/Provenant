import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import 'dotenv/config';

// ─── Sui Contract Client ──────────────────────────────────────────────────────
// Handles on-chain writes: anchoring trail nodes, settling escrow, refunds.

const NETWORK = (process.env.SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet';
const PKG = process.env.PROVENANT_PACKAGE_ID;

// Use Tatum gateway if key is available, fall back to public fullnode
function getRpcUrl(): string {
  const tatumKey = process.env.TATUM_API_KEY;
  if (tatumKey) {
    return NETWORK === 'mainnet'
      ? 'https://sui-mainnet.gateway.tatum.io'
      : 'https://sui-testnet.gateway.tatum.io';
  }
  return getFullnodeUrl(NETWORK);
}

export function getSuiClient(): SuiClient {
  return new SuiClient({ url: getRpcUrl() });
}

function getAgentKeypair(): Ed25519Keypair {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY is not set');
  return Ed25519Keypair.fromSecretKey(Buffer.from(pk, 'hex'));
}

// ─── Anchor Trail Node ────────────────────────────────────────────────────────
// Appends a TrailNode to the Delegation object on-chain.
// Called after every Walrus store + commitment computation.

export async function anchorTrailNode(params: {
  delegationId: string;
  index: number;
  blob_id: string;
  encryption_id: string;
  commitment: string;
  public_meta: object;
}): Promise<string> {
  if (!PKG) {
    console.warn('  [Sui] PROVENANT_PACKAGE_ID not set — skipping on-chain anchor (dev mode)');
    return 'dev_tx_stub';
  }

  const client = getSuiClient();
  const keypair = getAgentKeypair();

  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::escrow::submit_node`,
    arguments: [
      tx.object(params.delegationId),
      tx.pure.u64(params.index),
      tx.pure.vector('u8', Array.from(Buffer.from(params.blob_id))),
      tx.pure.vector('u8', Array.from(Buffer.from(params.encryption_id.replace('0x', ''), 'hex'))),
      tx.pure.vector('u8', Array.from(Buffer.from(params.commitment.replace('0x', ''), 'hex'))),
      tx.pure.vector('u8', Array.from(Buffer.from(JSON.stringify(params.public_meta)))),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  console.log(`  [Sui] trail node ${params.index} anchored: ${result.digest}`);
  return result.digest;
}

// ─── Fetch Delegation ─────────────────────────────────────────────────────────

export async function fetchDelegation(objectId: string) {
  const client = getSuiClient();
  const obj = await client.getObject({
    id: objectId,
    options: { showContent: true, showType: true },
  });
  return obj.data;
}

// ─── Settlement ───────────────────────────────────────────────────────────────

export async function settleDelegation(delegationId: string): Promise<string> {
  if (!PKG) throw new Error('PROVENANT_PACKAGE_ID is not set');

  const client = getSuiClient();
  const keypair = getAgentKeypair();

  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::escrow::verify_and_settle`,
    arguments: [tx.object(delegationId)],
  });

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  console.log(`  [Sui] settled: ${result.digest}`);
  return result.digest;
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function pingSui(): Promise<boolean> {
  try {
    const client = getSuiClient();
    await client.getChainIdentifier();
    return true;
  } catch {
    return false;
  }
}
