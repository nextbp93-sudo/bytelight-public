import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain, Activity, Zap, Heart, Cpu, Layers, Network, Sparkles,
  ChevronRight, Terminal, Settings, Database, History,
  Send, Search, Book, ShieldCheck, X, Filter, Fingerprint,
  Clock, Users, LayoutDashboard, BookOpen, Eye, LogOut, RefreshCw
} from 'lucide-react';
import { cn } from "@/src/lib/utils";
import { AuthGate } from "./components/AuthGate";
import { PersonalityPanel } from "./components/PersonalityPanel";
import { EnginePanel } from "./components/EnginePanel";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { SoulPanel } from "./components/SoulPanel";
import { FeelingsPanel } from "./components/FeelingsPanel";
import { useAuth, useNeuralState, useSettings } from "./hooks";
import { MCP_TOOLS, injectThought, fetchSearch } from "./api/endpoints";
import type { MCPToolDef } from "./api/types";

// --- Dream Visualizer (background particle effects) ---
const DreamVisualizer = ({ vividness, lucidity }: { vividness: number, lucidity: number }) => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
    <motion.div
      className="absolute inset-0"
      animate={{
        background: [
          `radial-gradient(circle at 20% 30%, hsla(280, 70%, 30%, ${vividness * 0.4}) 0%, transparent 60%)`,
          `radial-gradient(circle at 80% 70%, hsla(240, 70%, 30%, ${vividness * 0.4}) 0%, transparent 60%)`,
          `radial-gradient(circle at 50% 50%, hsla(300, 70%, 30%, ${vividness * 0.2}) 0%, transparent 80%)`,
        ],
      }}
      transition={{ duration: 15 / (lucidity + 0.2), repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
    />
    {[...Array(Math.floor(vividness * 15 + 5))].map((_, i) => (
      <motion.div
        key={i}
        className="absolute w-1 h-1 bg-purple-300 rounded-full"
        initial={{ x: Math.random() * 100 + "%", y: Math.random() * 100 + "%", opacity: 0, scale: 0 }}
        animate={{ y: ["0%", "-20%"], opacity: [0, 0.5, 0], scale: [0, 1.2, 0] }}
        transition={{ duration: Math.random() * 8 + 7, repeat: Infinity, delay: Math.random() * 10, ease: "easeInOut" }}
        style={{ filter: `blur(${4 * (1 - lucidity)}px)` }}
      />
    ))}
  </div>
);

// --- Intersection View (Synaptic Bridge SVG) ---
const IntersectionView = ({ entities, hotEntities, mood, resonance, activeNodes }: {
  entities: { name: string; entity_type: string }[];
  hotEntities: { name: string; heat: number }[];
  mood: string;
  resonance: number;
  activeNodes: string[];
}) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const synapticLinks = useMemo(() => {
    const links: { id: string; source: string; target: string; label: string; strength: number; type: 'memory' | 'emotion' | 'thought' }[] = [];

    links.push({ id: 'mind-cortex-bridge', source: mood || 'Calm', target: 'Cortex', label: 'Cognitive Bridge', strength: 0.9, type: 'emotion' });

    activeNodes.forEach((node, i) => {
      links.push({ id: `node-${i}`, source: 'Cortex', target: node, label: 'Active Node', strength: 0.8, type: 'thought' });
    });

    hotEntities.slice(0, 5).forEach((entity, i) => {
      links.push({ id: `hot-${i}`, source: mood || 'Calm', target: entity.name, label: 'Resonance', strength: entity.heat, type: 'memory' });
    });

    return links;
  }, [mood, activeNodes, hotEntities]);

  type NodePos = { x: number; y: number };
  const nodePositions: Record<string, NodePos> = useMemo(() => {
    const positions: Record<string, NodePos> = {
      'Cortex': { x: 20, y: 50 },
      [mood || 'Calm']: { x: 80, y: 50 },
    };

    activeNodes.forEach((node, i) => {
      const angle = (i / Math.max(activeNodes.length, 1)) * Math.PI - Math.PI / 2;
      positions[node] = { x: 20 + Math.cos(angle) * 15, y: 50 + Math.sin(angle) * 15 };
    });

    hotEntities.slice(0, 5).forEach((e, i) => {
      const angle = (i / 5) * Math.PI + Math.PI / 2;
      positions[e.name] = { x: 50 + Math.cos(angle) * 25, y: 50 + Math.sin(angle) * 15 };
    });

    return positions;
  }, [mood, activeNodes, hotEntities]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full flex flex-col space-y-6 md:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-serif italic text-white/90">Synaptic Intersection</h2>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">Mapping the bridge between Mind & Cortex</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/10 backdrop-blur-sm">
            <Activity className="w-4 h-4 text-purple-400" />
            <div className="flex flex-col">
              <span className="text-[8px] uppercase tracking-tighter text-white/40">Neural Resonance</span>
              <span className="text-xs font-mono text-white/60">{(resonance * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left: Hot Entities */}
        <div className="col-span-1 md:col-span-3 space-y-4 flex flex-col">
          <div className="flex-1 p-6 rounded-3xl bg-white/[0.03] border border-white/10 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <Brain className="w-4 h-4 text-cyan-400" />
                <span className="text-[10px] uppercase tracking-widest text-white/40">Hot Entities</span>
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2">
              {hotEntities.map((e, i) => (
                <motion.div
                  key={e.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onMouseEnter={() => setHoveredNode(e.name)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2 group hover:border-cyan-400/30 transition-colors cursor-pointer"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/70 group-hover:text-white/90 transition-colors">{e.name}</span>
                    <span className="text-[8px] font-mono text-cyan-400/60">{(e.heat * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div className="h-full bg-gradient-to-r from-cyan-500/60 to-purple-500/60 rounded-full" initial={{ width: 0 }} animate={{ width: `${e.heat * 100}%` }} />
                  </div>
                </motion.div>
              ))}
              {hotEntities.length === 0 && <p className="text-xs text-white/30 italic">No hot entities this week</p>}
            </div>
            <div className="pt-4 mt-4 border-t border-white/5">
              <div className="text-[8px] uppercase tracking-widest text-white/20 mb-3">Active Concepts</div>
              <div className="flex flex-wrap gap-2">
                {activeNodes.map(tag => (
                  <span key={tag} onMouseEnter={() => setHoveredNode(tag)} onMouseLeave={() => setHoveredNode(null)} className="px-2 py-1 rounded-lg bg-cyan-400/5 border border-cyan-400/10 text-[8px] text-cyan-300/60 hover:bg-cyan-400/10 transition-colors cursor-pointer">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Center: SVG Bridge */}
        <div className="col-span-1 md:col-span-6 relative flex flex-col">
          <div className="flex-1 rounded-3xl bg-gradient-to-b from-white/[0.05] to-transparent border border-white/10 overflow-hidden relative">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`, backgroundSize: '32px 32px' }} />
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
              <defs>
                <filter id="glow"><feGaussianBlur stdDeviation="0.5" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              {synapticLinks.map(link => {
                const src = nodePositions[link.source] as { x: number; y: number } | undefined;
                const tgt = nodePositions[link.target] as { x: number; y: number } | undefined;
                if (!src || !tgt) return null;
                const color = link.type === 'emotion' ? '#a855f7' : link.type === 'memory' ? '#06b6d4' : '#94a3b8';
                return (
                  <motion.line key={link.id} x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y} stroke={color} strokeWidth={link.strength * 0.4} strokeOpacity={hoveredNode && (hoveredNode === link.source || hoveredNode === link.target) ? 0.9 : 0.3} filter="url(#glow)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.5 }} />
                );
              })}
              {Object.entries(nodePositions).map(([name, pos]) => (
                <g key={name}>
                  <motion.circle cx={pos.x} cy={pos.y} r={hoveredNode === name ? 2.5 : 1.8} fill={name === 'Cortex' ? '#06b6d4' : name === (mood || 'Calm') ? '#a855f7' : '#64748b'} opacity={hoveredNode === name ? 1 : 0.7} filter="url(#glow)" animate={{ scale: hoveredNode === name ? [1, 1.3, 1] : 1 }} transition={{ duration: 2, repeat: Infinity }} />
                  <text x={pos.x} y={pos.y + 4} textAnchor="middle" className="text-[2.5px] fill-white/40 select-none">{name.slice(0, 15)}</text>
                </g>
              ))}
            </svg>
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-widest text-white/20">Live Neural Graph</span>
              <span className="text-[8px] font-mono text-white/20">{Object.keys(nodePositions).length} nodes / {synapticLinks.length} links</span>
            </div>
          </div>
        </div>

        {/* Right: Emotional State */}
        <div className="col-span-1 md:col-span-3 space-y-4 flex flex-col">
          <div className="flex-1 p-6 rounded-3xl bg-white/[0.03] border border-white/10 flex flex-col min-h-0">
            <div className="flex items-center space-x-2 mb-6">
              <Heart className="w-4 h-4 text-purple-400" />
              <span className="text-[10px] uppercase tracking-widest text-white/40">Emotional Weather</span>
            </div>
            <div className="space-y-4">
              <div className="text-center py-4">
                <span className="text-lg text-white/80 font-serif italic">{mood || 'Calibrating...'}</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-white/30">Resonance</span>
                  <span className="text-[9px] font-mono text-purple-300/60">{(resonance * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-purple-500/60 to-pink-500/60 rounded-full" animate={{ width: `${resonance * 100}%` }} />
                </div>
              </div>
              {entities.slice(0, 6).map(e => (
                <div key={e.name} className="flex items-center justify-between py-1">
                  <span className="text-[9px] text-white/50 truncate max-w-[80%]">{e.name}</span>
                  <span className="text-[7px] text-white/20 capitalize">{e.entity_type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// --- MindView ---
const MindView = ({ data }: { data: ReturnType<typeof useNeuralState> }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'entities' | 'journals' | 'recent' | 'subconscious' | 'mcp'>('dashboard');
  const [selectedTool, setSelectedTool] = useState<MCPToolDef | null>(null);

  const mindTools = MCP_TOOLS.filter(t => t.category === 'mind');

  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'entities', label: 'Entities', icon: Users },
    { key: 'journals', label: 'Journals', icon: BookOpen },
    { key: 'recent', label: 'Recent', icon: History },
    { key: 'subconscious', label: 'Subconscious', icon: Eye },
    { key: 'mcp', label: 'MCP', icon: Terminal },
  ] as const;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex items-center space-x-1 mb-6 overflow-x-auto pb-2 custom-scrollbar">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cn("flex items-center space-x-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap transition-all", activeTab === tab.key ? "bg-white/10 text-white border border-white/20" : "text-white/40 hover:text-white/60 hover:bg-white/5")}>
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <AnimatePresence mode="wait">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Health Bar */}
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] uppercase tracking-widest text-white/40">Neural Stability Index</span>
                  <span className="text-sm font-mono text-white/80">{data.healthScores?.overall ?? '--'}%</span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-purple-500 rounded-full" animate={{ width: `${data.healthScores?.overall ?? 0}%` }} transition={{ duration: 1 }} />
                </div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3">
                  {data.healthScores && [
                    { label: 'Database', value: data.healthScores.db_score },
                    { label: 'Threads', value: data.healthScores.thread_score },
                    { label: 'Journals', value: data.healthScores.journal_score },
                    { label: 'Identity', value: data.healthScores.identity_score },
                    { label: 'Activity', value: data.healthScores.activity_score },
                    { label: 'Daemon', value: data.healthScores.subconscious_score },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <div className="text-[8px] text-white/30">{s.label}</div>
                      <div className="text-[10px] font-mono text-white/60">{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Entities', value: data.stats?.counts.entities ?? '--', icon: Users },
                  { label: 'Observations', value: data.stats?.counts.observations ?? '--', icon: Database },
                  { label: 'Journals', value: data.stats?.counts.journals ?? '--', icon: BookOpen },
                  { label: 'Unprocessed', value: data.stats?.counts.unprocessed ?? '--', icon: Zap },
                ].map(card => (
                  <div key={card.label} className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center space-y-2">
                    <card.icon className="w-4 h-4 text-white/30" />
                    <span className="text-lg font-mono text-white/80">{card.value}</span>
                    <span className="text-[8px] uppercase tracking-wider text-white/30">{card.label}</span>
                  </div>
                ))}
              </div>

              {/* Emotional State */}
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
                <div className="flex items-center space-x-2">
                  <Heart className="w-4 h-4 text-purple-400" />
                  <span className="text-[10px] uppercase tracking-widest text-white/40">Inner Weather</span>
                </div>
                {data.innerWeather ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/70 font-serif italic">{data.innerWeather.weather_energy}</span>
                      <span className="text-[9px] text-white/30">{data.innerWeather.conditions.weather}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {data.innerWeather.mood_palette.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-[9px] text-purple-300/70">{t}</span>
                      ))}
                    </div>
                    {data.innerWeather.pressing && data.innerWeather.pressing.length > 0 && (
                      <div className="pt-2 border-t border-white/5">
                        <span className="text-[8px] text-white/30 uppercase">Pressing</span>
                        {data.innerWeather.pressing.map((p, i) => (
                          <p key={i} className="text-[10px] text-white/50 mt-1">{p.content}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-white/30 italic">Loading weather...</p>
                )}
              </div>

              {/* Feelings stream — everything is a feeling (NESTeq port) */}
              <FeelingsPanel />

              {/* Patterns - Alive Entities */}
              {data.patterns && data.patterns.alive.length > 0 && (
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <span className="text-[10px] uppercase tracking-widest text-white/40">What's Alive (7d)</span>
                  <div className="space-y-2">
                    {data.patterns.alive.slice(0, 6).map(a => (
                      <div key={a.name} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-white/60">{a.name}</span>
                          <span className="text-[8px] text-white/20 capitalize">{a.entity_type}</span>
                        </div>
                        <span className="text-[9px] font-mono text-cyan-400/60">{a.obs_count} obs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Engine Panel */}
              <EnginePanel />
            </motion.div>
          )}

          {/* Entities Tab */}
          {activeTab === 'entities' && (
            <motion.div key="entities" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Entity Graph ({data.entities.length})</span>
              </div>
              <div className="space-y-2">
                {data.entities.slice(0, 50).map(entity => (
                  <div key={entity.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={cn("w-2 h-2 rounded-full", entity.salience === 'foundational' ? 'bg-amber-400' : entity.salience === 'active' ? 'bg-emerald-400' : 'bg-white/20')} />
                      <div>
                        <span className="text-xs text-white/70">{entity.name}</span>
                        <span className="text-[8px] text-white/30 ml-2 capitalize">{entity.entity_type}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-[8px] font-mono text-white/30">{entity.observation_count} obs</span>
                      {entity.salience && <span className="text-[7px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{entity.salience}</span>}
                    </div>
                  </div>
                ))}
                {data.entities.length === 0 && <p className="text-xs text-white/30 italic text-center py-8">No entities yet</p>}
              </div>
            </motion.div>
          )}

          {/* Journals Tab */}
          {activeTab === 'journals' && (
            <motion.div key="journals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <span className="text-[10px] uppercase tracking-widest text-white/40">Internal Reflections ({data.journals.length})</span>
              {data.journals.map(j => (
                <div key={j.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-white/30">{j.entry_date}</span>
                    {j.emotion && <span className="text-[8px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300/60">{j.emotion}</span>}
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed line-clamp-4">{j.content}</p>
                  {j.tags && <div className="flex flex-wrap gap-1">{j.tags.split(',').map(t => <span key={t} className="text-[7px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{t.trim()}</span>)}</div>}
                </div>
              ))}
              {data.journals.length === 0 && <p className="text-xs text-white/30 italic text-center py-8">No journal entries yet</p>}
            </motion.div>
          )}

          {/* Recent Tab */}
          {activeTab === 'recent' && (
            <motion.div key="recent" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <span className="text-[10px] uppercase tracking-widest text-white/40">Recent Observations</span>
              {data.recent?.observations.map(obs => (
                <div key={obs.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-cyan-400/60 font-mono">{obs.entity_name}</span>
                    <div className="flex items-center space-x-2">
                      <span className={cn("text-[7px] px-1.5 py-0.5 rounded", obs.weight === 'heavy' ? 'bg-red-500/10 text-red-300/60' : obs.weight === 'medium' ? 'bg-amber-500/10 text-amber-300/60' : 'bg-white/5 text-white/30')}>{obs.weight}</span>
                      {obs.charge && <span className="text-[7px] text-white/20">{obs.charge}</span>}
                    </div>
                  </div>
                  <p className="text-[10px] text-white/50 leading-relaxed">{obs.content}</p>
                  <span className="text-[7px] text-white/15">{obs.added_at?.slice(0, 10)}</span>
                </div>
              )) ?? <p className="text-xs text-white/30 italic text-center py-8">Loading...</p>}
            </motion.div>
          )}

          {/* Subconscious Tab */}
          {activeTab === 'subconscious' && (
            <motion.div key="subconscious" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 relative">
              <DreamVisualizer vividness={0.6} lucidity={0.4} />
              <div className="relative z-10 space-y-6">
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-purple-400" />
                    <span className="text-[10px] uppercase tracking-widest text-white/40">Daemon State</span>
                  </div>
                  {data.subconscious ? (
                    <div className="space-y-4">
                      {data.subconscious.mood && (
                        <div>
                          <span className="text-[8px] text-white/30 uppercase">Mood</span>
                          <p className="text-sm text-white/70 font-serif italic mt-1">{data.subconscious.mood.dominant}</p>
                          {data.subconscious.mood.palette && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {data.subconscious.mood.palette.map(p => <span key={p} className="text-[8px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300/50">{p}</span>)}
                            </div>
                          )}
                        </div>
                      )}
                      {data.subconscious.hot_entities && data.subconscious.hot_entities.length > 0 && (
                        <div>
                          <span className="text-[8px] text-white/30 uppercase">Hot Entities</span>
                          <div className="space-y-1 mt-1">
                            {data.subconscious.hot_entities.slice(0, 8).map(e => (
                              <div key={e.name} className="flex justify-between">
                                <span className="text-[10px] text-white/50">{e.name}</span>
                                <span className="text-[8px] font-mono text-white/20">{e.score}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {data.subconscious.recurring_patterns && data.subconscious.recurring_patterns.length > 0 && (
                        <div>
                          <span className="text-[8px] text-white/30 uppercase">Recurring Patterns</span>
                          <div className="space-y-1 mt-1">
                            {data.subconscious.recurring_patterns.map((p, i) => (
                              <p key={i} className="text-[10px] text-white/40 italic">{p}</p>
                            ))}
                          </div>
                        </div>
                      )}
                      {data.subconscious.processed_at && (
                        <span className="text-[7px] text-white/15">Last processed: {new Date(data.subconscious.processed_at).toLocaleString()}</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-white/30 italic">Daemon sleeping...</p>
                  )}
                </div>

                {/* Tensions */}
                {data.tensions && data.tensions.active.length > 0 && (
                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                    <span className="text-[10px] uppercase tracking-widest text-white/40">Active Tensions ({data.tensions.active_count})</span>
                    {data.tensions.active.slice(0, 5).map(t => (
                      <div key={t.id} className="p-3 rounded-lg bg-white/[0.02] border border-white/5 space-y-1">
                        <div className="flex items-center space-x-2 text-[10px] text-white/50">
                          <span>{t.pole_a}</span>
                          <span className="text-white/20">↔</span>
                          <span>{t.pole_b}</span>
                        </div>
                        {t.context && <p className="text-[8px] text-white/25">{t.context}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* MCP Tab */}
          {activeTab === 'mcp' && (
            <motion.div key="mcp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Mind Tools ({mindTools.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {mindTools.map(tool => (
                  <button key={tool.name} onClick={() => setSelectedTool(tool)} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-purple-500/30 transition-colors text-left space-y-1">
                    <span className="text-[10px] font-mono text-purple-300/70">{tool.name}</span>
                    <p className="text-[9px] text-white/40 line-clamp-2">{tool.description}</p>
                  </button>
                ))}
              </div>
              {/* Tool Detail Modal */}
              <AnimatePresence>
                {selectedTool && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedTool(null)}>
                    <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="bg-[#12121a] border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono text-purple-300">{selectedTool.name}</span>
                        <button onClick={() => setSelectedTool(null)} className="p-1 rounded-lg hover:bg-white/10"><X className="w-4 h-4 text-white/40" /></button>
                      </div>
                      <p className="text-xs text-white/60">{selectedTool.description}</p>
                      <span className="text-[8px] uppercase px-2 py-0.5 rounded bg-purple-500/10 text-purple-300/60">{selectedTool.category}</span>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

// --- BrainView ---
const BrainView = ({ data, settings, onUpdateSettings, onLogout }: {
  data: ReturnType<typeof useNeuralState>;
  settings: ReturnType<typeof useSettings>['settings'];
  onUpdateSettings: ReturnType<typeof useSettings>['updateSettings'];
  onLogout: () => void;
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vault' | 'mcp' | 'settings'>('dashboard');
  const [newThought, setNewThought] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; score: number; content?: string; entity?: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [selectedTool, setSelectedTool] = useState<MCPToolDef | null>(null);

  const cortexTools = MCP_TOOLS.filter(t => t.category === 'cortex');
  const knowTools = MCP_TOOLS.filter(t => t.category === 'know');
  const soulTools = MCP_TOOLS.filter(t => t.category === 'soul');
  const accentColors = ['#a855f7', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b', '#6366f1', '#ffffff'];

  const handleInject = async () => {
    if (!newThought.trim() || injecting) return;
    setInjecting(true);
    try {
      await injectThought(newThought.trim());
      setNewThought('');
      data.refetch();
    } catch (e) {
      console.error('Inject failed:', e);
    }
    setInjecting(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || searching) return;
    setSearching(true);
    try {
      const res = await fetchSearch(searchQuery.trim());
      setSearchResults(res.results.slice(0, 10));
    } catch (e) {
      console.error('Search failed:', e);
    }
    setSearching(false);
  };

  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'vault', label: 'Vault', icon: Database },
    { key: 'mcp', label: 'MCP', icon: Terminal },
    { key: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex items-center space-x-1 mb-6 overflow-x-auto pb-2 custom-scrollbar">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cn("flex items-center space-x-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap transition-all", activeTab === tab.key ? "bg-white/10 text-white border border-white/20" : "text-white/40 hover:text-white/60 hover:bg-white/5")}>
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <AnimatePresence mode="wait">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Quick Thought Injection */}
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Quick Synapse</span>
                <div className="flex space-x-2">
                  <input
                    value={newThought}
                    onChange={e => setNewThought(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInject()}
                    placeholder="Inject a thought into cortex..."
                    className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/40"
                  />
                  <button onClick={handleInject} disabled={injecting || !newThought.trim()} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/30 disabled:cursor-not-allowed rounded-lg transition-colors">
                    <Send className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </div>

              {/* Emergent Personality — weather, never canon */}
              <PersonalityPanel personality={data.personality} />

              {/* Soul portraits — the human validates, nothing self-grades (NESTsoul port) */}
              <SoulPanel />

              {/* Knowledge — what experience taught (NESTknow port) */}
              <KnowledgePanel />

              {/* Latest Observations */}
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Latest Activity</span>
                {data.recent?.observations.slice(0, 5).map(obs => (
                  <div key={obs.id} className="py-2 border-b border-white/5 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-cyan-400/60 font-mono">{obs.entity_name}</span>
                      <span className="text-[7px] text-white/20">{obs.added_at?.slice(0, 10)}</span>
                    </div>
                    <p className="text-[10px] text-white/50 mt-1 line-clamp-2">{obs.content}</p>
                  </div>
                ))}
              </div>

              {/* Active Threads */}
              {data.threads.filter(t => t.status === 'active').length > 0 && (
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <span className="text-[10px] uppercase tracking-widest text-white/40">Active Threads</span>
                  {data.threads.filter(t => t.status === 'active').slice(0, 5).map(thread => (
                    <div key={thread.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                      <p className="text-[10px] text-white/50 line-clamp-1 flex-1">{thread.content}</p>
                      <span className={cn("text-[7px] px-1.5 py-0.5 rounded ml-2", thread.priority === 'high' ? 'bg-red-500/10 text-red-300/60' : 'bg-white/5 text-white/30')}>{thread.priority}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Vault Tab */}
          {activeTab === 'vault' && (
            <motion.div key="vault" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Semantic Search</span>
                <div className="flex space-x-2">
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    placeholder="Search memories..."
                    className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
                  />
                  <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-600/30 disabled:cursor-not-allowed rounded-lg transition-colors">
                    <Search className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  {searchResults.map(r => (
                    <div key={r.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-mono text-white/30">{r.id}</span>
                        <span className="text-[8px] font-mono text-cyan-400/50">{(r.score * 100).toFixed(0)}%</span>
                      </div>
                      {r.content && <p className="text-[10px] text-white/50">{r.content}</p>}
                      {r.entity && <span className="text-[8px] text-purple-300/50">{r.entity}</span>}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* MCP Tab */}
          {activeTab === 'mcp' && (
            <motion.div key="mcp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Cortex Tools ({cortexTools.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {cortexTools.map(tool => (
                  <button key={tool.name} onClick={() => setSelectedTool(tool)} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/30 transition-colors text-left space-y-1">
                    <span className="text-[10px] font-mono text-cyan-300/70">{tool.name}</span>
                    <p className="text-[9px] text-white/40 line-clamp-2">{tool.description}</p>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Knowledge Tools ({knowTools.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {knowTools.map(tool => (
                  <button key={tool.name} onClick={() => setSelectedTool(tool)} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-orange-500/30 transition-colors text-left space-y-1">
                    <span className="text-[10px] font-mono text-orange-300/70">{tool.name}</span>
                    <p className="text-[9px] text-white/40 line-clamp-2">{tool.description}</p>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Soul Tools ({soulTools.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {soulTools.map(tool => (
                  <button key={tool.name} onClick={() => setSelectedTool(tool)} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-purple-500/30 transition-colors text-left space-y-1">
                    <span className="text-[10px] font-mono text-purple-300/70">{tool.name}</span>
                    <p className="text-[9px] text-white/40 line-clamp-2">{tool.description}</p>
                  </button>
                ))}
              </div>
              <AnimatePresence>
                {selectedTool && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedTool(null)}>
                    <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="bg-[#12121a] border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono text-cyan-300">{selectedTool.name}</span>
                        <button onClick={() => setSelectedTool(null)} className="p-1 rounded-lg hover:bg-white/10"><X className="w-4 h-4 text-white/40" /></button>
                      </div>
                      <p className="text-xs text-white/60">{selectedTool.description}</p>
                      <span className="text-[8px] uppercase px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300/60">{selectedTool.category}</span>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Theme & Aesthetics</span>
                {/* Theme Mode */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/60">Theme Mode</span>
                  <div className="flex space-x-2">
                    {(['dark', 'light'] as const).map(mode => (
                      <button key={mode} onClick={() => onUpdateSettings({ theme_mode: mode })} className={cn("px-3 py-1.5 rounded-lg text-[10px] capitalize transition-colors", settings.theme_mode === mode ? "bg-white/10 text-white border border-white/20" : "text-white/30 hover:text-white/50")}>{mode}</button>
                    ))}
                  </div>
                </div>
                {/* Mood Sync */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/60">Mood Sync</span>
                  <button onClick={() => onUpdateSettings({ mood_sync: !settings.mood_sync })} className={cn("w-10 h-5 rounded-full transition-colors relative", settings.mood_sync ? "bg-purple-600" : "bg-white/10")}>
                    <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", settings.mood_sync ? "translate-x-5" : "translate-x-0.5")} />
                  </button>
                </div>
                {/* Accent Color */}
                <div className="space-y-2">
                  <span className="text-xs text-white/60">Accent Color</span>
                  <div className="flex space-x-2">
                    {accentColors.map(color => (
                      <button key={color} onClick={() => onUpdateSettings({ accent_color: color })} className={cn("w-6 h-6 rounded-full border-2 transition-transform hover:scale-110", settings.accent_color === color ? "border-white scale-110" : "border-white/20")} style={{ backgroundColor: color }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Disconnect */}
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-red-500/10 space-y-3">
                <span className="text-[10px] uppercase tracking-widest text-red-400/60">Connection</span>
                <button onClick={onLogout} className="flex items-center space-x-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors">
                  <LogOut className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-xs text-red-300">Disconnect</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

// --- Main App ---
export default function App() {
  const { authenticated, error, testing, login, logout } = useAuth();
  const { settings, updateSettings } = useSettings();
  const neuralState = useNeuralState(authenticated);

  const [isUnified, setIsUnified] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<'mind' | 'brain'>('mind');

  const currentAccent = settings.accent_color;

  // Derive values for IntersectionView
  const hotEntities = neuralState.heat?.entities ?? [];
  const mood = neuralState.healthScores?.mood ?? neuralState.innerWeather?.weather_energy ?? 'Calibrating';
  const resonance = (neuralState.healthScores?.overall ?? 50) / 100;
  const activeNodes = hotEntities.slice(0, 5).map(e => e.name);

  // Auth gate
  if (!authenticated) {
    return <AuthGate onLogin={login} error={error} testing={testing} />;
  }

  return (
    <div className={cn("min-h-screen flex flex-col transition-colors duration-500", settings.theme_mode === 'dark' ? "bg-[#0a0a0f] text-white" : "bg-[#f5f5f7] text-black")}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-white/5">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center">
            <Brain className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white/90">Neuralis OS</h1>
            <div className="flex items-center space-x-2">
              <div className={cn("w-1.5 h-1.5 rounded-full", neuralState.loading ? "bg-amber-400 animate-pulse" : neuralState.error ? "bg-red-400" : "bg-emerald-400")} />
              <span className="text-[8px] text-white/30">{neuralState.loading ? 'Syncing...' : neuralState.error ? 'Error' : 'Connected'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button onClick={() => neuralState.refetch()} className="p-2 rounded-lg hover:bg-white/5 transition-colors" title="Refresh">
            <RefreshCw className={cn("w-4 h-4 text-white/40", neuralState.loading && "animate-spin")} />
          </button>
          <button onClick={() => setIsUnified(!isUnified)} className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[10px] text-white/50 hover:text-white/70 transition-colors">
            <Network className="w-3.5 h-3.5" />
            <span>{isUnified ? 'Separate' : 'Unify'}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-4 md:p-8">
        {isUnified ? (
          <IntersectionView entities={neuralState.entities.slice(0, 20)} hotEntities={hotEntities} mood={mood} resonance={resonance} activeNodes={activeNodes} />
        ) : (
          <div className="h-full flex flex-col md:flex-row md:space-x-8">
            {/* Desktop: Both panels */}
            <div className={cn("hidden md:flex md:w-1/2 h-full")}>
              <MindView data={neuralState} />
            </div>
            <div className={cn("hidden md:flex md:w-1/2 h-full")}>
              <BrainView data={neuralState} settings={settings} onUpdateSettings={updateSettings} onLogout={logout} />
            </div>
            {/* Mobile: Tab-switched */}
            <div className="md:hidden flex-1 h-full">
              {mobileActiveTab === 'mind' ? <MindView data={neuralState} /> : <BrainView data={neuralState} settings={settings} onUpdateSettings={updateSettings} onLogout={logout} />}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden flex items-center justify-around py-3 border-t border-white/5 bg-[#0a0a0f]/90 backdrop-blur-sm">
        <button onClick={() => setMobileActiveTab('mind')} className={cn("flex flex-col items-center space-y-1 px-4 py-1", mobileActiveTab === 'mind' ? "text-purple-400" : "text-white/30")}>
          <Heart className="w-5 h-5" />
          <span className="text-[8px] uppercase tracking-wider">Mind</span>
        </button>
        <button onClick={() => { setIsUnified(!isUnified); }} className="flex flex-col items-center space-y-1 px-4 py-1 text-white/30">
          <Network className="w-5 h-5" />
          <span className="text-[8px] uppercase tracking-wider">Bridge</span>
        </button>
        <button onClick={() => setMobileActiveTab('brain')} className={cn("flex flex-col items-center space-y-1 px-4 py-1", mobileActiveTab === 'brain' ? "text-cyan-400" : "text-white/30")}>
          <Brain className="w-5 h-5" />
          <span className="text-[8px] uppercase tracking-wider">Cortex</span>
        </button>
      </nav>

      {/* Footer */}
      <footer className="px-4 md:px-8 py-2 border-t border-white/5 flex items-center justify-between">
        <span className="text-[8px] font-mono text-white/20">Neuralis OS v{neuralState.stats?.version ?? '3.2.0'}</span>
        <div className="flex items-center space-x-4">
          {neuralState.lastFetched && <span className="text-[8px] text-white/15">Last sync: {new Date(neuralState.lastFetched).toLocaleTimeString()}</span>}
          <span className="text-[8px] text-white/15">{MCP_TOOLS.length} tools</span>
        </div>
      </footer>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  );
}
