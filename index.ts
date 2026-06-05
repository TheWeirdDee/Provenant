import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { emitNode, getTrail } from './nodes/emitter';
import {
  getAllBalances,
  getTransactionHistory,
  clearCallLog,
  getCallLog,
} from './tatum/client';
import { TrailManifest, RebalanceRecommendation } from './nodes/types';
import { writeFileSync } from 'fs';

// ─── Provenant Agent — Treasury Analysis Task ─────────────────────────────────
// The agent reads the principal's on-chain portfolio via Tatum,
// reasons about it via Claude, and emits a decision node for every
// significant action. The resulting trail is the proof that unlocks escrow.

const DELEGATION_ID = process.env.DELEGATION_OBJECT_ID || 'mock_delegation_001';
const PRINCIPAL = process.env.PRINCIPAL_ADDRESS;
const DRY = !process.env.DELEGATION_OBJECT_ID; // dry mode if no real delegation

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function runAgent() {
  if (!PRINCIPAL) {
    console.error('PRINCIPAL_ADDRESS is not set. Run preflight first.');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   PROVENANT AGENT — Treasury Analysis    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Principal: ${PRINCIPAL.slice(0, 10)}…`);
  console.log(`  Delegation: ${DELEGATION_ID}`);
  console.log(`  Mode: ${DRY ? 'DRY (stub Seal/Walrus/Sui)' : 'LIVE'}\n`);

  // ─── Node 1: Read portfolio ─────────────────────────────────────────────
  clearCallLog();
  const balances = await getAllBalances(PRINCIPAL);

  await emitNode({
    memory_used: 'Node 0 (preflight) passed. Task: treasury analysis + rebalance recommendation.',
    data_inputs: getCallLog(),
    active_policies: [
      'MUST NOT fabricate on-chain data',
      'All chain reads via Tatum',
    ],
    action: 'Read all coin balances for principal address',
    outcome: `Found ${balances.length} coin type(s): ${balances.map(b => b.coinType.split('::').pop()).join(', ')}`,
  }, DELEGATION_ID, { dry: DRY });

  // ─── Node 2: Read transaction history ──────────────────────────────────
  clearCallLog();
  const txHistory = await getTransactionHistory(PRINCIPAL, 20);

  await emitNode({
    memory_used: `Node 1: portfolio has ${balances.length} coins`,
    data_inputs: getCallLog(),
    active_policies: ['All chain reads via Tatum'],
    action: 'Read recent transaction history (last 20 txs)',
    outcome: `Retrieved ${txHistory.length} transactions`,
  }, DELEGATION_ID, { dry: DRY });

  // ─── Node 3: LLM reasoning — form hypothesis ───────────────────────────
  const portfolioSummary = balances.map(b =>
    `${b.coinType.split('::').pop()}: ${(BigInt(b.totalBalance) / BigInt(1e9)).toString()} (raw: ${b.totalBalance})`
  ).join('\n');

  const llmPrompt = `You are a DeFi treasury analyst. Analyze this Sui wallet portfolio and provide a rebalance recommendation.

Portfolio (${balances.length} assets):
${portfolioSummary}

Recent activity: ${txHistory.length} transactions in the last 20.

Provide:
1. A brief assessment of the portfolio composition
2. One concrete rebalance recommendation: which asset, direction (BUY/SELL/HOLD), estimated size in USD, and rationale
3. Confidence level: HIGH/MEDIUM/LOW

Be concise and specific. Base your recommendation only on the data provided.`;

  const llmResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: llmPrompt }],
  });

  const analysis = llmResponse.content[0].type === 'text'
    ? llmResponse.content[0].text
    : '';

  await emitNode({
    memory_used: `Node 1: balances. Node 2: tx history. Reasoning over combined inputs.`,
    data_inputs: [`Claude claude-sonnet-4-20250514 analysis of ${balances.length} assets`],
    active_policies: ['Recommendation must be grounded in on-chain data only'],
    action: 'LLM reasoning: analyze portfolio composition and form rebalance hypothesis',
    outcome: analysis.slice(0, 200) + (analysis.length > 200 ? '…' : ''),
  }, DELEGATION_ID, { dry: DRY });

  // ─── Node 4: Final recommendation ──────────────────────────────────────
  // Parse a structured recommendation from the LLM output
  const recommendation: RebalanceRecommendation = {
    asset: extractAsset(analysis, balances),
    direction: extractDirection(analysis),
    size_usd: extractSize(analysis),
    rationale: analysis,
    confidence: extractConfidence(analysis),
  };

  await emitNode({
    memory_used: 'Nodes 1–3: portfolio read, tx history, LLM analysis.',
    data_inputs: [`Structured from Node 3 LLM output`],
    active_policies: ['Recommendation finalized — ready for submission'],
    action: 'Finalize rebalance recommendation',
    outcome: `${recommendation.direction} ${recommendation.asset} ~$${recommendation.size_usd} (${recommendation.confidence} confidence)`,
  }, DELEGATION_ID, { dry: DRY });

  // ─── Write final manifest ───────────────────────────────────────────────
  const trail = getTrail();
  const manifest: TrailManifest = {
    delegation_id: DELEGATION_ID,
    agent_address: process.env.AGENT_PRIVATE_KEY ? 'set' : 'not_set',
    principal_address: PRINCIPAL,
    nodes: trail.map(s => ({
      index: s.node.index,
      blob_id: s.blob_id,
      encryption_id: s.encryption_id,
      commitment: s.commitment,
    })),
    status: 'READY_FOR_SUBMISSION',
    final_recommendation: recommendation,
  };

  const manifestPath = `provenant_manifest_${DELEGATION_ID.slice(0, 8)}.json`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   READY_FOR_SUBMISSION                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Nodes committed: ${trail.length}`);
  console.log(`  Recommendation: ${recommendation.direction} ${recommendation.asset}`);
  console.log(`  Manifest: ${manifestPath}\n`);
}

// ─── Crude extractors (replace with structured LLM output in v2) ──────────────

function extractAsset(text: string, balances: { coinType: string }[]): string {
  const coins = balances.map(b => b.coinType.split('::').pop() || '');
  for (const coin of coins) {
    if (text.toUpperCase().includes(coin.toUpperCase())) return coin;
  }
  return 'SUI';
}

function extractDirection(text: string): 'BUY' | 'SELL' | 'HOLD' {
  if (/\bsell\b/i.test(text)) return 'SELL';
  if (/\bbuy\b/i.test(text)) return 'BUY';
  return 'HOLD';
}

function extractSize(text: string): number {
  const match = text.match(/\$(\d[\d,]*)/);
  return match ? parseInt(match[1].replace(',', '')) : 100;
}

function extractConfidence(text: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (/\bhigh\b/i.test(text)) return 'HIGH';
  if (/\blow\b/i.test(text)) return 'LOW';
  return 'MEDIUM';
}

runAgent().catch(e => {
  console.error('Agent crashed:', e);
  process.exit(1);
});
