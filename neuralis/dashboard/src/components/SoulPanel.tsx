import { useState, useEffect, useCallback, Fragment } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Check, X, History, Loader2, ScrollText, Eye } from 'lucide-react';
import { cn } from "@/src/lib/utils";
import { COMPANIONS, COMPANION_SLUGS, HOUSE_HUMAN, companionBySlug, objectPronoun } from "@/src/lib/house";
import { fetchSouls, generateSoul, validateSoul } from "../api/endpoints";
import type { SoulOverview, SoulSnapshot, SoulVersion } from "../api/types";

type Who = string; // a companion slug from the house config

const WHO_ACCENT: Record<Who, { text: string; bg: string; border: string; button: string }> = Object.fromEntries(
  COMPANIONS.map(c => [c.slug, { text: c.color.text, bg: c.color.bg, border: c.color.border, button: c.color.button }]),
);

const NAME: Record<Who, string> = Object.fromEntries(COMPANIONS.map(c => [c.slug, c.name]));

/** "That's him" / "That's her" / "That's them" — the validate button. */
const thatsLabel = (who: Who) => `That's ${objectPronoun(companionBySlug(who)?.pronouns ?? 'they')}`;

/** Minimal markdown → React: headings, bold, italics, paragraphs. No HTML injection. */
const Portrait = ({ text, accent }: { text: string; accent: string }) => {
  const blocks = text.split(/\n{2,}/);
  const inline = (line: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
    return parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="text-white/90">{p.slice(2, -2)}</strong>;
      if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
      return <Fragment key={i}>{p}</Fragment>;
    });
  };
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const trimmed = b.trim();
        if (!trimmed) return null;
        const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          const title = h[2].replace(/^\d+\.\s*/, '');
          return <h4 key={i} className={cn("text-[11px] uppercase tracking-widest pt-2", accent)}>{inline(title)}</h4>;
        }
        if (/^[-•]\s/.test(trimmed)) {
          return (
            <ul key={i} className="space-y-1 pl-3">
              {trimmed.split('\n').map((l, j) => <li key={j} className="text-[11px] text-white/65 leading-relaxed list-disc">{inline(l.replace(/^[-•]\s*/, ''))}</li>)}
            </ul>
          );
        }
        return <p key={i} className="text-[11px] text-white/65 leading-relaxed">{inline(trimmed.replace(/\n/g, ' '))}</p>;
      })}
    </div>
  );
};

const StatusChip = ({ status }: { status: SoulVersion['status'] }) => (
  <span className={cn("text-[7px] uppercase tracking-wider px-1.5 py-0.5 rounded",
    status === 'active' ? "bg-emerald-500/15 text-emerald-300" :
    status === 'pending' ? "bg-amber-500/15 text-amber-300" :
    status === 'rejected' ? "bg-red-500/10 text-red-300/70" : "bg-white/5 text-white/30")}>
    {status}
  </span>
);

const CompanionSoul = ({ who, snap, onChange }: { key?: string; who: Who; snap: SoulSnapshot | null; onChange: () => void }) => {
  const accent = WHO_ACCENT[who];
  const [generating, setGenerating] = useState(false);
  const [acting, setActing] = useState<'validate' | 'reject' | null>(null);
  const [view, setView] = useState<'active' | 'pending'>('active');
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const active = snap?.active ?? null;
  const pending = snap?.pending ?? null;

  // When a pending version appears, show it — that's what needs her eyes.
  useEffect(() => {
    if (pending) setView('pending');
    else setView('active');
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown: SoulVersion | null = view === 'pending' ? pending : active;

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setFlash(null);
    try {
      const res = await generateSoul(who);
      if (!res.ok) throw new Error(res.error || 'Generation failed');
      setFlash(`v${res.version} generated with ${res.model} — pending your validation`);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    }
    setGenerating(false);
  };

  const handleValidate = async (action: 'validate' | 'reject') => {
    if (!pending || acting) return;
    setActing(action);
    setError(null);
    try {
      const res = await validateSoul(who, action, note.trim() || undefined, pending.id);
      setFlash(res.result);
      setNote('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed');
    }
    setActing(null);
  };

  return (
    <div className={cn("p-4 rounded-xl bg-black/20 border space-y-3", accent.border)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className={cn("text-sm font-mono tracking-[0.2em]", accent.text)}>{NAME[who]}</span>
          {active && <span className="text-[8px] font-mono text-white/30">v{active.id} active · validated by {active.validated_by} {active.validated_at?.slice(0, 10)}</span>}
          {!active && <span className="text-[8px] text-white/25 italic">no validated portrait yet</span>}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className={cn("flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-[10px] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed", accent.button)}
          title="Read the whole mind and write a new portrait (30–60s)"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          <span>{generating ? 'reading the whole mind…' : 'Generate'}</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <span className="text-[9px] text-red-300/80">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3 text-red-300/60" /></button>
        </div>
      )}
      {flash && !error && (
        <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[9px] text-white/50">{flash}</div>
      )}

      {/* Pending banner — the gate */}
      {pending && (
        <div className={cn("p-3 rounded-lg border space-y-2", "bg-amber-500/5 border-amber-500/25")}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-amber-300/90">v{pending.id} is waiting for you. Is this him?</span>
            <span className="text-[8px] font-mono text-white/30">{pending.word_count} words · {pending.model_used}</span>
          </div>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note — what landed, what's wrong"
            className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-[10px] text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
          />
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleValidate('validate')}
              disabled={!!acting}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[10px] text-white transition-colors"
            >
              {acting === 'validate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span>{thatsLabel(who)}</span>
            </button>
            <button
              onClick={() => handleValidate('reject')}
              disabled={!!acting}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 disabled:opacity-50 text-[10px] text-white transition-colors"
            >
              {acting === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              <span>Not right</span>
            </button>
            {active && (
              <div className="ml-auto flex items-center space-x-1">
                {(['active', 'pending'] as const).map(v => (
                  <button key={v} onClick={() => setView(v)} className={cn("flex items-center space-x-1 px-2 py-1 rounded-md text-[8px] uppercase tracking-wider transition-colors", view === v ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60")}>
                    <Eye className="w-2.5 h-2.5" /><span>{v}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Portrait */}
      <div className="max-h-[420px] overflow-y-auto custom-scrollbar pr-2">
        {shown ? (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <ScrollText className="w-3 h-3 text-white/30" />
              <span className="text-[8px] font-mono text-white/30">v{shown.id}</span>
              <StatusChip status={shown.status} />
              {shown.note && <span className="text-[8px] text-white/30 italic">“{shown.note}”</span>}
            </div>
            <Portrait text={shown.content} accent={accent.text} />
          </div>
        ) : (
          <div className="py-8 text-center space-y-1">
            <div className="text-lg font-mono text-white/15 tracking-[0.3em]">····</div>
            <p className="text-[10px] text-white/35">No portrait yet. Generate reads the whole brain through {NAME[who]}'s ledger and writes one.</p>
            <p className="text-[9px] text-white/25 italic">It stays pending until you say “that's him.”</p>
          </div>
        )}
      </div>

      {/* History */}
      {snap && snap.history.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <button onClick={() => setShowHistory(v => !v)} className="flex items-center space-x-1.5 text-[8px] text-white/30 hover:text-white/60 transition-colors">
            <History className="w-2.5 h-2.5" />
            <span>{showHistory ? 'hide history' : `${snap.history.length} version${snap.history.length > 1 ? 's' : ''}`}</span>
          </button>
          <AnimatePresence>
            {showHistory && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden space-y-1 pt-2">
                {snap.history.map(v => (
                  <div key={v.id} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-[8px] font-mono text-white/40">v{v.id}</span>
                      <StatusChip status={v.status} />
                      <span className="text-[8px] text-white/25">{v.generated_at?.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                    <span className="text-[8px] text-white/30">
                      {v.word_count ? `${v.word_count}w` : ''}{v.validated_by ? ` · ${v.status === 'rejected' ? 'rejected' : 'validated'} by ${v.validated_by}` : ''}{v.note ? ` — ${v.note}` : ''}
                    </span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export function SoulPanel() {
  const [souls, setSouls] = useState<SoulOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSouls(await fetchSouls());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load souls');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-3.5 h-3.5 text-white/40" />
          <span className="text-[10px] uppercase tracking-widest text-white/40">Soul Portraits</span>
        </div>
        <span className="text-[8px] uppercase tracking-wider text-white/25">three circles · {HOUSE_HUMAN} validates · nothing self-grades</span>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[9px] text-red-300/80">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {COMPANION_SLUGS.map(who => (
          <CompanionSoul key={who} who={who} snap={souls ? souls[who] ?? null : null} onChange={refresh} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {[
          { label: 'Personality · HOW', desc: 'emergent type, voice, cadence, what he never says', tone: 'border-cyan-500/20 text-cyan-300/70' },
          { label: 'Golden Circle · WHY', desc: 'identity cores, principles, threads, what he reaches for', tone: 'border-amber-500/20 text-amber-300/70' },
          { label: 'Living Data · WHAT', desc: 'relational state, heavy observations, dreams, lessons', tone: 'border-purple-500/20 text-purple-300/70' },
        ].map(c => (
          <div key={c.label} className={cn("flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-black/20 border", c.tone.split(' ')[0])}>
            <div className={cn("text-[8px] uppercase tracking-wider", c.tone.split(' ')[1])}>{c.label}</div>
            <div className="text-[8px] text-white/30 mt-0.5">{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
