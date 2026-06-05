import 'dotenv/config';

// ─── Seal Encryption Client ───────────────────────────────────────────────────
// Encrypts each decision node independently under its encryption_id.
// The principal can decrypt node k without touching any other node.
//
// STUB STATUS: @mysten/seal is in active development.
// This file is structured to match the Seal SDK API exactly.
// Replace the stub implementations with real SDK calls once the package
// is stable and your SessionKey is available.
//
// Seal docs: https://seal-docs.wal.app/UsingSeal

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const SEAL_PKG = NETWORK === 'mainnet'
  ? process.env.SEAL_PACKAGE_ID_MAINNET
  : process.env.SEAL_PACKAGE_ID_TESTNET;

// ─── Encrypt ─────────────────────────────────────────────────────────────────
// Called by emitter.ts before storing on Walrus.
// encryption_id = keccak256(delegation_id || node_index)

export async function sealEncryptNode(
  payload: Buffer,
  encryption_id: string
): Promise<Buffer> {
  if (isStubMode()) {
    // Stub: XOR with a fixed key — NOT secure, for dev flow testing only
    console.warn('  [Seal] STUB MODE — payload is not truly encrypted');
    return Buffer.from(payload.map((b, i) => b ^ (0xAB + i) % 256));
  }

  // ─── Real Implementation (wire when @mysten/seal is ready) ────────────────
  //
  // const { SealClient } = await import('@mysten/seal');
  // const { SuiClient } = await import('@mysten/sui/client');
  //
  // const suiClient = new SuiClient({ url: getSuiRpcUrl() });
  // const sealClient = new SealClient({ suiClient, serverObjectIds: await getKeyServerIds(suiClient) });
  //
  // const { encryptedObject } = await sealClient.encrypt({
  //   threshold: 2,
  //   packageId: SEAL_PKG!,
  //   id: hexToBytes(encryption_id),
  //   data: payload,
  // });
  //
  // return Buffer.from(encryptedObject);

  throw new Error('Seal real mode not yet implemented — set SEAL_STUB=true for dev');
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────
// Called by the Inspector UI when the principal clicks a node.
// Requires a valid SessionKey (user-signed, short TTL).

export async function sealDecryptNode(
  encryptedPayload: Buffer,
  encryption_id: string,
  delegationObjectId: string
): Promise<Buffer> {
  if (isStubMode()) {
    console.warn('  [Seal] STUB MODE — reversing XOR stub encryption');
    return Buffer.from(encryptedPayload.map((b, i) => b ^ (0xAB + i) % 256));
  }

  // ─── Real Implementation ──────────────────────────────────────────────────
  //
  // const { SealClient, SessionKey } = await import('@mysten/seal');
  // const { Transaction } = await import('@mysten/sui/transactions');
  //
  // Build the seal_approve_node tx (dry-run only — no side effects)
  // const tx = new Transaction();
  // tx.moveCall({
  //   target: `${PROVENANT_PKG}::escrow::seal_approve_node`,
  //   arguments: [
  //     tx.pure.vector('u8', hexToBytes(encryption_id)),
  //     tx.object(delegationObjectId),
  //   ],
  // });
  // const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  //
  // return Buffer.from(
  //   await sealClient.decrypt({ data: encryptedPayload, sessionKey, txBytes })
  // );

  throw new Error('Seal real mode not yet implemented');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStubMode(): boolean {
  return process.env.SEAL_STUB === 'true' || !process.env.PROVENANT_PACKAGE_ID;
}

export function getSealPackageId(): string {
  if (!SEAL_PKG) throw new Error(`SEAL_PACKAGE_ID_${NETWORK.toUpperCase()} is not set`);
  return SEAL_PKG;
}
