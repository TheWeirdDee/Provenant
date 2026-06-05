import { NextResponse } from 'next/server';

const TATUM_KEY     = process.env.TATUM_API_KEY!;
const AGENT_KEY     = process.env.AGENT_PRIVATE_KEY!;
const PACKAGE_ID    = process.env.PROVENANT_PACKAGE_ID!;
const DELEGATION_ID = process.env.DELEGATION_OBJECT_ID!;
const NETWORK       = process.env.SUI_NETWORK ?? 'testnet';

const USDC_TYPE  = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const CLOCK_ID   = '0x0000000000000000000000000000000000000000000000000000000000000006';
const PUBLIC_RPC = `https://fullnode.${NETWORK}.sui.io:443`;
const TATUM_RPC  = `https://sui-${NETWORK}.gateway.tatum.io`;

export async function POST() {
  try {
    // 1. Check current status so we never double-fire
    const statusRes = await fetch(TATUM_RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TATUM_KEY },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getObject',
        params: [DELEGATION_ID, { showContent: true }] }),
    });
    const statusBody = await statusRes.json() as {
      result?: { data?: { content?: { fields?: { status?: number; budget?: string } } } };
    };
    const status = statusBody.result?.data?.content?.fields?.status ?? -1;
    const budget = statusBody.result?.data?.content?.fields?.budget ?? '0';

    if (status === 3) {
      // Already settled — return current state without re-firing
      return NextResponse.json({
        alreadySettled: true,
        status:         3,
        statusLabel:    'Settled',
        budget,
        delegationId:   DELEGATION_ID,
        explorerUrl:    `https://suiscan.xyz/${NETWORK}/object/${DELEGATION_ID}`,
      });
    }

    if (status !== 2) {
      return NextResponse.json(
        { error: `Cannot settle: delegation status is ${status} (expected 2 = Submitted)` },
        { status: 400 },
      );
    }

    // 2. Build + sign + submit verify_and_settle
    const { Ed25519Keypair }   = await import('@mysten/sui/keypairs/ed25519');
    const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
    const { Transaction }      = await import('@mysten/sui/transactions');

    const keypair = Ed25519Keypair.fromSecretKey(AGENT_KEY);
    const client  = new SuiJsonRpcClient({ url: PUBLIC_RPC });
    const sender  = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);
    tx.setGasBudget(10_000_000);
    tx.moveCall({
      target:        `${PACKAGE_ID}::escrow::verify_and_settle`,
      typeArguments: [USDC_TYPE],
      arguments:     [tx.object(DELEGATION_ID), tx.object(CLOCK_ID)],
    });

    const bytes  = await tx.build({ client });
    const sig    = await keypair.signTransaction(bytes);
    const result = await client.executeTransactionBlock({
      transactionBlock: bytes,
      signature:        sig.signature,
      options:          { showEffects: true, showBalanceChanges: true },
      requestType:      'WaitForLocalExecution',
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`verify_and_settle failed: ${JSON.stringify(result.effects?.status)}`);
    }

    return NextResponse.json({
      txDigest:    result.digest,
      status:      3,
      statusLabel: 'Settled',
      explorerUrl: `https://suiscan.xyz/${NETWORK}/tx/${result.digest}`,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
