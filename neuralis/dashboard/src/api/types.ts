// === Entity types ===
export interface Entity {
  id: number;
  name: string;
  entity_type: string;
  primary_context: string;
  salience: string | null;
  created_at: string;
  updated_at: string;
  observation_count: number;
}

// === Observation types ===
export interface Observation {
  id: number;
  entity_id: number;
  content: string;
  salience: string | null;
  emotion: string | null;
  weight: "light" | "medium" | "heavy";
  charge: string | null;
  added_at: string;
  entity_name: string;
}

// === Journal types ===
export interface Journal {
  id: number;
  entry_date: string;
  content: string;
  tags: string | null;
  emotion: string | null;
  created_at: string;
}

// === Thread types ===
export interface Thread {
  id: number;
  content: string;
  thread_type: string;
  priority: string;
  status: string;
  context: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

// === Health scores ===
export interface HealthScores {
  db_score: number;
  thread_score: number;
  journal_score: number;
  identity_score: number;
  activity_score: number;
  subconscious_score: number;
  overall: number;
  daemon_processed_at: string | null;
  mood: string | null;
}

// === Inner weather ===
export interface InnerWeather {
  timestamp: string;
  conditions: {
    weather: string;
    location: string;
    time: string;
    time_energy: string;
    active_threads: number;
    high_priority: number;
    heavy_observations_24h: number;
    dominant_emotion: string;
  };
  mood_palette: string[];
  weather_energy: string;
  guidance: string;
  pressing?: { content: string; type: string }[];
  recent_emotional?: string[];
}

// === Heat map ===
export interface HeatEntry {
  name: string;
  count: number;
  heat: number;
}

export interface HeatResponse {
  entities: HeatEntry[];
}

// === Recent activity ===
export interface RecentResponse {
  observations: Observation[];
  journals: Journal[];
  threads: Thread[];
}

// === Subconscious daemon state ===
export interface SubconsciousState {
  processed_at?: string;
  mood?: {
    dominant: string;
    palette?: string[];
    textures?: string[];
  };
  hot_entities?: { name: string; count: number; score: number }[];
  recurring_patterns?: string[];
  surfaced_observations?: unknown[];
}

// === Patterns ===
export interface PatternsResponse {
  period_days: number;
  alive: { name: string; entity_type: string; obs_count: number }[];
  weights: { weight: string; count: number }[];
  charges: { charge: string; count: number }[];
  salience: { salience: string; count: number }[];
  foundational: { name: string; entity_type: string }[];
}

// === Tensions ===
export interface Tension {
  id: string;
  pole_a: string;
  pole_b: string;
  context: string | null;
  visits: number;
  created_at: string;
  last_visited: string | null;
  resolved_at?: string | null;
  resolution?: string | null;
}

export interface TensionsResponse {
  active: Tension[];
  resolved: Tension[];
  active_count: number;
  resolved_count: number;
}

// === Identity ===
export interface IdentityEntry {
  id: number;
  section: string;
  content: string;
  weight: number;
  connections: string | null;
  timestamp: string;
}

export interface IdentityResponse {
  entries: IdentityEntry[];
  tree: Record<string, IdentityEntry[]>;
}

// === Cortex ===
export interface CortexStatsResponse {
  result: string; // formatted text
}

export interface CortexThoughtsResponse {
  result: string; // formatted text from recall
}

// === Stats ===
export interface StatsResponse {
  version: string;
  counts: {
    entities: number;
    observations: number;
    journals: number;
    unprocessed: number;
  };
  daemon: SubconsciousState | null;
}

// === Search ===
export interface SearchResult {
  id: string;
  score: number;
  source?: string;
  entity?: string;
  content?: string;
  weight?: string;
  added_at?: string;
}

export interface SearchResponse {
  mood: string | null;
  query: string;
  results: SearchResult[];
}

// === MCP Tool Definition (for display) ===
export interface MCPToolDef {
  name: string;
  description: string;
  category: "mind" | "cortex" | "know" | "soul";
}

// === Engine Crons ===
export interface Cron {
  id: number;
  preset: string;
  label: string | null;
  frequency_minutes: number;
  agentic_action: string | null;
  enabled: number;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
}

export interface EmergenceData {
  co_surfacing_pairs: number;
  pending_proposals: number;
}

export interface TaxonomyData {
  unfiled: number;
  total: number;
  signed: number;
  unsigned: number;
  signed_ratio: number;
  distribution: { context: string; count: number }[];
}

// === Emergent Personality ===
export interface PersonalityAxes {
  e_i: number;
  s_n: number;
  t_f: number;
  j_p: number;
}

export interface PersonalityLedger {
  who: string; // a companion slug, or "shared"
  type: string | null;
  confidence: number;
  signals: number;
  axes: PersonalityAxes;
  snapshot: { type: string; confidence: number; date: string } | null;
}

export interface PersonalityShadow {
  who: string;
  shadow_for_type: string;
  recorded_at: string;
  emotion_word: string | null;
}

export interface PersonalityResponse {
  ledgers: PersonalityLedger[];
  shadows: PersonalityShadow[];
  vocabulary_top: { emotion_word: string; category: string; times_used: number }[];
}

// === Knowledge layer (NESTknow port) ===
export interface KnowledgeItem {
  id: number;
  content: string;
  category: string;
  who: string; // a companion slug, or "shared"
  status: "candidate" | "active" | "cooling" | "contradicted";
  confidence: number;
  heat_score: number;
  access_count: number;
  last_accessed_at: string | null;
  contradiction_count?: number;
  created_at?: string;
}

export interface KnowledgeTrack {
  track: string;
  title: string;
  goal: string;
  sessions: number;
  avg_mastery: number;
  last_session: string | null;
}

export interface KnowledgeLandscape {
  who: string;
  status: { status: string; count: number }[];
  categories: { category: string; count: number; avg_heat: number }[];
  hottest: KnowledgeItem[];
  cooling: KnowledgeItem[];
  candidates: KnowledgeItem[];
  tracks: KnowledgeTrack[];
}

export interface KnowledgeMatch extends KnowledgeItem {
  similarity: number;
  final_score: number;
}

export interface KnowledgeQueryResponse {
  query: string;
  results: KnowledgeMatch[];
}

export interface KnowledgeSession {
  id: number;
  track: string;
  topic: string | null;
  who: string;
  status: "active" | "completed";
  notes: string | null;
  practice_output: string | null;
  reflection: string | null;
  mastery_delta: number;
  started_at: string;
  completed_at: string | null;
}

// === Soul portraits (NESTsoul port) ===
export interface SoulVersion {
  id: number;
  who: string; // a companion slug, or "shared"
  content: string;
  model_used: string | null;
  status: "pending" | "active" | "rejected" | "superseded";
  generated_at: string;
  validated_by: string | null;
  validated_at: string | null;
  note: string | null;
  word_count: number | null;
}

export type SoulVersionSummary = Omit<SoulVersion, "content">;

export interface SoulSnapshot {
  who: string;
  active: SoulVersion | null;
  pending: SoulVersion | null;
  history: SoulVersionSummary[];
}

/** GET /api/soul — one snapshot per companion, keyed by slug. */
export type SoulOverview = Record<string, SoulSnapshot>;

export interface SoulGenerateResponse {
  ok: boolean;
  who: string;
  version: number;
  model: string;
  content: string;
  status: "pending";
  error?: string;
}

export interface SoulValidateResponse extends SoulSnapshot {
  ok: boolean;
  action: "validate" | "reject";
  result: string;
}

// === Feelings stream (NESTeq port) ===
export interface Feeling {
  id: number;
  content: string;
  emotion: string;
  who: string; // a companion slug, or "shared"
  intensity: "neutral" | "whisper" | "present" | "strong" | "overwhelming";
  weight: "light" | "medium" | "heavy";
  pillar: string | null;
  charge: "fresh" | "warm" | "cool" | "metabolized";
  sit_count: number;
  linked_entity: string | null;
  context?: string;
  created_at: string;
  strength?: number;
  access_count?: number;
  resolution_note?: string | null;
}

export interface FeelingsLandscape {
  days: number;
  who: string;
  total: number;
  unmetabolized: number;
  heavy_open: number;
  pillars: { pillar: string; count: number }[];
  emotions: { emotion: string; count: number }[];
  by_who: { who: string; count: number }[];
  charges: { charge: string; count: number }[];
  recent: Feeling[];
}
