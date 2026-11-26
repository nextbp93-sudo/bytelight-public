import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Play, Plus, Trash2, X, Flame } from 'lucide-react';
import { cn } from "@/src/lib/utils";
import { fetchCrons, fetchEmergence, fetchTaxonomy, fireCronNow, createCron, deleteCron, updateCron } from "../api/endpoints";
import type { Cron, EmergenceData, TaxonomyData } from "../api/types";

// --- Categorized task presets ---
// Every Neuralis tool that makes sense on a heartbeat, grouped.

interface PresetOption {
  value: string;
  label: string;
  description: string;
}

interface PresetGroup {
  category: string;
  options: PresetOption[];
}

const PRESET_GROUPS: PresetGroup[] = [
  {
    category: "Rhythms",
    options: [
      { value: "rumination", label: "Keep the memories meeting", description: "Two deep surfacing passes — feeds connections + novelty" },
      { value: "consolidate", label: "Tidy up memories", description: "Merge related observations, find echoes" },
      { value: "reflection", label: "Write a reflection", description: "Structured reflection from recent experience" },
      { value: "backfill_contexts", label: "Sort the unfiled", description: "Classify ~20 unfiled observations into context buckets + owner" },
      { value: "wake_subconscious", label: "Wake the daemon", description: "Fire the full subconscious pass — dormancy, charge, consolidation, reflection" },
      { value: "knowledge_decay", label: "Let unused lessons cool", description: "Knowledge heat decay — every 6h, unused lessons lose heat, below 0.1 they go cooling" },
    ],
  },
  {
    category: "Memory",
    options: [
      { value: "mind_surface", label: "Surface what's alive", description: "Pull up what's resonating right now" },
      { value: "mind_consolidate", label: "Merge echoes", description: "Review recent observations for overlaps" },
      { value: "mind_dormant", label: "Wake sleeping memories", description: "Things unseen in 30+ days" },
      { value: "mind_patterns", label: "See what's alive", description: "What's recurring, shifting, growing" },
      { value: "mind_isolated", label: "Find the lonely ones", description: "Entities with no connections yet" },
      { value: "mind_proposals", label: "Review connections", description: "Act on suggested links from patterns" },
    ],
  },
  {
    category: "Feeling",
    options: [
      { value: "mind_inner_weather", label: "Check the weather", description: "Current emotional atmosphere" },
      { value: "mind_tension", label: "Hold contradictions", description: "Productive tensions that simmer" },
      { value: "mind_feel_toward", label: "Feel toward someone", description: "Relational state check" },
    ],
  },
  {
    category: "Dreams",
    options: [
      { value: "generate_dream", label: "Dream", description: "Associative dream from emotional seeds" },
    ],
  },
  {
    category: "Awareness",
    options: [
      { value: "mind_orient", label: "Orient", description: "Who am I + where am I + who matters" },
      { value: "mind_ground", label: "Ground", description: "Active threads + recent work" },
      { value: "mind_health", label: "Health check", description: "How's the brain doing" },
      { value: "mind_identity", label: "Who am I", description: "The self-knowledge graph" },
      { value: "mind_context", label: "Where am I", description: "Situational awareness snapshot" },
    ],
  },
  {
    category: "Thinking",
    options: [
      { value: "cortex_open_threads", label: "Unfinished business", description: "Open work across all domains" },
      { value: "cortex_dormant_contexts", label: "Sleeping projects", description: "Domains with unanswered questions" },
      { value: "cortex_cognitive_patterns", label: "Thinking patterns", description: "How the brain's been working" },
      { value: "cortex_stats", label: "Brain stats", description: "Knowledge base overview" },
    ],
  },
  {
    category: "Search",
    options: [
      { value: "mind_search", label: "Search memories", description: "Semantic search across everything" },
      { value: "mind_timeline", label: "Trace through time", description: "Follow a topic chronologically" },
    ],
  },
  {
    category: "Custom",
    options: [
      { value: "__custom__", label: "Custom tool...", description: "Any Neuralis tool name" },
    ],
  },
];

const ALL_PRESETS = PRESET_GROUPS.flatMap(g => g.options);

const CADENCES = [
  { value: 0, label: 'Manual only' },
  { value: 30, label: 'Every 30 min' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
];

function formatCadence(minutes: number): string {
  if (minutes <= 0) return 'manual only';
  if (minutes < 60) return `${minutes}m`;
  if (minutes === 60) return '1h';
  if (minutes < 1440) return `${minutes / 60}h`;
  return `${minutes / 1440}d`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function presetLabel(preset: string): string {
  const found = ALL_PRESETS.find(p => p.value === preset);
  return found ? found.label : preset;
}

export function EnginePanel() {
  const [crons, setCrons] = useState<Cron[]>([]);
  const [emergence, setEmergence] = useState<EmergenceData | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyData | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [firingId, setFiringId] = useState<number | null>(null);
  const [newPreset, setNewPreset] = useState('rumination');
  const [customPreset, setCustomPreset] = useState('');
  const [newCadence, setNewCadence] = useState(60);
  const [newLabel, setNewLabel] = useState('');
  const [newAction, setNewAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, e, t] = await Promise.allSettled([fetchCrons(), fetchEmergence(), fetchTaxonomy()]);
      if (c.status === 'fulfilled') setCrons(c.value);
      if (e.status === 'fulfilled') setEmergence(e.value);
      if (t.status === 'fulfilled') setTaxonomy(t.value);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleFire = async (id: number) => {
    setFiringId(id);
    setError(null);
    try {
      await fireCronNow(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fire failed");
    }
    setFiringId(null);
  };

  const handleToggle = async (cron: Cron) => {
    setError(null);
    try {
      await updateCron(cron.id, { enabled: cron.enabled ? 0 : 1 });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await deleteCron(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleAdd = async () => {
    const preset = newPreset === '__custom__' ? customPreset : newPreset;
    if (!preset) return;
    setError(null);
    try {
      await createCron(preset, newCadence, newLabel || undefined, newAction || undefined);
      setShowAddForm(false);
      setNewPreset('rumination');
      setCustomPreset('');
      setNewCadence(60);
      setNewLabel('');
      setNewAction('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
  };

  const selectedPresetInfo = ALL_PRESETS.find(p => p.value === newPreset);

  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Cpu className="w-4 h-4 text-amber-400" />
          <span className="text-[10px] uppercase tracking-widest text-white/40">Heartbeat</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/30 hover:text-white/60"
        >
          {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <span className="text-[9px] text-red-300/80">{error}</span>
          <button onClick={() => setError(null)} className="text-red-300/50 hover:text-red-300/80">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Emergence Fuel Gauge */}
      {emergence && (
        <div className="flex items-center space-x-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
          <Flame className="w-4 h-4 text-amber-400/70 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-[8px] uppercase tracking-widest text-amber-300/40">Emergence Fuel</span>
            <div className="flex items-center space-x-3 mt-0.5">
              <div className="flex items-center space-x-1.5">
                <span className="text-sm font-mono text-amber-300/80">{emergence.co_surfacing_pairs}</span>
                <span className="text-[8px] text-white/30">pairs</span>
              </div>
              <span className="text-white/10">|</span>
              <div className="flex items-center space-x-1.5">
                <span className="text-sm font-mono text-purple-300/80">{emergence.pending_proposals}</span>
                <span className="text-[8px] text-white/30">proposals</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Taxonomy Gauges */}
      {taxonomy && (taxonomy.unfiled > 0 || taxonomy.unsigned > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {/* Unfiled Counter */}
          <div className="p-3 rounded-xl bg-sky-500/5 border border-sky-500/10">
            <span className="text-[8px] uppercase tracking-widest text-sky-300/40">Unfiled</span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-lg font-mono text-sky-300/80">{taxonomy.unfiled}</span>
              <span className="text-[8px] text-white/20">/ {taxonomy.total}</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-sky-400/40 rounded-full transition-all"
                style={{ width: `${taxonomy.total > 0 ? Math.round((taxonomy.unfiled / taxonomy.total) * 100) : 0}%` }}
              />
            </div>
          </div>

          {/* Signed Ratio */}
          <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
            <span className="text-[8px] uppercase tracking-widest text-violet-300/40">Signed</span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-lg font-mono text-violet-300/80">{taxonomy.signed_ratio}%</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-violet-400/40 rounded-full transition-all"
                style={{ width: `${taxonomy.signed_ratio}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Add Task Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
              {/* Task (preset) */}
              <div className="space-y-2">
                <label className="text-[8px] uppercase tracking-wider text-white/30">Task</label>
                <select
                  value={newPreset}
                  onChange={e => setNewPreset(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 outline-none focus:border-amber-400/30"
                >
                  {PRESET_GROUPS.map(group => (
                    <optgroup key={group.category} label={group.category}>
                      {group.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedPresetInfo && selectedPresetInfo.value !== '__custom__' && (
                  <p className="text-[8px] text-white/20 leading-relaxed">{selectedPresetInfo.description}</p>
                )}
              </div>

              {/* Custom tool name — only when Custom selected */}
              {newPreset === '__custom__' && (
                <div className="space-y-2">
                  <label className="text-[8px] uppercase tracking-wider text-white/30">Tool name</label>
                  <input
                    type="text"
                    value={customPreset}
                    onChange={e => setCustomPreset(e.target.value)}
                    placeholder="e.g., mind_search"
                    className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 outline-none focus:border-amber-400/30 placeholder:text-white/20 font-mono"
                  />
                </div>
              )}

              {/* Cadence */}
              <div className="space-y-2">
                <label className="text-[8px] uppercase tracking-wider text-white/30">Cadence</label>
                <select
                  value={newCadence}
                  onChange={e => setNewCadence(parseInt(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 outline-none focus:border-amber-400/30"
                >
                  {CADENCES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Label */}
              <div className="space-y-2">
                <label className="text-[8px] uppercase tracking-wider text-white/30">Label (optional)</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="e.g., keep the memories meeting"
                  className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 outline-none focus:border-amber-400/30 placeholder:text-white/20"
                />
              </div>

              {/* Agentic Action */}
              <div className="space-y-2">
                <label className="text-[8px] uppercase tracking-wider text-white/30">Action (optional)</label>
                <textarea
                  value={newAction}
                  onChange={e => setNewAction(e.target.value)}
                  placeholder='e.g., {"query": "what matters most"}'
                  rows={2}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 outline-none focus:border-amber-400/30 placeholder:text-white/20 font-mono resize-none"
                />
                <p className="text-[7px] text-white/15">JSON params passed to the tool — or leave empty for defaults</p>
              </div>

              <button
                onClick={handleAdd}
                disabled={newPreset === '__custom__' && !customPreset}
                className={cn(
                  "w-full py-2 rounded-lg border text-xs transition-colors",
                  newPreset === '__custom__' && !customPreset
                    ? "bg-white/5 border-white/5 text-white/20 cursor-not-allowed"
                    : "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 text-amber-300/80"
                )}
              >
                Add to Heartbeat
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task List */}
      <div className="space-y-2">
        {crons.map(cron => (
          <div
            key={cron.id}
            className={cn(
              "p-3 rounded-xl border transition-colors",
              cron.enabled
                ? "bg-white/[0.03] border-white/10 hover:border-white/15"
                : "bg-white/[0.01] border-white/5 opacity-50"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-white/70 truncate">
                    {cron.label || presetLabel(cron.preset)}
                  </span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 flex-shrink-0">
                    {formatCadence(cron.frequency_minutes)}
                  </span>
                </div>
                <div className="flex items-center space-x-2 mt-1">
                  {cron.label && (
                    <span className="text-[8px] text-white/15 font-mono">{presetLabel(cron.preset)}</span>
                  )}
                  {cron.last_run_at && (
                    <span className="text-[8px] text-white/20">
                      {timeAgo(cron.last_run_at)}
                    </span>
                  )}
                  {cron.last_status && (
                    <span className={cn(
                      "text-[7px] px-1.5 py-0.5 rounded-full",
                      cron.last_status.startsWith('error')
                        ? "bg-red-500/10 text-red-300/60"
                        : "bg-emerald-500/10 text-emerald-300/60"
                    )}>
                      {cron.last_status.startsWith('error') ? 'error' : cron.last_status}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                <button
                  onClick={() => handleFire(cron.id)}
                  disabled={firingId === cron.id}
                  className={cn(
                    "p-1.5 rounded-lg transition-colors",
                    firingId === cron.id
                      ? "bg-amber-500/20 text-amber-300"
                      : "hover:bg-white/5 text-white/30 hover:text-amber-400"
                  )}
                  title="Fire now"
                >
                  <Play className={cn("w-3 h-3", firingId === cron.id && "animate-pulse")} />
                </button>
                <button
                  onClick={() => handleToggle(cron)}
                  className={cn(
                    "w-8 h-4 rounded-full transition-colors relative",
                    cron.enabled ? "bg-emerald-600/60" : "bg-white/10"
                  )}
                  title={cron.enabled ? 'Disable' : 'Enable'}
                >
                  <div className={cn(
                    "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                    cron.enabled ? "translate-x-4" : "translate-x-0.5"
                  )} />
                </button>
                <button
                  onClick={() => handleDelete(cron.id)}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {crons.length === 0 && (
          <p className="text-xs text-white/20 italic text-center py-4">No heartbeat tasks yet</p>
        )}
      </div>
    </div>
  );
}
