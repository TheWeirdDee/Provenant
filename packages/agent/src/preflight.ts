import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load from repo root — packages/agent/src/ → ../../../
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const TATUM_API_KEY      = process.env.TATUM_API_KEY ?? '';
const SUI_NETWORK        = process.env.SUI_NETWORK ?? 'testnet';
const PRINCIPAL_ADDRESS  = process.env.PRINCIPAL_ADDRESS ?? '';
const WALRUS_PUBLISHER   = process.env.WALRUS_PUBLISHER_URL ?? 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR  = process.env.WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';
const SEAL_STUB          = process.env.SEAL_STUB === 'true';

const RPC_URL = `https://sui-${SUI_NETWORK}.gateway.tatum.io`;
// Native USDC on Sui testnet
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

// ── helpers ───────────────────────────────────────────────────────────────────

function mask(s: string, show = 6) {
  return s ? `***${s.slice(-show)}` : '(empty)';
}

function mark(ok: boolean) { return ok ? '✓' : '✗'; }

function row(label: string, ok: boolean, detail: string) {
  console.log(`  ${mark(ok)} ${label.padEnd(32)} ${detail}`);
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TATUM_API_KEY,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Tatum`);
  const body = await res.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`RPC error: ${body.error.message}`);
  return body.result;
}

async function walrusPut(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const res = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  });
  if (!res.ok) throw new Error(`Walrus PUT HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json() as Record<string, unknown>;
  // Publisher returns either newlyCreated or alreadyCertified
  const created = json['newlyCreated'] as Record<string, unknown> | undefined;
  const certified = json['alreadyCertified'] as Record<string, unknown> | undefined;
  const blob = created?.['blobObject'] as Record<string, unknown> | undefined;
  const blobId = (blob?.['blobId'] ?? certified?.['blobId']) as string | undefined;
  if (!blobId) throw new Error(`No blobId in response: ${JSON.stringify(json)}`);
  return blobId;
}

async function walrusGet(blobId: string): Promise<string> {
  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus GET HTTP ${res.status}`);
  return new TextDecoder().decode(await res.arrayBuffer());
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Provenant Preflight  ·  Step 0 — Environment Check');
  console.log('══════════════════════════════════════════════════════\n');

  // ── 1. Env vars ──────────────────────────────────────────────────────────────
  console.log('── Environment ──────────────────────────────────────────');
  const envChecks: [string, string][] = [
    ['TATUM_API_KEY',      TATUM_API_KEY      ? mask(TATUM_API_KEY)      : ''],
    ['SUI_NETWORK',        SUI_NETWORK],
    ['PRINCIPAL_ADDRESS',  PRINCIPAL_ADDRESS  ? `${PRINCIPAL_ADDRESS.slice(0, 10)}…` : ''],
    ['AGENT_PRIVATE_KEY',  process.env.AGENT_PRIVATE_KEY  ? '[set]' : ''],
    ['ANTHROPIC_API_KEY',  process.env.ANTHROPIC_API_KEY  ? '[set]' : ''],
    ['WALRUS_PUBLISHER_URL', WALRUS_PUBLISHER],
    ['WALRUS_AGGREGATOR_URL', WALRUS_AGGREGATOR],
  ];

  let envOk = true;
  for (const [key, val] of envChecks) {
    row(key, !!val, val || 'MISSING ← set in .env');
    if (!val) envOk = false;
  }
  if (!envOk) {
    console.log('\n  Preflight ABORTED — missing required env vars.\n');
    process.exit(1);
  }

  // ── 2. Tatum / Sui RPC ───────────────────────────────────────────────────────
  console.log('\n── Tatum / Sui RPC ──────────────────────────────────────');

  let suiOk = false, usdcOk = false, allOk2 = false;

  try {
    const r = await rpc('suix_getBalance', [PRINCIPAL_ADDRESS, '0x2::sui::SUI']) as { totalBalance: string };
    const sui = (Number(BigInt(r.totalBalance)) / 1e9).toFixed(4);
    row('suix_getBalance (SUI)', true, `${sui} SUI`);
    suiOk = true;
  } catch (e: unknown) {
    row('suix_getBalance (SUI)', false, (e as Error).message);
  }

  try {
    const r = await rpc('suix_getBalance', [PRINCIPAL_ADDRESS, USDC_TYPE]) as { totalBalance: string };
    const usdc = (Number(BigInt(r.totalBalance)) / 1e6).toFixed(2);
    row('suix_getBalance (USDC)', true, `${usdc} USDC`);
    usdcOk = true;
  } catch (e: unknown) {
    row('suix_getBalance (USDC)', false, (e as Error).message);
  }

  try {
    const r = await rpc('suix_getAllBalances', [PRINCIPAL_ADDRESS]) as unknown[];
    row('suix_getAllBalances', true, `${r.length} coin type(s) found`);
    allOk2 = true;
    if (r.length > 0) {
      const coins = r as Array<{ coinType: string; totalBalance: string }>;
      for (const c of coins) {
        const short = c.coinType.split('::').pop() ?? c.coinType;
        console.log(`      · ${short.padEnd(8)} ${c.totalBalance}`);
      }
    }
  } catch (e: unknown) {
    row('suix_getAllBalances', false, (e as Error).message);
  }

  const tatumPass = suiOk || usdcOk || allOk2;

  // ── 3. Walrus ────────────────────────────────────────────────────────────────
  console.log('\n── Walrus store / retrieve ──────────────────────────────');
  let walrusPass = false;
  let blobId = '';
  const testContent = `provenant-preflight-${Date.now()}`;

  try {
    blobId = await walrusPut(testContent);
    row('PUT /v1/blobs (test payload)', true, `blobId=${blobId.slice(0, 18)}…`);

    const retrieved = await walrusGet(blobId);
    const match = retrieved === testContent;
    row('GET /v1/blobs/{blobId}', match, match ? 'content matches ✓' : `MISMATCH: got "${retrieved}"`);
    walrusPass = match;
  } catch (e: unknown) {
    row('Walrus', false, (e as Error).message);
  }

  // ── 4. Seal ──────────────────────────────────────────────────────────────────
  console.log('\n── Seal ─────────────────────────────────────────────────');
  if (SEAL_STUB) {
    row('encrypt / decrypt', true, 'STUBBED (SEAL_STUB=true) — real Seal in Step 2');
  } else {
    row('Seal', false, 'set SEAL_STUB=true or integrate @mysten/seal');
  }
  const sealPass = SEAL_STUB;

  // ── 5. Mock Delegation ───────────────────────────────────────────────────────
  console.log('\n── Mock Delegation ──────────────────────────────────────');
  const deadlineMs = Date.now() + 3_600_000;
  const mockId = `0xMOCK_${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  const mockDelegation = {
    id:            mockId,
    principal:     PRINCIPAL_ADDRESS,
    agent:         '(set on claim)',
    task_spec:     'treasury_analysis_v1',
    criteria_hash: '(keccak256 of acceptance criteria — set at fund time)',
    budget:        '100 USDC',
    deadline_ms:   deadlineMs,
    deadline_iso:  new Date(deadlineMs).toISOString(),
    seal_policy:   `${SUI_NETWORK === 'testnet'
      ? '0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3'
      : '0xcb83a248bda5f7a0a431e6bf9e96d184e604130ec5218696e3f1211113b447b7'}::escrow::seal_approve_node`,
    status:        'Funded',
    nodes:         [],
  };
  row('Mock Delegation created', true, mockId);
  console.log('\n' + JSON.stringify(mockDelegation, null, 2));

  // ── Summary ──────────────────────────────────────────────────────────────────
  const checks: [string, boolean][] = [
    ['Tatum RPC',        tatumPass],
    ['Walrus',           walrusPass],
    ['Seal',             sealPass],
    ['Mock Delegation',  true],
  ];
  const allPass = checks.every(([, ok]) => ok);

  console.log('\n══════════════════════════════════════════════════════');
  for (const [name, ok] of checks) {
    console.log(`  ${mark(ok)} ${name}`);
  }
  console.log('══════════════════════════════════════════════════════');
  if (allPass) {
    console.log('  Preflight PASSED — ready for Step 1 (escrow contract).\n');
  } else {
    console.log('  Preflight FAILED — fix errors above before continuing.\n');
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error('\n✗ Preflight crashed:', (e as Error).message);
  process.exit(1);
});
