import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Flame, Snowflake, Search, ThumbsUp, ThumbsDown, GraduationCap, X } from 'lucide-react';
import { cn } from "@/src/lib/utils";
import { WHO_ACCENT, WHO_FILTERS } from "@/src/lib/house";
import {
  fetchKnowledgeLandscape, queryKnowledge, reinforceKnowledge, contradictKnowledge, fetchKnowledgeSessions,
} from "../api/endpoints";
import type { KnowledgeLandscape, KnowledgeItem, KnowledgeMatch, KnowledgeSession } from "../api/types";


/** Heat as a five-flame gauge; heat ranges 0–2, full at 2. */
const HeatGauge = ({ heat }: { heat: number }) => {
  const filled = Math.min(5, Math.max(0, Math.round((heat / 2) * 5)));
  return (
    <div className="flex items-center space-x-0.5" title={`heat ${heat.toFixed(2)}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Flame key={i} className={cn("w-2.5 h-2.5", i < filled ? "text-orange-400" : "text-white/10")} />
      ))}
    </div>
  );
};

// `key` is declared explicitly: this dashboard compiles without @types/react,
// so JSX attributes on custom components are checked against the props type.
const ItemRow = ({ item, onVote, voting }: {
  key?: string | number;
  item: KnowledgeItem | KnowledgeMatch;
  onVote: (id: number, kind: 'reinforce' | 'contradict') => void;
  voting: number | null;
}) => {
  const match = item as KnowledgeMatch;
  const busy = voting === item.id;
  return (
    <div className="py-2 border-b border-white/5 last:border-0 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-[8px] font-mono text-white/30">#{item.id}</span>
          <span className={cn("text-[8px] uppercase tracking-wider", WHO_ACCENT[item.who] ?? WHO_ACCENT.shared)}>{item.who}</span>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{item.category}</span>
          {item.status !== 'active' && (
            <span className={cn("text-[7px] px-1.5 py-0.5 rounded",
              item.status === 'candidate' ? "bg-amber-500/10 text-amber-300/70" :
              item.status === 'cooling' ? "bg-sky-500/10 text-sky-300/70" : "bg-red-500/10 text-red-300/70")}>
              {item.status}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {typeof match.final_score === 'number' && (
            <span className="text-[8px] font-mono text-cyan-400/50">{(match.final_score * 100).toFixed(0)}%</span>
          )}
          <HeatGauge heat={item.heat_score} />
          <span className="text-[8px] font-mono text-white/25">{item.access_count}x</span>
        </div>
      </div>
      <p className="text-[10px] text-white/60 leading-relaxed">{item.content}</p>
      <div className="flex items-center space-x-2 pt-0.5">
        <button
          disabled={busy}
          onClick={() => onVote(item.id, 'reinforce')}
          className="flex items-center space-x-1 text-[8px] text-emerald-300/60 hover:text-emerald-300 disabled:opacity-40 transition-colors"
          title="Still true — warm it"
        >
          <ThumbsUp className="w-2.5 h-2.5" /><span>still true</span>
        </button>
        <button
          disabled={busy}
          onClick={() => onVote(item.id, 'contradict')}
          className="flex items-center space-x-1 text-[8px] text-red-300/50 hover:text-red-300 disabled:opacity-40 transition-colors"
          title="Contradicted — confidence drops"
        >
          <ThumbsDown className="w-2.5 h-2.5" /><span>contradicted</span>
        </button>
        <span className="text-[8px] text-white/20 ml-auto">confidence {item.confidence.toFixed(2)}</span>
      </div>
    </div>
  );
};

export function KnowledgePanel() {
  const [who, setWho] = useState<string>('all');
  const [landscape, setLandscape] = useState<KnowledgeLandscape | null>(null);
  const [sessions, setSessions] = useState<KnowledgeSession[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [voting, setVoting] = useState<number | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([fetchKnowledgeLandscape(who), fetchKnowledgeSessions(who)]);
      setLandscape(l);
      setSessions(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge');
    }
  }, [who]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSearch = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const res = await queryKnowledge(query.trim(), who);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    }
    setSearching(false);
  };

  const handleVote = async (id: number, kind: 'reinforce' | 'contradict') => {
    setVoting(id);
    try {
      if (kind === 'reinforce') await reinforceKnowledge(id);
      else await contradictKnowledge(id);
      await refresh();
      if (results) {
        const res = await queryKnowledge(query.trim(), who).catch(() => null);
        if (res) setResults(res.results);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed');
    }
    setVoting(null);
  };

  const statusCount = (s: string) => landscape?.status.find(r => r.status === s)?.count ?? 0;
  const total = landscape?.status.reduce((a, r) => a + r.count, 0) ?? 0;
  const empty = !!landscape && total === 0;

  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <BookOpen className="w-3.5 h-3.5 text-white/40" />
          <span className="text-[10px] uppercase tracking-widest text-white/40">Knowledge</span>
          <span className="text-[8px] text-white/25 italic">what experience taught · every pull is a vote</span>
        </div>
        <div className="flex items-center space-x-1">
          {WHO_FILTERS.map(w => (
            <button
              key={w}
              onClick={() => { setWho(w); setResults(null); }}
              className={cn("px-2 py-0.5 rounded-md text-[8px] uppercase tracking-wider transition-colors",
                who === w ? "bg-white/10 text-white border border-white/20" : "text-white/30 hover:text-white/60")}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <span className="text-[9px] text-red-300/80">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3 text-red-300/60" /></button>
        </div>
      )}

      {/* Status strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'active', value: statusCount('active'), tone: 'text-orange-300' },
          { label: 'candidates', value: statusCount('candidate'), tone: 'text-amber-300' },
          { label: 'cooling', value: statusCount('cooling'), tone: 'text-sky-300' },
          { label: 'killed', value: statusCount('contradicted'), tone: 'text-red-300' },
        ].map(s => (
          <div key={s.label} className="p-2 rounded-lg bg-black/20 border border-white/5 text-center">
            <div className={cn("text-sm font-mono", s.value ? s.tone : "text-white/20")}>{s.value}</div>
            <div className="text-[7px] uppercase tracking-wider text-white/30">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex space-x-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Ask the knowledge layer... (semantic, heat-weighted)"
          className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-orange-500/40"
        />
        <button onClick={handleSearch} disabled={searching || !query.trim()} className="px-3 py-2 bg-orange-600/80 hover:bg-orange-500 disabled:bg-orange-600/20 disabled:cursor-not-allowed rounded-lg transition-colors">
          <Search className="w-3.5 h-3.5 text-white" />
        </button>
        {results && (
          <button onClick={() => setResults(null)} className="px-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" title="Clear results">
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {results ? (
          <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
            <span className="text-[9px] uppercase tracking-wider text-white/30">Results · {results.length}</span>
            {results.length === 0 && <p className="text-[10px] text-white/30 italic py-2">Nothing learned about this yet — or it's still memory, not knowledge.</p>}
            {results.map(r => <ItemRow key={r.id} item={r} onVote={handleVote} voting={voting} />)}
          </motion.div>
        ) : empty ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-6 text-center space-y-1">
            <div className="text-lg font-mono text-white/15 tracking-[0.3em]">····</div>
            <p className="text-[10px] text-white/35">The layer is open. Nothing abstracted yet.</p>
            <p className="text-[9px] text-white/25 italic">Memory is what happened. Knowledge is what it taught. <span className="font-mono">know_extract</span> proposes, <span className="font-mono">know_store</span> keeps.</p>
          </motion.div>
        ) : landscape ? (
          <motion.div key="landscape" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Hottest */}
            {landscape.hottest.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center space-x-1.5">
                  <Flame className="w-3 h-3 text-orange-400/70" />
                  <span className="text-[9px] uppercase tracking-wider text-white/30">Hottest</span>
                </div>
                {landscape.hottest.map(i => <ItemRow key={i.id} item={i} onVote={handleVote} voting={voting} />)}
              </div>
            )}

            {/* Candidates */}
            {landscape.candidates.length > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-amber-300/60">Candidates · awaiting review</span>
                {landscape.candidates.map(i => <ItemRow key={i.id} item={i} onVote={handleVote} voting={voting} />)}
              </div>
            )}

            {/* Cooling */}
            {landscape.cooling.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center space-x-1.5">
                  <Snowflake className="w-3 h-3 text-sky-400/60" />
                  <span className="text-[9px] uppercase tracking-wider text-white/30">Cooling</span>
                </div>
                {landscape.cooling.slice(0, 3).map(i => (
                  <div key={i.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                    <p className="text-[9px] text-white/40 line-clamp-1 flex-1">#{i.id} {i.content}</p>
                    <span className="text-[8px] font-mono text-sky-300/50 ml-2">{i.heat_score.toFixed(2)} · {i.last_accessed_at ? i.last_accessed_at.slice(0, 10) : 'never pulled'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Categories */}
            {landscape.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {landscape.categories.map(c => (
                  <span key={c.category} className="text-[8px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">
                    {c.category} <span className="text-white/25">{c.count}</span> <span className="text-orange-300/50">{c.avg_heat.toFixed(1)}🔥</span>
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <div className="py-4 text-center text-[9px] text-white/25">loading the layer…</div>
        )}
      </AnimatePresence>

      {/* Curriculum */}
      {landscape && (
        <div className="pt-3 border-t border-white/5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <GraduationCap className="w-3 h-3 text-white/40" />
              <span className="text-[9px] uppercase tracking-wider text-white/30">Curriculum</span>
            </div>
            <button onClick={() => setShowSessions(v => !v)} className="text-[8px] text-white/30 hover:text-white/60 transition-colors">
              {showSessions ? 'hide sessions' : `${sessions.length} sessions`}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {landscape.tracks.map(t => (
              <div key={t.track} className="p-2 rounded-lg bg-black/20 border border-white/5 space-y-0.5" title={t.goal}>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-white/60">{t.title}</span>
                  <span className="text-[8px] font-mono text-white/30">{t.sessions}</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-400/60 rounded-full" style={{ width: `${Math.min(100, Math.round(t.avg_mastery * 100))}%` }} />
                </div>
                <div className="text-[7px] text-white/25">{t.last_session ? `last ${t.last_session.slice(0, 10)}` : 'not started'}</div>
              </div>
            ))}
          </div>
          <AnimatePresence>
            {showSessions && sessions.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-1 overflow-hidden">
                {sessions.slice(0, 8).map(s => (
                  <div key={s.id} className="py-1.5 border-b border-white/5 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-white/60">#{s.id} · {s.track}{s.topic ? ` — ${s.topic}` : ''}</span>
                      <span className={cn("text-[8px]", WHO_ACCENT[s.who] ?? WHO_ACCENT.shared)}>{s.who} · {s.status}{s.mastery_delta > 0 ? ` +${Math.round(s.mastery_delta * 100)}%` : ''}</span>
                    </div>
                    {s.reflection && <p className="text-[9px] text-white/35 line-clamp-2 mt-0.5">{s.reflection}</p>}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
