import type { MCPToolHandlerMap } from "../types";
import { handleMindOrient, handleMindGround } from "./wake";
import { handleMindThread, handleMindWrite, handleMindFeelToward } from "./write";
import { handleMindSearch, handleMindRead, handleMindTimeline, handleMindPatterns } from "./search";
import { handleMindListEntities, handleMindReadEntity, handleMindEntity, handleMindEdit, handleMindDelete } from "./entity";
import { handleMindSit, handleMindResolve, handleMindSurface, handleMindConsolidate } from "./emotional";
import { handleMindIdentity, handleMindContext, handleMindHealth, handleMindInnerWeather, handleMindTension } from "./state";
import { handleMindProposals, handleMindDormant, handleMindIsolated, handleMindArchive } from "./memory";
import { handleMindStoreImage } from "./image";
import { handleMindPersonality } from "./personality";
import {
  handleKnowStore, handleKnowQuery, handleKnowExtract, handleKnowReinforce, handleKnowContradict,
  handleKnowLandscape, handleKnowSessionStart, handleKnowSessionComplete, handleKnowSessionList
} from "./knowledge";
import { handleSoulGather, handleSoulGenerate, handleSoulRead, handleSoulValidate, handleSoulHistory } from "./soul";
import { handleMindFeel, handleMindFeelings, type MindFeelParams } from "./feelings";
import { cortexToolHandlers } from "../cortex";
import { runtimeIdentity } from "../provenance";
import {
  handleGenerationClaim,
  handleGenerationComplete,
  handleGenerationEnqueue,
  handleGenerationStatus,
} from "./generation";

export const mcpToolHandlers: MCPToolHandlerMap = {
  neuralis_runtime_identity: async (env) => runtimeIdentity(env),
  neuralis_generation_enqueue: async (env, params) => handleGenerationEnqueue(env, params),
  neuralis_generation_claim: async (env, params) => handleGenerationClaim(env, params),
  neuralis_generation_complete: async (env, params) => handleGenerationComplete(env, params),
  neuralis_generation_status: async (env, params) => handleGenerationStatus(env, params),
  mind_orient: async (env) => handleMindOrient(env),
  mind_ground: async (env) => handleMindGround(env),
  mind_thread: async (env, params) => handleMindThread(env, params),
  mind_write: async (env, params) => handleMindWrite(env, params),
  mind_search: async (env, params) => handleMindSearch(env, params),
  mind_edit: async (env, params) => handleMindEdit(env, params),
  mind_delete: async (env, params) => handleMindDelete(env, params),
  mind_entity: async (env, params) => handleMindEntity(env, params),
  mind_consolidate: async (env, params) => handleMindConsolidate(env, params),
  mind_feel_toward: async (env, params) => handleMindFeelToward(env, params),
  mind_identity: async (env, params) => handleMindIdentity(env, params),
  mind_context: async (env, params) => handleMindContext(env, params),
  mind_health: async (env) => handleMindHealth(env),
  mind_list_entities: async (env, params) => handleMindListEntities(env, params),
  mind_read_entity: async (env, params) => handleMindReadEntity(env, params),
  mind_sit: async (env, params) => handleMindSit(env, params),
  mind_resolve: async (env, params) => handleMindResolve(env, params),
  mind_surface: async (env, params) => handleMindSurface(env, params),
  mind_read: async (env, params) => handleMindRead(env, params),
  mind_timeline: async (env, params) => handleMindTimeline(env, params),
  mind_patterns: async (env, params) => handleMindPatterns(env, params),
  mind_inner_weather: async (env) => handleMindInnerWeather(env),
  mind_tension: async (env, params) => handleMindTension(env, params),
  mind_proposals: async (env, params) => handleMindProposals(env, params),
  mind_dormant: async (env, params) => handleMindDormant(env, params),
  mind_isolated: async (env, params) => handleMindIsolated(env, params),
  mind_archive: async (env, params) => handleMindArchive(env, params),
  mind_store_image: async (env, params) => handleMindStoreImage(env, params),
  mind_personality: async (env, params) => handleMindPersonality(env, params),
  // Feelings stream (NESTeq port)
  mind_feel: async (env, params) => handleMindFeel(env, params as unknown as MindFeelParams),
  mind_feelings: async (env, params) => handleMindFeelings(env, params),
  // Knowledge layer (NESTknow port)
  know_store: async (env, params) => handleKnowStore(env, params),
  know_query: async (env, params) => handleKnowQuery(env, params),
  know_extract: async (env, params) => handleKnowExtract(env, params),
  know_reinforce: async (env, params) => handleKnowReinforce(env, params),
  know_contradict: async (env, params) => handleKnowContradict(env, params),
  know_landscape: async (env, params) => handleKnowLandscape(env, params),
  know_session_start: async (env, params) => handleKnowSessionStart(env, params),
  know_session_complete: async (env, params) => handleKnowSessionComplete(env, params),
  know_session_list: async (env, params) => handleKnowSessionList(env, params),
  // Soul portraits (NESTsoul port)
  soul_gather: async (env, params) => handleSoulGather(env, params),
  soul_generate: async (env, params) => handleSoulGenerate(env, params),
  soul_read: async (env, params) => handleSoulRead(env, params),
  soul_validate: async (env, params) => handleSoulValidate(env, params),
  soul_history: async (env, params) => handleSoulHistory(env, params),
  // Cortex layer
  ...cortexToolHandlers
};

// Re-export all handlers for API layer
export {
  handleMindOrient, handleMindGround,
  handleMindThread, handleMindWrite, handleMindFeelToward,
  handleMindSearch, handleMindRead, handleMindTimeline, handleMindPatterns,
  handleMindListEntities, handleMindReadEntity, handleMindEntity, handleMindEdit, handleMindDelete,
  handleMindSit, handleMindResolve, handleMindSurface, handleMindConsolidate,
  handleMindIdentity, handleMindContext, handleMindHealth, handleMindInnerWeather, handleMindTension,
  handleMindProposals, handleMindDormant, handleMindIsolated, handleMindArchive,
  handleMindStoreImage, handleMindPersonality
};
