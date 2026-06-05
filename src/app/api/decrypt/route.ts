import { NextRequest, NextResponse } from 'next/server';

// Force Node.js runtime — @mysten/seal uses Node crypto APIs
export const runtime = 'nodejs';

const WALRUS_AGG   = process.env.WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';
const SEAL_STUB    = process.env.SEAL_STUB === 'true';
const TATUM_KEY    = process.env.TATUM_API_KEY!;
const NETWORK      = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
const PACKAGE_ID   = process.env.PROVENANT_PACKAGE_ID!;
const DELEGATION_ID = process.env.DELEGATION_OBJECT_ID!;
const AGENT_KEY    = process.env.AGENT_PRIVATE_KEY!;

const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const SEAL_SERVERS = [
  { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
  { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { blobId?: string; encryptionIdHex?: string };
    const { blobId, encryptionIdHex } = body;
    if (!blobId) return NextResponse.json({ error: 'blobId required' }, { status: 400 });

    // 1. Fetch blob from Walrus
    const blobRes = await fetch(`${WALRUS_AGG}/v1/blobs/${blobId}`);
    if (!blobRes.ok) throw new Error(`Walrus responded with HTTP ${blobRes.status}`);
    const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer());

    // 2. Stub path — blob is raw JSON
    if (SEAL_STUB) {
      const text = new TextDecoder().decode(encryptedBytes);
      let payload: unknown = text;
      try { payload = JSON.parse(text); } catch { /* keep raw */ }
      return NextResponse.json({ blobId, payload, isStub: true });
    }

    // 3. Real Seal path
    if (!encryptionIdHex) {
      return NextResponse.json({ error: 'encryptionIdHex required for real Seal decrypt' }, { status: 400 });
    }

    const { SealClient, SessionKey }             = await import('@mysten/seal');
    const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
    const { Ed25519Keypair }                      = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction }                         = await import('@mysten/sui/transactions');

    const keypair   = Ed25519Keypair.fromSecretKey(AGENT_KEY);
    const address   = keypair.getPublicKey().toSuiAddress();
    const suiClient = new SuiJsonRpcClient({
      network: NETWORK,
      url:     `https://fullnode.${NETWORK}.sui.io:443`,
    });

    // Build the approval transaction (onlyTransactionKind — no gas/sender)
    const tx = new Transaction();
    tx.moveCall({
      target:        `${PACKAGE_ID}::escrow::seal_approve_node`,
      typeArguments: [USDC_TYPE],
      arguments: [
        tx.pure.vector('u8', Array.from(Buffer.from(encryptionIdHex, 'hex'))),
        tx.object(DELEGATION_ID),
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txBytes = await tx.build({ client: suiClient as any, onlyTransactionKind: true });

    // Create session key (signer auto-signs the personal message lazily)
    const sessionKey = await SessionKey.create({
      address,
      packageId: PACKAGE_ID,
      ttlMin:    10,
      signer:    keypair,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      suiClient: suiClient as any,
    });

    const sealClient = new SealClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      suiClient:        suiClient as any,
      serverConfigs:    SEAL_SERVERS,
      verifyKeyServers: false,
    });

    const decrypted = await sealClient.decrypt({ data: encryptedBytes, sessionKey, txBytes });

    const text = new TextDecoder().decode(decrypted);
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch { /* keep raw */ }

    return NextResponse.json({ blobId, payload, isStub: false });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
