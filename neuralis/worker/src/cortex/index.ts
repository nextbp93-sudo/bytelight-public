import type { MCPToolHandlerMap } from "../types";
import { handleCortexRemember, handleCortexRecall, handleCortexSavePrinciple, handleCortexListPrinciples } from "./remember";
import { handleCortexSaveConversation, handleCortexSearchConversations } from "./conversations";
import { handleCortexStats, handleCortexCognitivePatterns, handleCortexWhatWasIThinking } from "./stats";
import { handleCortexWhatDoIThink, handleCortexAlignmentCheck, handleCortexThinkingTrajectory } from "./synthesis";
import { handleCortexTunnelState, handleCortexContextRecovery, handleCortexDormantContexts, handleCortexOpenThreads, handleCortexSwitchingCost, handleCortexTunnelHistory } from "./prosthetic";

export const cortexToolHandlers: MCPToolHandlerMap = {
  // Storage
  cortex_remember: async (env, params) => handleCortexRemember(env, params),
  cortex_recall: async (env, params) => handleCortexRecall(env, params),
  cortex_save_principle: async (env, params) => handleCortexSavePrinciple(env, params),
  cortex_list_principles: async (env, params) => handleCortexListPrinciples(env, params),
  // Conversations
  cortex_save_conversation: async (env, params) => handleCortexSaveConversation(env, params),
  cortex_search_conversations: async (env, params) => handleCortexSearchConversations(env, params),
  // Synthesis
  cortex_what_do_i_think: async (env, params) => handleCortexWhatDoIThink(env, params),
  cortex_alignment_check: async (env, params) => handleCortexAlignmentCheck(env, params),
  cortex_thinking_trajectory: async (env, params) => handleCortexThinkingTrajectory(env, params),
  // Prosthetic
  cortex_tunnel_state: async (env, params) => handleCortexTunnelState(env, params),
  cortex_context_recovery: async (env, params) => handleCortexContextRecovery(env, params),
  cortex_dormant_contexts: async (env, params) => handleCortexDormantContexts(env, params),
  cortex_open_threads: async (env, params) => handleCortexOpenThreads(env, params),
  cortex_switching_cost: async (env, params) => handleCortexSwitchingCost(env, params),
  cortex_tunnel_history: async (env, params) => handleCortexTunnelHistory(env, params),
  // Stats
  cortex_stats: async (env) => handleCortexStats(env),
  cortex_cognitive_patterns: async (env, params) => handleCortexCognitivePatterns(env, params),
  cortex_what_was_i_thinking: async (env, params) => handleCortexWhatWasIThinking(env, params),
};

export {
  handleCortexRemember, handleCortexRecall, handleCortexSavePrinciple, handleCortexListPrinciples,
  handleCortexSaveConversation, handleCortexSearchConversations,
  handleCortexStats, handleCortexCognitivePatterns, handleCortexWhatWasIThinking,
  handleCortexWhatDoIThink, handleCortexAlignmentCheck, handleCortexThinkingTrajectory,
  handleCortexTunnelState, handleCortexContextRecovery, handleCortexDormantContexts, handleCortexOpenThreads,
  handleCortexSwitchingCost, handleCortexTunnelHistory
};
