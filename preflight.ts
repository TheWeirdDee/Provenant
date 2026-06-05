import 'dotenv/config';
import { ping as pingTatum } from './tatum/client';
import { pingWalrus } from './walrus/client';
import { pingSui } from './sui/contract';
import { PreflightResult } from './nodes/types';
import { emitNode } from './nodes/emitter';

// ─── Preflight ────────────────────────────────────────────────────────────────
// Run before every agent session. Matches the Node 0 the agent emitted in chat.
// Exits non-zero if can_proceed is false.

async function preflight(): Promise<PreflightResult> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   PROVENANT — Pre-flight Check           ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const result: PreflightResult = {
    tatum_rpc: 'MISSING',
    sui_network: 'ERROR',
    walrus: 'STUB',
    seal: 'STUB',
    principal_address: 'MISSING',
    delegation_object: 'MISSING',
    can_proceed: false,
    blocking_reasons: [],
  };

  // 1. Tatum RPC
  if (!process.env.TATUM_API_KEY) {
    result.tatum_rpc = 'MISSING';
    result.blocking_reasons.push('TATUM_API_KEY not set — get a free key at https://dashboard.tatum.io');
  } else {
    console.log('  Checking Tatum RPC...');
    const ok = await pingTatum();
    result.tatum_rpc = ok ? 'OK' : 'ERROR';
    if (!ok) result.blocking_reasons.push('Tatum RPC unreachable — check TATUM_API_KEY and network');
    console.log(`  Tatum RPC: ${result.tatum_rpc}`);
  }

  // 2. Sui network
  console.log('  Checking Sui network...');
  const suiOk = await pingSui();
  result.sui_network = suiOk ? 'OK' : 'ERROR';
  if (!suiOk) result.blocking_reasons.push('Sui RPC unreachable — check SUI_NETWORK and connectivity');
  console.log(`  Sui network: ${result.sui_network}`);

  // 3. Walrus
  console.log('  Checking Walrus...');
  const walrusOk = await pingWalrus();
  result.walrus = walrusOk ? 'OK' : 'STUB';
  if (!walrusOk) console.log('  Walrus: STUB (will use stub mode for now — not blocking)');
  else console.log(`  Walrus: ${result.walrus}`);

  // 4. Seal
  // Seal has no ping endpoint; check if package ID is set
  const sealPkg = process.env.SUI_NETWORK === 'mainnet'
    ? process.env.SEAL_PACKAGE_ID_MAINNET
    : process.env.SEAL_PACKAGE_ID_TESTNET;
  result.seal = sealPkg ? 'STUB' : 'STUB'; // Always stub until @mysten/seal is wired
  console.log(`  Seal: STUB (stub encryption active — not blocking for Step 0)`);

  // 5. Principal address
  if (!process.env.PRINCIPAL_ADDRESS) {
    result.principal_address = 'MISSING';
    result.blocking_reasons.push('PRINCIPAL_ADDRESS not set — provide the Sui wallet to analyze');
  } else {
    result.principal_address = 'OK';
    console.log(`  Principal: ${process.env.PRINCIPAL_ADDRESS.slice(0, 10)}…`);
  }

  // 6. Delegation object
  if (!process.env.DELEGATION_OBJECT_ID) {
    result.delegation_object = 'MOCK';
    console.log('  Delegation: MOCK (no DELEGATION_OBJECT_ID — will use mock delegation for testing)');
  } else {
    result.delegation_object = 'OK';
    console.log(`  Delegation: ${process.env.DELEGATION_OBJECT_ID.slice(0, 10)}…`);
  }

  // ─── Determine if we can proceed ─────────────────────────────────────────
  // Hard blockers: Tatum RPC, principal address
  // Soft blockers (dev mode OK): Walrus stub, Seal stub, mock delegation
  const hardBlocked = result.tatum_rpc !== 'OK' || result.principal_address !== 'OK';
  result.can_proceed = !hardBlocked;

  console.log('\n──────────────────────────────────────────');
  console.log(`  can_proceed: ${result.can_proceed}`);
  if (result.blocking_reasons.length) {
    console.log('\n  Blocking reasons:');
    result.blocking_reasons.forEach(r => console.log(`    ✗ ${r}`));
  }
  console.log('──────────────────────────────────────────\n');

  // Emit the pre-flight as Node 0 (dry mode — no Seal/Walrus/Sui writes)
  await emitNode(
    {
      memory_used: 'Provenant PRD v1 — agent operating rules, Tatum MCP dependency, data-fabrication prohibition',
      data_inputs: [
        `pingTatum() → ${result.tatum_rpc}`,
        `pingSui() → ${result.sui_network}`,
        `pingWalrus() → ${result.walrus}`,
        `PRINCIPAL_ADDRESS → ${result.principal_address}`,
        `DELEGATION_OBJECT_ID → ${result.delegation_object}`,
      ],
      active_policies: [
        'MUST NOT fabricate or estimate on-chain data — read it via Tatum',
        'MUST NOT proceed if a required tool call fails without logging the failure',
        'MUST emit a node before every significant action',
      ],
      action: 'Pre-flight: verify all required integrations are available before reading chain state',
      outcome: result.can_proceed
        ? 'OK — all hard dependencies present, proceeding'
        : `BLOCKED — ${result.blocking_reasons.join('; ')}`,
    },
    'preflight',
    { dry: true }
  );

  return result;
}

// Run
preflight().then(r => {
  process.exit(r.can_proceed ? 0 : 1);
}).catch(e => {
  console.error('Preflight crashed:', e);
  process.exit(1);
});
