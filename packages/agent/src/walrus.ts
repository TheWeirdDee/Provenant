/**
 * Walrus blob store/retrieve.
 * Uses the HTTP publisher/aggregator endpoints from .env.
 */

const PUBLISHER  = process.env.WALRUS_PUBLISHER_URL  ?? 'https://publisher.walrus-testnet.walrus.space';
const AGGREGATOR = process.env.WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';
const EPOCHS     = parseInt(process.env.WALRUS_EPOCHS ?? '5');
const PERMANENT  = process.env.WALRUS_PERMANENT === 'true';

interface WalrusResponse {
  newlyCreated?:    { blobObject: { blobId: string } };
  alreadyCertified?: { blobId: string };
}

/** Store raw bytes as a Walrus blob. Returns the blob_id string. */
export async function walrusPut(data: Buffer | Uint8Array): Promise<string> {
  const query = PERMANENT ? 'permanent=true' : `epochs=${EPOCHS}`;
  const res = await fetch(`${PUBLISHER}/v1/blobs?${query}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body:    (Buffer.isBuffer(data) ? data : Buffer.from(data)) as any,
  });
  if (!res.ok) throw new Error(`Walrus PUT HTTP ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as WalrusResponse;
  const blobId = json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId;
  if (!blobId) throw new Error(`No blobId in Walrus response: ${JSON.stringify(json)}`);
  return blobId;
}

/** Retrieve raw bytes for a Walrus blob_id. */
export async function walrusGet(blobId: string): Promise<Buffer> {
  const res = await fetch(`${AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus GET HTTP ${res.status} for blobId=${blobId}`);
  return Buffer.from(await res.arrayBuffer());
}
