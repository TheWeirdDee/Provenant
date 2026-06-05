/**
 * Seal integration — real encryption via @mysten/seal.
 *
 * encrypt: IBE over BLS12-381, threshold-1 of 2 testnet key servers.
 * The encrypted object is stored as a Walrus blob; its keccak256 is committed on-chain.
 *
 * Decrypt happens server-side in src/app/api/decrypt/route.ts using the same helpers.
 */
import { createHash } from 'crypto';
import { SealClient } from '@mysten/seal';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

// Mysten Labs testnet key servers (from Seal SDK integration tests)
export const SEAL_SERVERS = [
  { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
  { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 },
];

/**
 * Deterministic encryption_id: sha256(delegationId || "::" || nodeIndex).
 * The Seal key server evaluates seal_approve_node against this ID.
 */
export function computeEncryptionId(delegationId: string, nodeIndex: number): Uint8Array {
  return createHash('sha256')
    .update(`${delegationId}::${nodeIndex}`)
    .digest();
}

/**
 * Create a SuiJsonRpcClient for the Seal SDK using the Mysten public fullnode.
 * (Tatum is used for portfolio reads; the public node handles Seal key-server lookups.)
 */
export function makeSealSuiClient(): SuiJsonRpcClient {
  const NETWORK = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  return new SuiJsonRpcClient({
    network: NETWORK,
    url:     `https://fullnode.${NETWORK}.sui.io:443`,
  });
}

/** Create a SealClient backed by the Tatum RPC. */
export function makeSealClient(suiClient: SuiJsonRpcClient): SealClient {
  return new SealClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    suiClient:        suiClient as any,
    serverConfigs:    SEAL_SERVERS,
    verifyKeyServers: false,
  });
}

/**
 * Encrypt a decision-node payload with real Seal IBE.
 * Returns the BCS-encoded EncryptedObject bytes (stored verbatim as a Walrus blob).
 */
export async function sealEncrypt(
  packageId:    string,
  encryptionId: Uint8Array,
  payload:      unknown,
): Promise<Uint8Array> {
  const suiClient  = makeSealSuiClient();
  const sealClient = makeSealClient(suiClient);

  const idHex = Buffer.from(encryptionId).toString('hex');
  const data  = new TextEncoder().encode(JSON.stringify(payload, null, 2));

  const { encryptedObject } = await sealClient.encrypt({
    threshold: 1,
    packageId,
    id:        idHex,
    data,
  });
  return encryptedObject;
}
