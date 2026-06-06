/**
 * Provenant Agent — Step 2 runner.
 *
 * Performs a treasury analysis of the principal's on-chain portfolio.
 * All on-chain reads go through the Tatum MCP gateway (gateway_execute_rpc)
 * so every call is recorded verbatim in data_inputs[] on the trail node.
 *
 * Run: npm run agent   (from packages/agent/)
 */
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { commitNode, finalizeSubmission, type DecisionNode, type TrailCommitment } from './trail.js';
import { gatewayRpc } from './mcp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const TATUM_API_KEY     = process.env.TATUM_API_KEY!;
const PRINCIPAL_ADDR    = process.env.PRINCIPAL_ADDRESS!;
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY!;
const PACKAGE_ID        = process.env.PROVENANT_PACKAGE_ID!;
const DELEGATION_ID     = process.env.DELEGATION_OBJECT_ID!;
const SUI_NETWORK       = process.env.SUI_NETWORK ?? 'testnet';

const PUBLIC_RPC = `https://fullnode.${SUI_NETWORK}.sui.io:443`;
const USDC_TYPE  = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

// ── Claim delegation via public RPC (tx submission — not an MCP read) ─────────

async function claimIfNeeded(keypair: Ed25519Keypair): Promise<void> {
  // Status check goes through MCP gateway
  const { result: obj } = await gatewayRpc<{
    data: { content: { fields: { status: number } } };
  }>('sui_getObject', [DELEGATION_ID, { showContent: true }]);

  const status = obj.data.content.fields.status;
  if (status !== 0) {
    console.log(`  Delegation status=${status} — skipping claim`);
    return;
  }

  console.log('  Claiming delegation…');
  const client = new SuiJsonRpcClient({ network: SUI_NETWORK as 'testnet' | 'mainnet', url: PUBLIC_RPC });
  const sender = keypair.getPublicKey().toSuiAddress();

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(10_000_000);
  tx.moveCall({
    target:        `${PACKAGE_ID}::escrow::claim`,
    typeArguments: [USDC_TYPE],
    arguments:     [tx.object(DELEGATION_ID)],
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
    throw new Error(`claim failed: ${JSON.stringify(result.effects?.status)}`);
  }
  console.log(`  Claimed ✓  tx=${result.digest}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Provenant Agent  ·  Treasury Analysis Task');
  console.log('══════════════════════════════════════════════════════\n');

  for (const v of ['TATUM_API_KEY', 'PRINCIPAL_ADDRESS', 'AGENT_PRIVATE_KEY', 'PROVENANT_PACKAGE_ID', 'DELEGATION_OBJECT_ID']) {
    if (!process.env[v]) throw new Error(`${v} missing from .env`);
  }

  const keypair = Ed25519Keypair.fromSecretKey(AGENT_PRIVATE_KEY);

  console.log(`  delegation:  ${DELEGATION_ID}`);
  console.log(`  principal:   ${PRINCIPAL_ADDR}`);
  console.log(`  agent:       ${keypair.getPublicKey().toSuiAddress()}\n`);

  // ── Claim ─────────────────────────────────────────────────────────────────
  await claimIfNeeded(keypair);

  const manifest: TrailCommitment[] = [];
  const now = () => new Date().toISOString();

  // ═══════════════════════════════════════════════════════════════════════════
  // NODE 0 — Read on-chain portfolio via Tatum MCP gateway
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Node 0: Portfolio read (MCP gateway) ─────────────────');

  const { result: allBalances, dataInput: di_balances } = await gatewayRpc<
    Array<{ coinType: string; totalBalance: string; coinObjectCount: number }>
  >('suix_getAllBalances', [PRINCIPAL_ADDR]);

  console.log(`  MCP: ${di_balances}`);

  const { result: delegationObj, dataInput: di_delegation } = await gatewayRpc<{
    data: {
      content: {
        fields: {
          status:      number;
          budget:      string;
          principal:   string;
          deadline_ms: string;
          nodes:       unknown[];
        };
      };
    };
  }>('sui_getObject', [DELEGATION_ID, { showContent: true }]);

  console.log(`  MCP: ${di_delegation}`);

  const suiBalance  = allBalances.find(b => b.coinType === '0x2::sui::SUI');
  const usdcBalance = allBalances.find(b => b.coinType === USDC_TYPE);
  const escrow      = delegationObj.data.content.fields;

  const portfolioSnapshot = {
    address:      PRINCIPAL_ADDR,
    sui:          { raw: suiBalance?.totalBalance ?? '0',  sui: (Number(suiBalance?.totalBalance ?? 0) / 1e9).toFixed(4) },
    usdc:         { raw: usdcBalance?.totalBalance ?? '0', usdc: (Number(usdcBalance?.totalBalance ?? 0) / 1e6).toFixed(2) },
    allCoins:     allBalances,
    escrowLocked: { budget: escrow.budget, status: escrow.status, deadline_ms: escrow.deadline_ms },
    timestamp:    now(),
  };

  const node0: DecisionNode = {
    index:           0,
    memory_used:     'Pre-flight: Tatum MCP gateway initialised; Delegation funded with 1 USDC',
    data_inputs:     [
      di_balances,
      di_delegation,
      `SUI: ${portfolioSnapshot.sui.sui} SUI`,
      `USDC (liquid): ${portfolioSnapshot.usdc.usdc} USDC`,
      `USDC (locked in escrow): ${(Number(escrow.budget) / 1e6).toFixed(2)} USDC`,
      `Delegation status: ${escrow.status} (CLAIMED)`,
    ],
    active_policies: ['Read-only — no on-chain mutations during portfolio read'],
    action:          'Read principal wallet balances and escrow state via Tatum MCP gateway_execute_rpc',
    outcome:         JSON.stringify(portfolioSnapshot),
    timestamp:       now(),
  };

  console.log(`  SUI:  ${portfolioSnapshot.sui.sui} SUI`);
  console.log(`  USDC: ${portfolioSnapshot.usdc.usdc} USDC (liquid) + ${(Number(escrow.budget) / 1e6).toFixed(2)} USDC (escrow)`);
  manifest.push(await commitNode(keypair, PACKAGE_ID, DELEGATION_ID, node0));

  // ═══════════════════════════════════════════════════════════════════════════
  // NODE 1 — Portfolio composition analysis
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Node 1: Portfolio composition analysis ───────────────');

  const suiRaw   = Number(portfolioSnapshot.sui.raw);
  const usdcRaw  = Number(portfolioSnapshot.usdc.raw) + Number(escrow.budget);
  const suiUsd   = (suiRaw / 1e9) * 3.50;
  const usdcUsd  = usdcRaw / 1e6;
  const totalUsd = suiUsd + usdcUsd;
  const suiPct   = totalUsd > 0 ? (suiUsd  / totalUsd) * 100 : 0;
  const usdcPct  = totalUsd > 0 ? (usdcUsd / totalUsd) * 100 : 0;

  const parsedAnalysis = {
    composition: {
      SUI:  { pct: suiPct.toFixed(1),  usd_value: suiUsd.toFixed(2) },
      USDC: { pct: usdcPct.toFixed(1), usd_value: usdcUsd.toFixed(2) },
      total_usd_approx: totalUsd.toFixed(2),
      coin_count: allBalances.length,
    },
    observations: [
      `Portfolio is ${usdcPct > 70 ? 'stablecoin-heavy (low volatility)' : suiPct > 70 ? 'SUI-heavy (high volatility)' : 'balanced'}`,
      `${(Number(escrow.budget) / 1e6).toFixed(2)} USDC is locked in Provenant escrow (delegated task budget)`,
      'SUI allocation provides gas + potential appreciation; USDC provides stability',
      `Escrow deadline: ${new Date(Number(escrow.deadline_ms)).toISOString()}`,
    ],
    risk_profile: usdcPct > 80 ? 'conservative' : suiPct > 60 ? 'aggressive' : 'moderate',
  };

  console.log(`  SUI: ${suiPct.toFixed(1)}%  USDC: ${usdcPct.toFixed(1)}%  (total ~$${totalUsd.toFixed(2)})`);
  console.log(`  Risk profile: ${parsedAnalysis.risk_profile}`);

  const node1: DecisionNode = {
    index:           1,
    memory_used:     'Node 0: MCP gateway_execute_rpc(suix_getAllBalances) snapshot',
    data_inputs:     [
      `SUI balance: ${portfolioSnapshot.sui.sui} SUI (~$${suiUsd.toFixed(2)} at $3.50)`,
      `USDC total: ${usdcUsd.toFixed(2)} USDC (${portfolioSnapshot.usdc.usdc} liquid + ${(Number(escrow.budget) / 1e6).toFixed(2)} escrow)`,
      `Computed allocations: SUI=${suiPct.toFixed(1)}% USDC=${usdcPct.toFixed(1)}%`,
    ],
    active_policies: ['Analysis only — no on-chain mutations'],
    action:          'Compute portfolio composition: SUI vs USDC allocation, risk profile, escrow impact',
    outcome:         JSON.stringify(parsedAnalysis),
    timestamp:       now(),
  };

  manifest.push(await commitNode(keypair, PACKAGE_ID, DELEGATION_ID, node1));

  // ═══════════════════════════════════════════════════════════════════════════
  // NODE 2 — Final rebalance recommendation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Node 2: Rebalance recommendation ────────────────────');

  let direction: string, asset: string, sizePct: number, rationale: string;
  let targetSuiPct: number, targetUsdcPct: number;

  if (usdcPct > 80) {
    asset         = 'SUI';
    direction     = 'buy';
    sizePct       = Math.min(usdcPct - 70, 20);
    targetSuiPct  = 30;
    targetUsdcPct = 70;
    rationale     = `Portfolio is ${usdcPct.toFixed(0)}% stablecoin — heavy USDC concentration reduces yield potential. Increasing SUI exposure to 30% improves risk-adjusted return while maintaining a defensive majority in USDC.`;
  } else if (suiPct > 60) {
    asset         = 'SUI';
    direction     = 'sell';
    sizePct       = Math.min(suiPct - 40, 25);
    targetSuiPct  = 40;
    targetUsdcPct = 60;
    rationale     = `SUI concentration at ${suiPct.toFixed(0)}% creates excess volatility exposure. Reducing to 40% and holding more USDC stabilises the treasury while preserving upside participation.`;
  } else {
    asset         = 'SUI';
    direction     = 'hold';
    sizePct       = 0;
    targetSuiPct  = Math.round(suiPct);
    targetUsdcPct = Math.round(usdcPct);
    rationale     = `Current ${suiPct.toFixed(0)}% SUI / ${usdcPct.toFixed(0)}% USDC allocation is within the 30–60% SUI target range. No rebalance action required at this time.`;
  }

  const recommendation = {
    recommendation: {
      asset,
      direction,
      size_pct:          sizePct,
      rationale,
      target_allocation: { SUI_pct: targetSuiPct, USDC_pct: targetUsdcPct },
      risk_level:        parsedAnalysis.risk_profile === 'aggressive' ? 'high' : parsedAnalysis.risk_profile === 'conservative' ? 'low' : 'medium',
      time_horizon:      'medium',
    },
    confidence: 'medium',
    caveats: [
      'Testnet prices are indicative only — mainnet SUI price may differ significantly',
      'Escrow-locked USDC is illiquid until delegation settles or refund-on-timeout triggers',
      'Gas reserve of ≥0.1 SUI should be maintained regardless of rebalance direction',
    ],
  };

  console.log(`  Recommendation: ${direction.toUpperCase()} ${asset}  (${sizePct}% of portfolio)`);
  console.log(`  Target: SUI=${targetSuiPct}% / USDC=${targetUsdcPct}%`);
  console.log(`  Rationale: ${rationale.slice(0, 80)}…`);

  const node2: DecisionNode = {
    index:           2,
    memory_used:     'Nodes 0+1: MCP portfolio snapshot + composition analysis',
    data_inputs:     [
      `Composition (from MCP reads): SUI=${suiPct.toFixed(1)}% USDC=${usdcPct.toFixed(1)}%`,
      `Risk profile: ${parsedAnalysis.risk_profile}`,
      'Rule: USDC>80%→buy SUI; SUI>60%→sell SUI; else→hold',
    ],
    active_policies: [
      'Recommendation only — no execution without principal approval',
      'Testnet context — indicative prices only',
      'Gas reserve ≥0.1 SUI maintained',
    ],
    action:          'Apply portfolio rebalancing rules to produce final recommendation',
    outcome:         JSON.stringify(recommendation),
    timestamp:       now(),
  };

  manifest.push(await commitNode(keypair, PACKAGE_ID, DELEGATION_ID, node2));

  // ═══════════════════════════════════════════════════════════════════════════
  // Finalize submission
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── Finalizing submission ────────────────────────────────');
  const finalizeTx = await finalizeSubmission(keypair, PACKAGE_ID, DELEGATION_ID);

  // ── Trail manifest ────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  TRAIL MANIFEST');
  console.log('══════════════════════════════════════════════════════');
  for (const c of manifest) {
    console.log(`  Node ${c.nodeIndex}:`);
    console.log(`    blob_id    = ${c.blobId}`);
    console.log(`    commitment = ${c.commitment}`);
    console.log(`    tx         = ${c.txDigest}`);
  }
  console.log(`\n  finalize tx = ${finalizeTx}`);
  console.log(`  explorer    = https://suiscan.xyz/${SUI_NETWORK}/object/${DELEGATION_ID}`);
  console.log('\n  Status: READY_FOR_SUBMISSION');
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch((e: unknown) => {
  console.error('\n✗ Agent crashed:', (e as Error).message);
  process.exit(1);
});
