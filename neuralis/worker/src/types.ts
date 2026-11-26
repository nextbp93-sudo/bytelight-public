export interface Env {
  DB: D1Database;
  HYPERDRIVE: Hyperdrive;
  VECTORS: VectorizeIndex;
  R2_IMAGES: R2Bucket;
  GEMINI_API_KEY: string;
  GENERATION_MODEL?: string;
  MIND_API_KEY: string;
  SIGNING_SECRET?: string;
  MCP_CONNECTOR_SECRET?: string;
  WEATHER_API_KEY?: string;
  DASHBOARD_ALLOWED_ORIGIN?: string;
  INTERNAL_KEY?: string;
  WORKER_URL?: string;
  R2_PATH_PREFIX?: string;
  LOCATION_NAME?: string;
  LOCATION_LAT?: string;
  LOCATION_LON?: string;
  LOCATION_TZ?: string;
  GENERATIVE_WRITES?: string;
  REQUEST_PROVENANCE?: {
    runtimeFamily: "bl" | "gpt" | "system" | "unknown";
    runtimeTag: string;
    transport: string;
  };
}

export interface MCPRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type MCPToolHandler = (
  env: Env,
  params: Record<string, unknown>
) => Promise<string>;

export type MCPToolHandlerMap = Record<string, MCPToolHandler>;

export interface WeatherData {
  atmosphere: string;
  temp_f: number | null;
  location: string;
  error?: string;
  weather_code?: number;
}

export interface TimeContext {
  period: string;
  energy: string;
  textures: string[];
}

// Cortex layer types
export interface CortexThought {
  id: string;
  type: "decision" | "principle" | "insight" | "observation" | "question";
  domain: string | null;
  content: string;
  context: string | null;
  importance: "breakthrough" | "significant" | "routine";
  thinking_stage: "exploring" | "crystallizing" | "refining" | "executing" | null;
  open_questions: string | null;  // JSON array
  related_thoughts: string | null;  // JSON array
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
}

export interface CortexConversation {
  id: string;
  source: string;
  title: string | null;
  summary: string | null;
  domain: string | null;
  importance: "breakthrough" | "significant" | "routine";
  thinking_stage: string | null;
  emotional_tone: string | null;
  decisions: string | null;  // JSON array
  open_questions: string | null;  // JSON array
  key_insights: string | null;  // JSON array
  concepts: string | null;  // JSON array
  message_count: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface CortexMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  msg_index: number | null;
  has_code: number;
  has_question: number;
  word_count: number | null;
  created_at: string | null;
}

export interface SubconsciousState {
  processed_at?: string;
  hot_entities?: Array<{name: string; warmth: number; mentions: number; connections: number; type: string}>;
  mood?: {dominant: string; confidence: string; undercurrent?: string};
  central_nodes?: Array<{name: string; connections: number}>;
  recurring_patterns?: Array<{entity: string; mentions: number; pattern: string}>;
  relation_patterns?: Array<{type: string; count: number}>;
  living_surface?: {
    pending_proposals: number;
    dormant_count: number;
    novelty_distribution: { high: number; medium: number; low: number };
    strongest_co_surface: Array<{ obs_a: string; obs_b: string; count: number; entities: [string, string] }>;
  };
}
