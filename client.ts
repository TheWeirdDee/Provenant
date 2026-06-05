import axios from 'axios';
import 'dotenv/config';

// ─── Tatum Gateway Client ─────────────────────────────────────────────────────
// Every on-chain read the agent makes MUST go through this client.
// Each call is logged so it can appear in data_inputs on the decision node.

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const BASE_URL = NETWORK === 'mainnet'
  ? 'https://sui-mainnet.gateway.tatum.io'
  : 'https://sui-testnet.gateway.tatum.io';

const API_KEY = process.env.TATUM_API_KEY;

// Call log — cleared per node, used to build data_inputs[]
let callLog: string[] = [];

export function clearCallLog() { callLog = []; }
export function getCallLog() { return [...callLog]; }

// ─── Core RPC ─────────────────────────────────────────────────────────────────

async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  if (!API_KEY) {
    throw new Error(
      'TATUM_API_KEY is not set. Get a free key at https://dashboard.tatum.io'
    );
  }

  const res = await axios.post(
    BASE_URL,
    { jsonrpc: '2.0', id: 1, method, params },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
    }
  );

  if (res.data.error) {
    throw new Error(`Tatum RPC error [${method}]: ${JSON.stringify(res.data.error)}`);
  }

  return res.data.result as T;
}

// ─── Sui Methods ──────────────────────────────────────────────────────────────

/** Get all coin balances for an address */
export async function getAllBalances(address: string) {
  const result = await rpc<{ coinType: string; totalBalance: string }[]>(
    'suix_getAllBalances',
    [address]
  );
  callLog.push(`suix_getAllBalances(${address.slice(0, 8)}…) → ${result.length} coins`);
  return result;
}

/** Get balance for a specific coin type */
export async function getBalance(address: string, coinType: string) {
  const result = await rpc<{ coinType: string; totalBalance: string }>(
    'suix_getBalance',
    [address, coinType]
  );
  callLog.push(`suix_getBalance(${address.slice(0, 8)}…, ${coinType.split('::').pop()}) → ${result.totalBalance}`);
  return result;
}

/** Get owned objects */
export async function getOwnedObjects(address: string, filter?: { StructType: string }) {
  const result = await rpc<{ data: unknown[] }>(
    'suix_getOwnedObjects',
    [address, { filter, options: { showContent: true, showType: true } }]
  );
  callLog.push(`suix_getOwnedObjects(${address.slice(0, 8)}…) → ${result.data.length} objects`);
  return result.data;
}

/** Get a single Sui object (e.g. Delegation, AgentRecord) */
export async function getObject(objectId: string) {
  const result = await rpc<{ data: unknown }>(
    'sui_getObject',
    [objectId, { showContent: true, showType: true, showOwner: true }]
  );
  callLog.push(`sui_getObject(${objectId.slice(0, 8)}…)`);
  return result.data;
}

/** Get transaction history for an address */
export async function getTransactionHistory(address: string, limit = 10) {
  const result = await rpc<{ data: unknown[] }>(
    'suix_queryTransactionBlocks',
    [{ filter: { FromAddress: address } }, null, limit, true]
  );
  callLog.push(`suix_queryTransactionBlocks(${address.slice(0, 8)}…) → ${result.data.length} txs`);
  return result.data;
}

/** Verify a specific transaction exists on-chain (used in settlement verification) */
export async function getTransaction(digest: string) {
  const result = await rpc<unknown>(
    'sui_getTransactionBlock',
    [digest, { showEffects: true, showInput: true }]
  );
  callLog.push(`sui_getTransactionBlock(${digest.slice(0, 8)}…)`);
  return result;
}

/** Ping the gateway — used in preflight */
export async function ping(): Promise<boolean> {
  try {
    await rpc('sui_getChainIdentifier', []);
    return true;
  } catch {
    return false;
  }
}

// ─── Data API ─────────────────────────────────────────────────────────────────
// Tatum Data API for portfolio/metadata — used in settlement verification

export async function getPortfolio(address: string) {
  if (!API_KEY) throw new Error('TATUM_API_KEY is not set');

  const res = await axios.get(
    `https://api.tatum.io/v4/data/balances?chain=SUI&addresses=${address}`,
    { headers: { 'x-api-key': API_KEY } }
  );
  callLog.push(`TatumDataAPI:getPortfolio(${address.slice(0, 8)}…)`);
  return res.data;
}
