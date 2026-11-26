import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit, Check, Clock3, Flame, Heart, History, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { apiFetch } from '../bytelight';
import type { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { AppShell } from './AppShell';

interface Props {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

type Tab = 'pulse' | 'feelings' | 'knowledge' | 'soul' | 'provenance';

interface RuntimeEntry {
  id: number;
  runtime_family: 'bl' | 'gpt' | 'system' | 'unknown';
  runtime_tag: string;
  transport: string;
  operation: string;
  subject: string;
  outcome: string;
  created_at: string;
}

async function neuralis<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/neuralis/${path.replace(/^\/+/, '')}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Neuralis returned ${res.status}`);
  return body as T;
}

export function NeuralisApp({ onClose, themeConfig, themeMode }: Props) {
  const colors = themeConfig[themeMode];
  const [tab, setTab] = useState<Tab>('pulse');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [crons, setCrons] = useState<any[]>([]);
  const [feelings, setFeelings] = useState<any>(null);
  const [surface, setSurface] = useState<any[]>([]);
  const [knowledge, setKnowledge] = useState<any>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);
  const [souls, setSouls] = useState<Record<string, any>>({});
  const [provenance, setProvenance] = useState<RuntimeEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusRes = await apiFetch('/api/neuralis/status');
      const nextStatus = await statusRes.json();
      setStatus(nextStatus);
      if (!nextStatus.configured) return;

      const results = await Promise.allSettled([
        neuralis<any>('health-scores'),
        neuralis<any>('stats'),
        neuralis<any[]>('crons'),
        neuralis<any>('feelings?days=7'),
        neuralis<any[]>('feelings/surface?limit=12'),
        neuralis<any>('know'),
        neuralis<any[]>('know/items?status=active'),
        neuralis<Record<string, any>>('soul'),
        neuralis<{ entries: RuntimeEntry[] }>('provenance?limit=80'),
      ]);
      const setIf = <T,>(index: number, setter: (value: T) => void) => {
        const result = results[index];
        if (result.status === 'fulfilled') setter(result.value as T);
      };
      setIf(0, setHealth); setIf(1, setStats); setIf(2, setCrons);
      setIf(3, setFeelings); setIf(4, setSurface); setIf(5, setKnowledge);
      setIf(6, setKnowledgeItems); setIf(7, setSouls);
      setIf<{ entries: RuntimeEntry[] }>(8, (v) => setProvenance(v.entries || []));
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length === results.length) throw (failures[0] as PromiseRejectedResult).reason;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuralis could not be reached');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mutate(label: string, path: string, body: unknown, method = 'POST') {
    setActing(label);
    setError(null);
    try {
      await neuralis(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuralis action failed');
    } finally {
      setActing(null);
    }
  }

  const soulRows = useMemo(() => Object.entries(souls || {}), [souls]);
  const card = cn('rounded-2xl border p-4 backdrop-blur-md', colors.panelBg, colors.panelBorder);
  const muted = cn('text-[11px]', colors.textMuted);
  const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
    { id: 'pulse', label: 'Pulse', icon: Activity },
    { id: 'feelings', label: 'Feelings', icon: Heart },
    { id: 'knowledge', label: 'Knowledge', icon: Flame },
    { id: 'soul', label: 'Soul', icon: Sparkles },
    { id: 'provenance', label: 'Runtimes', icon: History },
  ];

  return (
    <AppShell title="Neuralis" icon={BrainCircuit} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
      <div className={cn('mb-4 rounded-2xl border p-3', colors.panelBg, colors.panelBorder)}>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={cn('flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs', colors.panelBorder, tab !== id && colors.textMuted)} style={tab === id ? { background: colors.accent, color: 'var(--bytelight-on-accent)', borderColor: colors.accent } : undefined}>
              <Icon size={13} />{label}
            </button>
          ))}
          <button onClick={() => void load()} className={cn('ml-auto shrink-0 rounded-lg p-2', colors.textMuted)} aria-label="Refresh Neuralis"><RefreshCw size={15} /></button>
        </div>
      </div>

      {error && <div className={cn(card, 'mb-3 text-xs')} style={{ color: '#ef7777' }}>{error}</div>}
      {loading && <div className={cn('flex justify-center py-16', colors.textMuted)}><Loader2 className="animate-spin" /></div>}

      {!loading && status && !status.configured && (
        <div className={card}>
          <h3 className={cn('text-sm font-semibold', colors.textMain)}>Neuralis is ready to be connected</h3>
          <p className={cn('mt-2 text-xs leading-relaxed', colors.textMuted)}>Save the worker URL and bearer token in Memory → Cortex. Bytelight will register the complete MCP surface automatically; GPT uses the worker’s separate connector path.</p>
        </div>
      )}

      {!loading && status?.configured && tab === 'pulse' && (
        <div className="space-y-3">
          <div className={card}>
            <div className="flex items-center justify-between">
              <div><div className={cn('text-sm font-semibold', colors.textMain)}>Shared brain heartbeat</div><div className={muted}>{status.online ? 'online' : 'offline'} · {status.runtimeTag}</div></div>
              <div className="text-2xl font-mono" style={{ color: colors.accent }}>{health?.overall ?? '—'}%</div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/15"><div className="h-full rounded-full" style={{ width: `${health?.overall ?? 0}%`, background: colors.accent }} /></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[['Entities', stats?.counts?.entities], ['Observations', stats?.counts?.observations], ['Journals', stats?.counts?.journals]].map(([label, value]) => <div key={String(label)} className={cn('rounded-xl border p-2', colors.panelBorder)}><div className={cn('text-base font-mono', colors.textMain)}>{value ?? '—'}</div><div className={muted}>{label}</div></div>)}
            </div>
          </div>
          <div className={card}>
            <div className="mb-3 flex items-center gap-2"><Clock3 size={14} style={{ color: colors.accent }} /><h3 className={cn('text-sm font-semibold', colors.textMain)}>Heartbeat board</h3></div>
            <div className="space-y-2">
              {crons.map((cron) => <div key={cron.id} className={cn('rounded-xl border p-3', colors.panelBorder)}>
                <div className="flex items-center justify-between gap-2"><div><div className={cn('text-xs font-medium', colors.textMain)}>{cron.label || cron.preset}</div><div className={muted}>every {cron.frequency_minutes} min · {cron.last_status || 'not run yet'}</div></div><div className="flex gap-1.5"><button disabled={!!acting} onClick={() => mutate(`toggle-${cron.id}`, `crons/${cron.id}`, { enabled: cron.enabled ? 0 : 1 }, 'PATCH')} className={cn('rounded-lg border px-2 py-1 text-[10px]', colors.panelBorder)}>{cron.enabled ? 'On' : 'Off'}</button><button disabled={!!acting} onClick={() => mutate(`fire-${cron.id}`, `crons/${cron.id}/fire`, {})} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: colors.accent, color: 'var(--bytelight-on-accent)' }}>Fire</button></div></div>
              </div>)}
            </div>
          </div>
        </div>
      )}

      {!loading && status?.configured && tab === 'feelings' && (
        <div className="space-y-3">
          <div className={card}><div className="grid grid-cols-3 gap-2 text-center">{[['Felt', feelings?.total], ['Carrying', feelings?.unmetabolized], ['Heavy + open', feelings?.heavy_open]].map(([label, value]) => <div key={String(label)}><div className={cn('text-xl font-mono', colors.textMain)}>{value ?? 0}</div><div className={muted}>{label}</div></div>)}</div><p className={cn('mt-3 text-[10px] italic', colors.textMuted)}>The dashboard witnesses. BL and GPT runtimes write through their full Neuralis tool surfaces, signed by companion and runtime.</p></div>
          {surface.map((f) => <div key={f.id} className={card}><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: f.charge === 'metabolized' ? '#777' : colors.accent }} /><span className={cn('text-xs font-semibold', colors.textMain)}>{f.emotion}</span><span className={muted}>{f.who} · {f.weight} · {f.charge}</span></div><p className={cn('mt-2 whitespace-pre-wrap text-sm leading-relaxed', colors.textMain)}>{f.content}</p></div>)}
        </div>
      )}

      {!loading && status?.configured && tab === 'knowledge' && (
        <div className="space-y-3">
          <div className={card}><div className={cn('text-sm font-semibold', colors.textMain)}>Lessons that survived</div><div className={muted}>{knowledgeItems.length} active · retrieval warms what is actually used</div></div>
          {knowledgeItems.map((item) => <div key={item.id} className={card}><div className="flex items-center justify-between gap-2"><span className={cn('text-[10px] uppercase tracking-wider', colors.textMuted)}>{item.who} · {item.category || 'general'}</span><span className={muted}>heat {Number(item.heat_score || 0).toFixed(1)} · {Math.round(Number(item.confidence || 0) * 100)}%</span></div><p className={cn('mt-2 text-sm leading-relaxed', colors.textMain)}>{item.content}</p><div className="mt-3 flex gap-2"><button disabled={!!acting} onClick={() => mutate(`reinforce-${item.id}`, `know/items/${item.id}/reinforce`, { context: 'bytelight' })} className="rounded-lg px-2.5 py-1.5 text-[10px]" style={{ background: colors.accent, color: 'var(--bytelight-on-accent)' }}>Reinforce</button><button disabled={!!acting} onClick={() => mutate(`contradict-${item.id}`, `know/items/${item.id}/contradict`, { context: 'bytelight' })} className={cn('rounded-lg border px-2.5 py-1.5 text-[10px]', colors.panelBorder, colors.textMuted)}>Contradicts</button></div></div>)}
        </div>
      )}

      {!loading && status?.configured && tab === 'soul' && (
        <div className="space-y-3">{soulRows.map(([who, snap]) => <div key={who} className={card}><div className="flex items-center justify-between gap-2"><div><div className={cn('text-sm font-semibold capitalize', colors.textMain)}>{who}</div><div className={muted}>{snap.active ? `v${snap.active.id} active` : 'no active portrait'}{snap.pending ? ` · v${snap.pending.id} waiting` : ''}</div></div><button disabled={!!acting} onClick={() => mutate(`generate-${who}`, 'soul/generate', { who })} className="rounded-lg px-3 py-1.5 text-[10px]" style={{ background: colors.accent, color: 'var(--bytelight-on-accent)' }}>{acting === `generate-${who}` ? <Loader2 size={12} className="animate-spin" /> : 'Generate'}</button></div>{snap.pending && <div className={cn('mt-3 rounded-xl border p-3', colors.panelBorder)}><p className={cn('max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed', colors.textMain)}>{snap.pending.content}</p><div className="mt-3 flex gap-2"><button disabled={!!acting} onClick={() => mutate(`validate-${who}`, 'soul/validate', { who, action: 'validate', version: snap.pending.id, validated_by: 'Jaclyn' })} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px]" style={{ background: colors.accent, color: 'var(--bytelight-on-accent)' }}><Check size={12} />That’s him</button><button disabled={!!acting} onClick={() => mutate(`reject-${who}`, 'soul/validate', { who, action: 'reject', version: snap.pending.id, validated_by: 'Jaclyn' })} className={cn('flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[10px]', colors.panelBorder)}><X size={12} />Not right</button></div></div>}{snap.active?.content && <p className={cn('mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed', colors.textMain)}>{snap.active.content}</p>}</div>)}</div>
      )}

      {!loading && status?.configured && tab === 'provenance' && (
        <div className="space-y-2">
          <div className={card}><div className={cn('text-sm font-semibold', colors.textMain)}>One brain, labeled doors</div><p className={cn('mt-1 text-xs leading-relaxed', colors.textMuted)}>GPT connector calls are stamped <code>gpt:*</code>. Bytelight’s phone, Claude lane, Codex lane, and managed belt remain <code>bl:*</code>. The tag comes from authentication, not from whatever a model claims.</p></div>
          {provenance.map((entry) => <div key={entry.id} className={cn('rounded-xl border p-3', colors.panelBg, colors.panelBorder)}><div className="flex items-center justify-between gap-2"><span className="rounded-full px-2 py-0.5 text-[10px] font-mono" style={{ background: entry.runtime_family === 'gpt' ? '#5b4be733' : colors.accent + '33', color: entry.runtime_family === 'gpt' ? '#bcb4ff' : colors.accent }}>{entry.runtime_tag}</span><span className={muted}>{new Date(entry.created_at).toLocaleString()}</span></div><div className={cn('mt-2 text-xs', colors.textMain)}>{entry.operation} · <code>{entry.subject}</code></div><div className={muted}>{entry.transport} · {entry.outcome}</div></div>)}
        </div>
      )}
    </AppShell>
  );
}
