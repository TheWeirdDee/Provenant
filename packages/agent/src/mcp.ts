/**
 * Thin wrapper around @tatumio/blockchain-mcp GatewayService.
 * Exposes gatewayRpc() so agent.ts can call Sui RPC methods through
 * the MCP gateway instead of raw fetch, and get a pre-formatted
 * data_inputs[] entry back with each call.
 */
import { GatewayService } from '@tatumio/blockchain-mcp/dist/services/gateway.js';

const SUI_NETWORK = process.env.SUI_NETWORK ?? 'testnet';
export const SUI_CHAIN = `sui-${SUI_NETWORK}`;

let _svc: GatewayService | null = null;

async function getSvc(): Promise<GatewayService> {
  if (!_svc) {
    _svc = new GatewayService(process.env.TATUM_API_KEY!);
    await _svc.initialize();
  }
  return _svc;
}

export interface McpResult<T> {
  result: T;
  dataInput: string;
}

function summarize(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} coin(s)`;
  if (result && typeof result === 'object') {
    const o = result as Record<string, unknown>;
    if (o.data && typeof o.data === 'object') {
      const d = o.data as Record<string, unknown>;
      if (d.content && typeof d.content === 'object') {
        const fields = (d.content as Record<string, unknown>).fields as Record<string, unknown> | undefined;
        if (fields?.status !== undefined) return `status=${fields.status}`;
      }
    }
    if (o.totalBalance !== undefined) return `balance=${o.totalBalance}`;
  }
  const s = JSON.stringify(result);
  return s ? s.slice(0, 60) : 'ok';
}

/**
 * Execute a Sui RPC method through the Tatum MCP gateway.
 * Returns the typed result plus a pre-formatted data_inputs[] entry:
 *   "gateway_execute_rpc(method, 0xabc…) → N coins"
 */
export async function gatewayRpc<T>(method: string, params: unknown[]): Promise<McpResult<T>> {
  const svc = await getSvc();

  const response = await svc.executeChainRequest({
    chainName: SUI_CHAIN,
    method,
    params,
  });

  if (response.error) {
    throw new Error(`gateway_execute_rpc(${method}) failed: ${response.error}`);
  }

  // executeJsonRpcRequest wraps the response: { data: { jsonrpc, id, result?, error? } }
  const body = response.data as { result?: T; error?: { message: string } };
  if (body?.error) throw new Error(`${method} RPC error: ${body.error.message}`);
  const result = body?.result as T;

  const p0 = params.length > 0 ? JSON.stringify(params[0]) : '';
  const shortP = p0.startsWith('"0x') ? p0.slice(0, 12) + '…"' : p0.slice(0, 30);
  const dataInput = `gateway_execute_rpc(${method}, ${shortP}) → ${summarize(result)}`;

  return { result, dataInput };
}
