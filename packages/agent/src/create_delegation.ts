/**
 * Step 1 helper — create a Delegation object on-chain funded with 1 USDC.
 * Uses @mysten/sui v2 (SuiJsonRpcClient).
 * Run: tsx src/create_delegation.ts
 */
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const PACKAGE_ID        = process.env.PROVENANT_PACKAGE_ID ?? '';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY ?? '';
const SUI_NETWORK       = process.env.SUI_NETWORK ?? 'testnet';
const TATUM_API_KEY     = process.env.TATUM_API_KEY ?? '';

const USDC_TYPE  = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const ESCROW_USDC = 1_000_000n; // 1 USDC = 1_000_000 base units (6 decimals)
const RPC_URL    = `https://sui-${SUI_NETWORK}.gateway.tatum.io`;

function enc(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}
function sha256Bytes(s: string): number[] {
  return Array.from(createHash('sha256').update(s).digest());
}

async function main() {
  if (!PACKAGE_ID)        throw new Error('PROVENANT_PACKAGE_ID not set in .env');
  if (!AGENT_PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY not set in .env');
  if (!TATUM_API_KEY)     throw new Error('TATUM_API_KEY not set in .env');

  const keypair = Ed25519Keypair.fromSecretKey(AGENT_PRIVATE_KEY);
  const sender  = keypair.getPublicKey().toSuiAddress();

  // Build against the public fullnode (supports all methods needed by the SDK builder).
  // Tatum is used for reads in the agent runtime; for tx construction the public node is fine.
  const PUBLIC_RPC = `https://fullnode.${SUI_NETWORK}.sui.io:443`;
  const client = new SuiJsonRpcClient({ network: SUI_NETWORK as "testnet" | "mainnet", url: PUBLIC_RPC });

  console.log(`\n── create_delegation ────────────────────────────────`);
  console.log(`  sender:  ${sender}`);
  console.log(`  package: ${PACKAGE_ID}`);
  console.log(`  network: ${SUI_NETWORK}`);

  // ── Find USDC coin ────────────────────────────────────────────────────────
  const coinsResp = await client.getCoins({ owner: sender, coinType: USDC_TYPE });
  const usdcCoins = coinsResp.data;
  if (!usdcCoins.length) throw new Error('No USDC coins found in wallet');

  usdcCoins.sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
  const best = usdcCoins[0]!;
  console.log(`  USDC coin: ${best.coinObjectId}  balance=${best.balance}`);

  if (BigInt(best.balance) < ESCROW_USDC) {
    throw new Error(`Insufficient USDC: need ${ESCROW_USDC}, have ${best.balance}`);
  }

  // ── Get gas coins ─────────────────────────────────────────────────────────
  const gasCoins = await client.getCoins({ owner: sender, coinType: '0x2::sui::SUI' });
  if (!gasCoins.data.length) throw new Error('No SUI gas coins found');

  // ── Build PTB ─────────────────────────────────────────────────────────────
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(10_000_000);

  // Split exactly 1 USDC
  const [splitCoin] = tx.splitCoins(tx.object(best.coinObjectId), [ESCROW_USDC]);

  const taskSpec     = enc('treasury_analysis_v1');
  const criteriaHash = sha256Bytes('provenant:treasury_analysis_v1:settle_on_valid_trail');
  const deadlineMs   = BigInt(Date.now() + 86_400_000);

  tx.moveCall({
    target:        `${PACKAGE_ID}::escrow::create_and_fund`,
    typeArguments: [USDC_TYPE],
    arguments: [
      splitCoin,
      tx.pure.vector('u8', taskSpec),
      tx.pure.vector('u8', criteriaHash),
      tx.pure.u64(deadlineMs),
    ],
  });

  // ── Sign and submit ───────────────────────────────────────────────────────
  console.log(`  Signing and submitting…`);
  const bytes  = await tx.build({ client });
  const sig    = await keypair.signTransaction(bytes);
  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        sig.signature,
    options: {
      showObjectChanges: true,
      showEffects:       true,
      showEvents:        true,
    },
    requestType: 'WaitForLocalExecution',
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.effects?.status)}`);
  }

  // ── Extract shared Delegation object ID ───────────────────────────────────
  const sharedObj = result.objectChanges?.find(
    (c) =>
      c.type === 'created' &&
      'owner' in c &&
      c.owner !== null &&
      typeof c.owner === 'object' &&
      'Shared' in (c.owner as object),
  );

  if (!sharedObj || sharedObj.type !== 'created') {
    console.error('objectChanges:', JSON.stringify(result.objectChanges, null, 2));
    throw new Error('Could not find shared Delegation object in tx output');
  }

  const delegationId = sharedObj.objectId;
  const txDigest     = result.digest;

  console.log(`\n  ✓ Delegation created!`);
  console.log(`    object ID:  ${delegationId}`);
  console.log(`    tx digest:  ${txDigest}`);
  console.log(`    explorer:   https://suiscan.xyz/${SUI_NETWORK}/object/${delegationId}`);
  console.log(`\n  Copy into .env:`);
  console.log(`    DELEGATION_OBJECT_ID=${delegationId}`);
}

main().catch((e: unknown) => {
  console.error('\n✗ Failed:', (e as Error).message);
  process.exit(1);
});
