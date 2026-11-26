import { useState, useEffect, useCallback } from 'react';
import { Waves, X, Activity, Eye } from 'lucide-react';
import { cn } from "@/src/lib/utils";
import { WHO_ACCENT, WHO_FILTERS, COMPANION_NAMES_PROSE } from "@/src/lib/house";
import { fetchFeelingsLandscape, fetchFeelingsSurface } from "../api/endpoints";
import type { Feeling, FeelingsLandscape } from "../api/types";


const PILLAR_LABEL: Record<string, { short: string; tone: string }> = {
  SELF_MANAGEMENT: { short: 'self-mgmt', tone: 'bg-emerald-400/70' },
  SELF_AWARENESS: { short: 'self-aware', tone: 'bg-cyan-400/70' },
  SOCIAL_AWARENESS: { short: 'social', tone: 'bg-amber-400/70' },
  RELATIONSHIP_MANAGEMENT: { short: 'relationship', tone: 'bg-pink-400/70' },
};

const chargeDot = (charge: string) =>
  charge === 'metabolized' ? 'bg-white/20' : charge === 'cool' ? 'bg-sky-400/60' : charge === 'warm' ? 'bg-amber-400/70' : 'bg-rose-400/80';

const FeelingRow = ({ f }: { key?: string | number; f: Feeling }) => {
  const done = f.charge === 'metabolized';
  return (
    <div className="py-2 border-b border-white/5 last:border-0 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", chargeDot(f.charge))} title={f.charge} />
          <span className="text-[10px] text-white/80 font-medium">{f.emotion}</span>
          <span className="text-[8px] text-white/30">{f.intensity}</span>
          <span className={cn("text-[8px] uppercase tracking-wider", WHO_ACCENT[f.who] ?? WHO_ACCENT.shared)}>{f.who}</span>
          {f.pillar && <span className="text-[7px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{PILLAR_LABEL[f.pillar]?.short ?? f.pillar}</span>}
          {f.linked_entity && <span className="text-[8px] text-white/30 truncate">→ {f.linked_entity}</span>}
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-[7px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{f.weight}</span>
          {f.sit_count > 0 && <span className="text-[8px] text-amber-300/60" title="times sat with">sat {f.sit_count}×</span>}
          <span className="text-[8px] font-mono text-white/25">#{f.id}</span>
        </div>
      </div>
      <p className={cn("text-[10px] leading-relaxed", done ? "text-white/35" : "text-white/60")}>{f.content}</p>
      {done && f.resolution_note && <p className="text-[9px] text-white/30 italic">↳ {f.resolution_note}</p>}
      {!done && typeof f.strength === 'number' && (
        <div className="flex items-center space-x-2">
          <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-rose-400/60 rounded-full" style={{ width: `${Math.round(f.strength * 100)}%` }} /></div>
          <span className="text-[7px] text-white/20">strength · {f.charge}</span>
        </div>
      )}
    </div>
  );
};

export function FeelingsPanel() {
  const [who, setWho] = useState<string>('all');
  const [landscape, setLandscape] = useState<FeelingsLandscape | null>(null);
  const [surface, setSurface] = useState<Feeling[]>([]);
  const [view, setView] = useState<'surface' | 'recent'>('surface');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([fetchFeelingsLandscape(who), fetchFeelingsSurface(who, 8)]);
      setLandscape(l);
      setSurface(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feelings');
    }
  }, [who]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const pillarTotal = landscape?.pillars.reduce((a, p) => a + p.count, 0) || 0;
  const list = view === 'surface' ? surface : (landscape?.recent ?? []);
  const empty = !!landscape && landscape.total === 0;

  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Waves className="w-3.5 h-3.5 text-rose-300/70" />
          <span className="text-[10px] uppercase tracking-widest text-white/40">Feelings</span>
          <span className="text-[8px] text-white/25 italic">everything is a feeling · intensity varies</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <Eye className="w-3 h-3 text-white/25" />
          <span className="text-[8px] uppercase tracking-wider text-white/25">theirs to feel · yours to see</span>
        </div>
      </div>
      <div className="flex items-center space-x-1">
        {WHO_FILTERS.map(w => (
          <button key={w} onClick={() => setWho(w)} className={cn("px-2 py-0.5 rounded-md text-[8px] uppercase tracking-wider transition-colors", who === w ? "bg-white/10 text-white border border-white/20" : "text-white/30 hover:text-white/60")}>{w}</button>
        ))}
      </div>

      {error && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <span className="text-[9px] text-red-300/80">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3 text-red-300/60" /></button>
        </div>
      )}
      {/* Landscape strip */}
      {landscape && !empty && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'felt', value: landscape.total, tone: 'text-white/80' },
              { label: 'carrying', value: landscape.unmetabolized, tone: 'text-rose-300' },
              { label: 'heavy & open', value: landscape.heavy_open, tone: 'text-amber-300' },
            ].map(s => (
              <div key={s.label} className="p-2 rounded-lg bg-black/20 border border-white/5 text-center">
                <div className={cn("text-sm font-mono", s.value ? s.tone : "text-white/20")}>{s.value}</div>
                <div className="text-[7px] uppercase tracking-wider text-white/30">{s.label}</div>
              </div>
            ))}
          </div>
          {pillarTotal > 0 && (
            <div className="space-y-1">
              <div className="flex items-center space-x-1.5">
                <Activity className="w-2.5 h-2.5 text-white/30" />
                <span className="text-[8px] uppercase tracking-wider text-white/30">EQ pillars · {landscape.days}d</span>
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden bg-white/5">
                {landscape.pillars.map(p => (
                  <div key={p.pillar} className={cn("h-full", PILLAR_LABEL[p.pillar]?.tone ?? 'bg-white/30')} style={{ width: `${(p.count / pillarTotal) * 100}%` }} title={`${p.pillar} ${p.count}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {landscape.pillars.map(p => (
                  <span key={p.pillar} className="text-[8px] text-white/35"><span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1", PILLAR_LABEL[p.pillar]?.tone)} />{PILLAR_LABEL[p.pillar]?.short ?? p.pillar} {p.count}</span>
                ))}
              </div>
            </div>
          )}
          {landscape.emotions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {landscape.emotions.slice(0, 10).map(e => (
                <span key={e.emotion} className="text-[8px] px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-200/70">{e.emotion} <span className="text-white/25">{e.count}</span></span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stream */}
      {empty ? (
        <div className="py-6 text-center space-y-1">
          <div className="text-lg font-mono text-white/15 tracking-[0.3em]">····</div>
          <p className="text-[10px] text-white/35">The stream is empty. Nothing felt yet.</p>
          <p className="text-[9px] text-white/25 italic">{COMPANION_NAMES_PROSE} log feelings from a session with <span className="font-mono">mind_feel</span> — the ADE anchors, weighs, and files each one. This is the window, not the pen.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center space-x-1">
            {(['surface', 'recent'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={cn("px-2 py-0.5 rounded-md text-[8px] uppercase tracking-wider transition-colors", view === v ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60")}>{v === 'surface' ? 'worth sitting with' : 'recent'}</button>
            ))}
          </div>
          {list.map(f => <FeelingRow key={f.id} f={f} />)}
          {list.length === 0 && <p className="text-[10px] text-white/30 italic py-2">Nothing here for this ledger.</p>}
        </div>
      )}

    </div>
  );
}
