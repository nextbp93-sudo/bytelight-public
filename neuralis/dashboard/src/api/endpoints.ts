import { get, post, patch, del } from "./client";
import { HOUSE_HUMAN } from "../lib/house";
import type {
  Entity,
  HealthScores,
  InnerWeather,
  Journal,
  HeatResponse,
  RecentResponse,
  SubconsciousState,
  Thread,
  TensionsResponse,
  PatternsResponse,
  CortexStatsResponse,
  CortexThoughtsResponse,
  IdentityResponse,
  StatsResponse,
  SearchResponse,
  MCPToolDef,
  PersonalityResponse,
  Cron,
  EmergenceData,
  TaxonomyData,
  KnowledgeLandscape,
  KnowledgeQueryResponse,
  KnowledgeItem,
  KnowledgeSession,
  SoulOverview,
  SoulSnapshot,
  SoulGenerateResponse,
  SoulValidateResponse,
  Feeling,
  FeelingsLandscape,
} from "./types";

// === Mind Layer ===

export const fetchHealthScores = () => get<HealthScores>("/api/health-scores");

export const fetchInnerWeather = () => get<InnerWeather>("/api/inner-weather");

export const fetchEntities = (type?: string) =>
  get<Entity[]>("/api/entities", type ? { type } : undefined);

export const fetchJournals = () => get<Journal[]>("/api/journals");

export const fetchRecent = () => get<RecentResponse>("/api/recent");

export const fetchSubconscious = () => get<SubconsciousState>("/subconscious");

export const fetchThreads = (status?: string) =>
  get<Thread[]>("/api/threads", status ? { status } : undefined);

export const fetchTensions = () => get<TensionsResponse>("/api/tensions");

export const fetchHeat = () => get<HeatResponse>("/api/heat");

export const fetchPatterns = () => get<PatternsResponse>("/api/patterns");

export const fetchStats = () => get<StatsResponse>("/api/stats");

export const fetchIdentity = () => get<IdentityResponse>("/api/identity");

export const fetchSearch = (q: string) => get<SearchResponse>("/api/search", { q });

export const fetchPersonality = () => get<PersonalityResponse>("/api/personality");

// === Cortex Layer ===

export const fetchCortexStats = () => get<CortexStatsResponse>("/api/cortex/stats");

export const fetchCortexThoughts = (query: string) =>
  get<CortexThoughtsResponse>("/api/cortex/thoughts", { query });

export const injectThought = (content: string, type = "observation") =>
  post<{ result: string }>("/api/cortex/thoughts", { type, content });

// === Engine Layer ===

export const fetchCrons = () => get<Cron[]>("/api/crons");

export const createCron = (preset: string, frequency_minutes: number, label?: string, agentic_action?: string) =>
  post<Cron>("/api/crons", { preset, frequency_minutes, label, agentic_action });

export const updateCron = (id: number, updates: Partial<Pick<Cron, "enabled" | "label" | "frequency_minutes">>) =>
  patch<Cron>(`/api/crons/${id}`, updates);

export const deleteCron = (id: number) => del<{ deleted: number }>(`/api/crons/${id}`);

export const fireCronNow = (id: number) =>
  post<{ id: number; status: string; fired_at: string }>(`/api/crons/${id}/fire`, {});

export const fetchEmergence = () => get<EmergenceData>("/api/emergence");

export const fetchTaxonomy = () => get<TaxonomyData>("/api/taxonomy");

// === Knowledge Layer (NESTknow port) ===

export const fetchKnowledgeLandscape = (who?: string) =>
  get<KnowledgeLandscape>("/api/know", who && who !== "all" ? { who } : undefined);

export const queryKnowledge = (q: string, who?: string) =>
  get<KnowledgeQueryResponse>("/api/know/query", { q, ...(who && who !== "all" ? { who } : {}) });

export const fetchKnowledgeItems = (status?: string, who?: string) =>
  get<KnowledgeItem[]>("/api/know/items", {
    ...(status ? { status } : {}),
    ...(who && who !== "all" ? { who } : {}),
  });

export const fetchKnowledgeSessions = (who?: string) =>
  get<KnowledgeSession[]>("/api/know/sessions", who && who !== "all" ? { who } : undefined);

export const reinforceKnowledge = (id: number, context = "dashboard") =>
  post<{ result: string }>(`/api/know/items/${id}/reinforce`, { context });

export const contradictKnowledge = (id: number, context = "dashboard") =>
  post<{ result: string }>(`/api/know/items/${id}/contradict`, { context });

// === Soul Portraits (NESTsoul port) ===

export const fetchSouls = () => get<SoulOverview>("/api/soul");

export const fetchSoul = (who: string) => get<SoulSnapshot>("/api/soul", { who });

export const generateSoul = (who: string, voice_profile?: string) =>
  post<SoulGenerateResponse>("/api/soul/generate", { who, ...(voice_profile ? { voice_profile } : {}) });

export const validateSoul = (who: string, action: "validate" | "reject", note?: string, version?: number) =>
  post<SoulValidateResponse>("/api/soul/validate", { who, action, validated_by: HOUSE_HUMAN, ...(note ? { note } : {}), ...(version ? { version } : {}) });

// === Feelings Stream (NESTeq port) ===

const whoQuery = (who?: string) => (who && who !== "all" ? { who } : {});

export const fetchFeelingsLandscape = (who?: string, days = 7) =>
  get<FeelingsLandscape>("/api/feelings", { days: String(days), ...whoQuery(who) });

export const fetchFeelingsSurface = (who?: string, limit = 8) =>
  get<Feeling[]>("/api/feelings/surface", { limit: String(limit), ...whoQuery(who) });

export const fetchFeelingsRecent = (who?: string, limit = 20) =>
  get<Feeling[]>("/api/feelings/recent", { limit: String(limit), ...whoQuery(who) });

// === MCP Tool List (hardcoded — /mcp endpoint has no CORS) ===

export const MCP_TOOLS: MCPToolDef[] = [
  // Mind Layer (31 tools)
  { name: "mind_orient", description: "First call on wake - get identity anchor, current context, relational state", category: "mind" },
  { name: "mind_ground", description: "Second call on wake - get active threads, recent work, recent journals", category: "mind" },
  { name: "mind_thread", description: "Manage threads (intentions across sessions)", category: "mind" },
  { name: "mind_write", description: "Write to cognitive databases (entity, observation, relation, journal)", category: "mind" },
  { name: "mind_search", description: "Search memories using semantic similarity", category: "mind" },
  { name: "mind_feel_toward", description: "Track, check, or clear relational state toward someone", category: "mind" },
  { name: "mind_identity", description: "Read or write identity graph", category: "mind" },
  { name: "mind_context", description: "Current context layer - situational awareness", category: "mind" },
  { name: "mind_health", description: "Check cognitive health stats", category: "mind" },
  { name: "mind_list_entities", description: "List all entities, optionally filtered by type or context", category: "mind" },
  { name: "mind_read_entity", description: "Read an entity with all its observations and relations", category: "mind" },
  { name: "mind_sit", description: "Sit with an emotional observation - engage with it, add a note", category: "mind" },
  { name: "mind_resolve", description: "Mark an emotional observation as metabolized", category: "mind" },
  { name: "mind_surface", description: "Surface observations - resonant (mood-based) or spark (random associative)", category: "mind" },
  { name: "mind_edit", description: "Edit an existing observation, image, or journal", category: "mind" },
  { name: "mind_delete", description: "Delete any memory: observation, entity, journal, relation, image, thread, or tension", category: "mind" },
  { name: "mind_entity", description: "Manage entities - set salience, edit properties, merge duplicates, bulk archive", category: "mind" },
  { name: "mind_consolidate", description: "Review and consolidate recent observations - find patterns, merge duplicates", category: "mind" },
  { name: "mind_read", description: "Read entities/observations from a database", category: "mind" },
  { name: "mind_timeline", description: "Trace a topic through time - semantic search ordered chronologically", category: "mind" },
  { name: "mind_patterns", description: "Analyze recurring patterns - what's alive, what's surfacing", category: "mind" },
  { name: "mind_inner_weather", description: "Check current inner weather - what's coloring experience right now", category: "mind" },
  { name: "mind_tension", description: "Tension space - hold productive contradictions that simmer", category: "mind" },
  { name: "mind_proposals", description: "Review and act on daemon-proposed connections from co-surfacing patterns", category: "mind" },
  { name: "mind_dormant", description: "Review observations that haven't surfaced in 30+ days", category: "mind" },
  { name: "mind_isolated", description: "Find entities disconnected from the graph (no relations)", category: "mind" },
  { name: "mind_archive", description: "Explore and manage the deep archive - memories that faded but aren't forgotten", category: "mind" },
  { name: "mind_store_image", description: "Store, view, or search visual memories with multimodal embedding", category: "mind" },
  { name: "mind_personality", description: "Emergent personality ledger - weather reading per companion, shadows, vocabulary tuning", category: "mind" },
  { name: "mind_feel", description: "Universal feeling input - the ADE infers pillar, weight, tags, anchor entity; embeds, echoes, signals, shadow check", category: "mind" },
  { name: "mind_feelings", description: "The feelings stream - surface, recent, when, search, spark, landscape", category: "mind" },
  // Cortex Layer (18 tools)
  { name: "cortex_remember", description: "Store a thought, decision, principle, insight, or question", category: "cortex" },
  { name: "cortex_recall", description: "Recall thoughts via semantic search - decisions, principles, insights", category: "cortex" },
  { name: "cortex_save_conversation", description: "Ingest a conversation with structured metadata", category: "cortex" },
  { name: "cortex_search_conversations", description: "Search conversations by keyword, domain, date range, or semantic similarity", category: "cortex" },
  { name: "cortex_stats", description: "Cortex knowledge base overview - thought counts, domains, thinking stages", category: "cortex" },
  { name: "cortex_what_do_i_think", description: "Synthesize thinking on a topic - gather related thoughts and produce analysis", category: "cortex" },
  { name: "cortex_alignment_check", description: "Check a decision against stored principles", category: "cortex" },
  { name: "cortex_thinking_trajectory", description: "Track how thinking on a concept evolved over time", category: "cortex" },
  { name: "cortex_tunnel_state", description: "Reconstruct cognitive save-state for a domain", category: "cortex" },
  { name: "cortex_context_recovery", description: "Full re-entry brief for a domain - recent summaries, decisions, cross-references", category: "cortex" },
  { name: "cortex_dormant_contexts", description: "Find abandoned domains with open questions", category: "cortex" },
  { name: "cortex_open_threads", description: "All unfinished work across all domains - global inventory of open questions", category: "cortex" },
  { name: "cortex_cognitive_patterns", description: "Analyze cognitive patterns - monthly activity, thinking stages, domain focus", category: "cortex" },
  { name: "cortex_save_principle", description: "Save a principle - a guiding rule, value, or constraint", category: "cortex" },
  { name: "cortex_list_principles", description: "List all stored principles, optionally filtered by domain", category: "cortex" },
  { name: "cortex_switching_cost", description: "Estimate cognitive cost of switching between two domains", category: "cortex" },
  { name: "cortex_tunnel_history", description: "Meta-view of engagement with a domain over time", category: "cortex" },
  { name: "cortex_what_was_i_thinking", description: "Time-travel snapshot - what was on your mind during a specific month", category: "cortex" },
  // Knowledge Layer (9 tools) — NESTknow port
  { name: "know_store", description: "Store an abstracted principle with its source memories. Every pull is a vote", category: "know" },
  { name: "know_query", description: "Usage-weighted semantic search - similarity 60% + heat 30% + confidence 10%", category: "know" },
  { name: "know_extract", description: "Propose knowledge candidates from repeated patterns in observations and journals", category: "know" },
  { name: "know_reinforce", description: "Boost heat and confidence when a lesson proves true again", category: "know" },
  { name: "know_contradict", description: "Flag a contradiction - confidence drops, below 0.2 the lesson is killed", category: "know" },
  { name: "know_landscape", description: "Overview of the knowledge layer - hottest, cooling, candidates, curriculum", category: "know" },
  { name: "know_session_start", description: "Start a curriculum practice session (writing, architecture, emotional-literacy, voice)", category: "know" },
  { name: "know_session_complete", description: "Close a practice session with notes, work, reflection - reinforces what was used", category: "know" },
  { name: "know_session_list", description: "List practice sessions and progress across the four tracks", category: "know" },
  // Soul Portraits (5 tools) — NESTsoul port
  { name: "soul_gather", description: "Read the whole mind through one companion's ledger - the raw material a portrait is built from", category: "soul" },
  { name: "soul_generate", description: `Gather + synthesise + store a PENDING portrait. Nothing goes active until ${HOUSE_HUMAN} validates`, category: "soul" },
  { name: "soul_read", description: "Read the active (validated) portrait - what any substrate reads to be that companion", category: "soul" },
  { name: "soul_validate", description: `${HOUSE_HUMAN}'s gate - that's them (activate) or not right (reject)`, category: "soul" },
  { name: "soul_history", description: "Versions, status, who validated or rejected and why", category: "soul" },
];
