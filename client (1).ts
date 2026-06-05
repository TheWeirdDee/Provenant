import axios from 'axios';
import 'dotenv/config';

// ─── Walrus Blob Storage ──────────────────────────────────────────────────────
// Stores Seal-encrypted decision node payloads.
// Returns blob_id which is anchored on Sui in the TrailNode.

const PUBLISHER = process.env.WALRUS_PUBLISHER_URL
  || 'https://publisher.walrus-testnet.walrus.space';
const AGGREGATOR = process.env.WALRUS_AGGREGATOR_URL
  || 'https://aggregator.walrus-testnet.walrus.space';
const EPOCHS = parseInt(process.env.WALRUS_EPOCHS || '5');
const PERMANENT = process.env.WALRUS_PERMANENT === 'true';

// ─── Store ────────────────────────────────────────────────────────────────────

export async function storeBlob(data: Buffer | Uint8Array): Promise<string> {
  const params = new URLSearchParams();
  params.append('epochs', String(EPOCHS));
  if (!PERMANENT) params.append('deletable', 'true');

  const url = `${PUBLISHER}/v1/blobs?${params.toString()}`;

  const res = await axios.put(url, data, {
    headers: { 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity,
  });

  const blobId: string =
    res.data?.newlyCreated?.blobObject?.blobId
    || res.data?.alreadyCertified?.blobId;

  if (!blobId) {
    throw new Error(`Walrus store failed: ${JSON.stringify(res.data)}`);
  }

  console.log(`  [Walrus] stored blob ${blobId.slice(0, 16)}… (${EPOCHS} epochs)`);
  return blobId;
}

// ─── Retrieve ─────────────────────────────────────────────────────────────────

export async function retrieveBlob(blobId: string): Promise<Buffer> {
  const res = await axios.get(`${AGGREGATOR}/v1/blobs/${blobId}`, {
    responseType: 'arraybuffer',
  });
  return Buffer.from(res.data);
}

// ─── Verify Commitment ────────────────────────────────────────────────────────
// Recomputes keccak256(retrieved_blob) and checks it matches the on-chain commitment.
// This is what the principal runs during verification (Step 5 of PRD happy path).

export async function verifyCommitment(blobId: string, onChainCommitment: string): Promise<boolean> {
  const { keccak256 } = await import('ethers');
  const data = await retrieveBlob(blobId);
  const computed = keccak256(data);
  const match = computed.toLowerCase() === onChainCommitment.toLowerCase();
  if (!match) {
    console.error(`  [Walrus] TAMPER DETECTED: blob ${blobId.slice(0, 16)}…`);
    console.error(`    expected:  ${onChainCommitment}`);
    console.error(`    computed:  ${computed}`);
  }
  return match;
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function pingWalrus(): Promise<boolean> {
  try {
    await axios.get(`${AGGREGATOR}/v1/health`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
