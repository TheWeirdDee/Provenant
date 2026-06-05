import { NextResponse } from 'next/server';

const TATUM_KEY     = process.env.TATUM_API_KEY!;
const DELEGATION_ID = process.env.DELEGATION_OBJECT_ID!;
const NETWORK       = process.env.SUI_NETWORK ?? 'testnet';
const RPC_URL       = `https://sui-${NETWORK}.gateway.tatum.io`;

const STATUS_LABELS = ['Funded', 'Claimed', 'Submitted', 'Settled', 'Refunded', 'Disputed'] as const;

interface RawNode {
  fields: {
    index:         number;
    blob_id:       number[];
    encryption_id: number[];
    commitment:    number[];
    public_meta:   number[];
  };
}

interface PublicMeta {
  index:     number;
  action:    string;
  outcome:   string;
  timestamp: string;
}

function bytes2str(b: number[])  { return Buffer.from(b).toString('utf-8'); }
function bytes2hex(b: number[])  { return Buffer.from(b).toString('hex'); }

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': TATUM_KEY },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache:   'no-store' as any,
  });
  const body = await res.json() as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export async function GET() {
  try {
    const obj = await rpc<{
      data: {
        objectId: string;
        type:     string;
        content:  {
          fields: {
            status:      number;
            budget:      string;
            principal:   string;
            agent:       string;
            deadline_ms: string;
            task_spec:   number[];
            nodes:       RawNode[];
          };
        };
      };
    }>('sui_getObject', [DELEGATION_ID, { showContent: true, showType: true }]);

    const f = obj.data.content.fields;

    const nodes = f.nodes.map((n, rawIndex) => {
      const blobId          = bytes2str(n.fields.blob_id);
      const commitmentHex   = bytes2hex(n.fields.commitment);
      const encryptionIdHex = bytes2hex(n.fields.encryption_id);

      let meta: Partial<PublicMeta> = {};
      try { meta = JSON.parse(bytes2str(n.fields.public_meta)); } catch { /* ignore */ }

      return {
        rawIndex,
        nodeIndex:     n.fields.index,
        blobId,
        commitmentHex,
        encryptionIdHex,
        action:    meta.action    ?? '',
        outcome:   meta.outcome   ?? '',
        timestamp: meta.timestamp ?? '',
      };
    });

    return NextResponse.json({
      objectId:    DELEGATION_ID,
      type:        obj.data.type,
      status:      f.status,
      statusLabel: STATUS_LABELS[f.status] ?? 'Unknown',
      budget:      f.budget,
      budgetUsdc:  (Number(f.budget) / 1e6).toFixed(2),
      principal:   f.principal,
      agent:       f.agent,
      deadlineMs:  f.deadline_ms,
      deadlineIso: new Date(Number(f.deadline_ms)).toISOString(),
      taskSpec:    bytes2str(f.task_spec),
      nodes,
      network: NETWORK,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
