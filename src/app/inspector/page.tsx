'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrailNode {
  rawIndex:       number;
  nodeIndex:      number;
  blobId:         string;
  commitmentHex:  string;
  encryptionIdHex: string;
  action:         string;
  outcome:        string;
  timestamp:      string;
}

interface DelegationData {
  objectId:    string;
  type:        string;
  status:      number;
  statusLabel: string;
  budget:      string;
  budgetUsdc:  string;
  principal:   string;
  agent:       string;
  deadlineIso: string;
  taskSpec:    string;
  nodes:       TrailNode[];
  network:     string;
}

interface DecryptResult {
  blobId:  string;
  payload: Record<string, unknown>;
  isStub:  boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function short(s: string, n = 8): string {
  return `${s.slice(0, n)}…${s.slice(-4)}`;
}

const STATUS_STYLE: Record<number, string> = {
  0: 'border-yellow-700 bg-yellow-900/20 text-yellow-300',
  1: 'border-blue-700   bg-blue-900/20   text-blue-300',
  2: 'border-violet-700 bg-violet-900/20 text-violet-300',
  3: 'border-green-700  bg-green-900/20  text-green-300',
};

function nodeLabel(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('balance') || a.includes('tatum') || a.includes('suix_getall'))
    return 'Portfolio Read';
  if (a.includes('compos') || a.includes('alloc') || a.includes('allocation'))
    return 'Composition Analysis';
  if (a.includes('recommend') || a.includes('rebalanc'))
    return 'Rebalance Recommendation';
  return action.length > 55 ? action.slice(0, 55) + '…' : action;
}

function OutcomeSummary({ action, outcome }: { action: string; outcome: string }) {
  try {
    const obj = JSON.parse(outcome) as Record<string, unknown>;
    const a = action.toLowerCase();

    if (a.includes('balance') || a.includes('tatum') || a.includes('suix_getall')) {
      const sui  = (obj.sui  as { sui?: string })?.sui;
      const usdc = (obj.usdc as { usdc?: string })?.usdc;
      if (sui && usdc) return <>{sui} SUI&nbsp;·&nbsp;{usdc} USDC liquid</>;
    }

    if (a.includes('compos') || a.includes('alloc')) {
      const comp = obj.composition as { SUI?: { pct: string }; USDC?: { pct: string } } | undefined;
      const risk = obj.risk_profile as string | undefined;
      if (comp) return <>{comp.SUI?.pct}% SUI&nbsp;·&nbsp;{comp.USDC?.pct}% USDC{risk ? ` · ${risk}` : ''}</>;
    }

    if (a.includes('recommend') || a.includes('rebalanc')) {
      const rec = (obj.recommendation as { direction?: string; asset?: string; target_allocation?: { SUI_pct?: number; USDC_pct?: number } } | undefined);
      if (rec) {
        const dir = rec.direction?.toUpperCase();
        return <>{dir} {rec.asset}&nbsp;→&nbsp;target {rec.target_allocation?.SUI_pct}% SUI&nbsp;/&nbsp;{rec.target_allocation?.USDC_pct}% USDC</>;
      }
    }
  } catch { /* not parseable */ }

  const preview = typeof outcome === 'string' ? outcome.slice(0, 80) : '';
  return <span className="text-zinc-500">{preview}{preview.length >= 80 ? '…' : ''}</span>;
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

function NodeCard({ node }: { node: TrailNode }) {
  const [decrypted, setDecrypted] = useState<DecryptResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  const reveal = async () => {
    if (decrypted || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/decrypt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ blobId: node.blobId, encryptionIdHex: node.encryptionIdHex }),
      });
      const data = await res.json() as DecryptResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setDecrypted(data);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const title = nodeLabel(node.action);

  return (
    <div className="flex-1 min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      {/* Card header */}
      <div className="flex items-start gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-zinc-50">{title}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
              idx {node.nodeIndex}
            </span>
          </div>

          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            <OutcomeSummary action={node.action} outcome={node.outcome} />
          </p>

          <div className="flex items-center gap-3 mt-2.5 flex-wrap">
            {node.timestamp && (
              <span className="text-[11px] text-zinc-600">
                {new Date(node.timestamp).toLocaleString('en', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                  timeZoneName: 'short',
                })}
              </span>
            )}
            <a
              href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${node.blobId}`}
              target="_blank"
              className="text-[11px] font-mono text-indigo-500 hover:text-indigo-400 truncate max-w-[140px]"
              title={node.blobId}
            >
              {short(node.blobId, 12)}
            </a>
            <span
              className="text-[11px] font-mono text-zinc-700 truncate max-w-[100px]"
              title={`keccak256: ${node.commitmentHex}`}
            >
              {short(node.commitmentHex, 8)} keccak
            </span>
          </div>
        </div>

        {/* Reveal button */}
        <button
          onClick={reveal}
          disabled={loading || !!decrypted}
          className={[
            'flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border',
            'transition-all duration-150',
            decrypted
              ? 'border-green-700 bg-green-900/20 text-green-400 cursor-default'
              : loading
                ? 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-wait'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-indigo-600 hover:bg-indigo-900/30 hover:text-indigo-300',
          ].join(' ')}
        >
          {decrypted ? (
            <><span>🔓</span> Revealed</>
          ) : loading ? (
            <><span className="animate-spin inline-block">⟳</span> Decrypting…</>
          ) : (
            <><span>🔐</span> Reveal</>
          )}
        </button>
      </div>

      {/* Error */}
      {err && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-red-950/50 border border-red-900 text-xs text-red-400">
          {err}
        </div>
      )}

      {/* Decrypted payload */}
      {decrypted && (
        <div className="border-t border-zinc-800">
          {/* Banner */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-950/40 border-b border-indigo-900/30">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-[11px] text-indigo-300 font-medium">
              {decrypted.isStub ? 'SEAL stub — plaintext payload (encryption wired in Step 4)' : 'Seal decrypted — private reasoning revealed'}
            </span>
          </div>

          {/* Structured view */}
          {typeof decrypted.payload === 'object' && decrypted.payload !== null && (
            <div className="px-4 py-3 space-y-2">
              {(['memory_used', 'data_inputs', 'active_policies'] as const).map(key => {
                const val = (decrypted.payload as Record<string, unknown>)[key];
                if (!val) return null;
                return (
                  <div key={key}>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">{key.replace(/_/g, ' ')}</p>
                    {Array.isArray(val) ? (
                      <ul className="space-y-0.5">
                        {(val as string[]).map((item, i) => (
                          <li key={i} className="text-xs text-zinc-300 font-mono pl-2 border-l border-zinc-700">
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-300 font-mono pl-2 border-l border-zinc-700">{String(val)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Raw JSON */}
          <details className="group">
            <summary className="px-4 py-2.5 text-[11px] text-zinc-600 cursor-pointer hover:text-zinc-400 select-none border-t border-zinc-800/50">
              Raw JSON <span className="group-open:hidden">▸</span><span className="hidden group-open:inline">▾</span>
            </summary>
            <pre className="px-4 pb-4 text-[11px] font-mono text-zinc-400 overflow-auto max-h-64 leading-relaxed">
              {JSON.stringify(decrypted.payload, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ── SettlePanel ───────────────────────────────────────────────────────────────

function SettlePanel({ delegation }: { delegation: DelegationData }) {
  const [settling,  setSettling]  = useState(false);
  const [settleTx,  setSettleTx]  = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState<DelegationData>(delegation);
  const [err,       setErr]       = useState<string | null>(null);

  const settled    = refreshed.status === 3;
  const submittable = refreshed.status === 2;
  const network    = delegation.network;
  const explorerBase = `https://suiscan.xyz/${network}`;

  const settle = async () => {
    setSettling(true);
    setErr(null);
    try {
      const res  = await fetch('/api/settle', { method: 'POST' });
      const data = await res.json() as {
        error?: string;
        txDigest?: string;
        alreadySettled?: boolean;
        explorerUrl?: string;
      };
      if (data.error) throw new Error(data.error);
      if (data.txDigest) setSettleTx(data.txDigest);
      // Refresh delegation state
      const fresh = await fetch('/api/delegation').then(r => r.json()) as DelegationData;
      if (!('error' in fresh)) setRefreshed(fresh);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSettling(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Settlement</h2>

      {/* Commitment summary */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
        <span className="w-5 h-5 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-green-400 text-xs">✓</span>
        </span>
        <div>
          <p className="text-sm text-zinc-200 font-medium">
            {delegation.nodes.length} trail node{delegation.nodes.length !== 1 ? 's' : ''} anchored on-chain
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            All Walrus blobs retrievable · keccak256 commitments verified
          </p>
        </div>
      </div>

      {/* Settle / Settled */}
      {settled ? (
        <div className="rounded-xl bg-green-950/30 border border-green-800/50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-green-400 font-semibold text-sm">✓ Settled</p>
              <p className="text-xs text-zinc-400 mt-1">
                1.00 USDC released · budget now {refreshed.budgetUsdc} USDC
              </p>
              <p className="text-xs text-zinc-600 mt-1 italic">
                "The agent got paid because it could prove how it decided."
              </p>
            </div>
            <a
              href={`${explorerBase}/object/${delegation.objectId}`}
              target="_blank"
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Object ↗
            </a>
          </div>
          {settleTx && (
            <a
              href={`${explorerBase}/tx/${settleTx}`}
              target="_blank"
              className="mt-3 block text-xs font-mono text-indigo-400 hover:text-indigo-300"
            >
              Settle tx: {short(settleTx, 16)} ↗
            </a>
          )}
        </div>
      ) : (
        <button
          onClick={settle}
          disabled={!submittable || settling}
          className={[
            'w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-150',
            submittable && !settling
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30'
              : 'bg-zinc-800 text-zinc-500 cursor-not-allowed',
          ].join(' ')}
        >
          {settling
            ? 'Submitting to Sui…'
            : submittable
              ? 'Settle · Release 1 USDC to Agent'
              : `Cannot settle (status: ${refreshed.statusLabel})`}
        </button>
      )}

      {err && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{err}</p>
      )}
    </section>
  );
}

// ── InspectorPage ─────────────────────────────────────────────────────────────

export default function InspectorPage() {
  const [delegation, setDelegation] = useState<DelegationData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/delegation');
      const data = await res.json() as DelegationData & { error?: string };
      if (data.error) throw new Error(data.error);
      setDelegation(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-zinc-500">Fetching delegation from Sui…</p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !delegation) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-red-400 text-sm">{error ?? 'Failed to load delegation.'}</p>
          <button
            onClick={() => void load()}
            className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-3 py-1.5 rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const network      = delegation.network;
  const explorerBase = `https://suiscan.xyz/${network}`;
  const statusStyle  = STATUS_STYLE[delegation.status] ?? 'border-zinc-700 bg-zinc-800 text-zinc-400';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-600/40 flex items-center justify-center">
              <span className="text-indigo-400 text-xs font-bold">P</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-400 font-semibold leading-none">Provenant</p>
              <p className="text-sm font-semibold text-zinc-50 leading-tight mt-0.5">Inspector</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`${explorerBase}/object/${delegation.objectId}`}
              target="_blank"
              className="text-xs font-mono text-zinc-500 hover:text-zinc-300 hidden sm:block"
            >
              {short(delegation.objectId, 10)}
            </a>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusStyle}`}>
              {delegation.statusLabel}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* ── Delegation metadata ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-4">Delegation</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Object</p>
              <a href={`${explorerBase}/object/${delegation.objectId}`} target="_blank"
                className="text-xs font-mono text-indigo-400 hover:text-indigo-300 break-all">
                {short(delegation.objectId, 10)}
              </a>
            </div>
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Budget</p>
              <p className="text-sm font-semibold text-zinc-200">{delegation.budgetUsdc} USDC</p>
              {delegation.status === 3 && <p className="text-[10px] text-green-500 mt-0.5">released</p>}
            </div>
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Principal</p>
              <p className="text-xs font-mono text-zinc-400">{short(delegation.principal, 10)}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Deadline</p>
              <p className="text-xs text-zinc-400">
                {new Date(delegation.deadlineIso).toLocaleDateString('en', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Task</p>
              <p className="text-xs font-mono text-zinc-400">{delegation.taskSpec}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Network</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800 text-zinc-400 font-mono">
                {network}
              </span>
            </div>
          </div>
        </section>

        {/* ── Decision trail ───────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              Decision Trail
            </h2>
            <span className="text-[11px] text-zinc-600">
              {delegation.nodes.length} node{delegation.nodes.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="relative">
            {/* Vertical spine line */}
            {delegation.nodes.length > 1 && (
              <div className="absolute left-5 top-6 bottom-6 w-px bg-zinc-800 pointer-events-none" />
            )}

            <div className="space-y-3">
              {delegation.nodes.map((node) => (
                <div key={node.rawIndex} className="flex gap-4 items-start">
                  {/* Index bubble */}
                  <div className="relative z-10 flex-shrink-0 w-10 h-10 rounded-full bg-zinc-950 border border-zinc-700 flex items-center justify-center mt-1">
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {node.nodeIndex}
                    </span>
                  </div>

                  <NodeCard node={node} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Settlement ───────────────────────────────────────────────── */}
        <SettlePanel delegation={delegation} />

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer className="text-center py-4 text-[10px] text-zinc-700">
          Provenant · Proof-gated escrow on Sui · Walrus + Seal
        </footer>
      </div>
    </div>
  );
}
