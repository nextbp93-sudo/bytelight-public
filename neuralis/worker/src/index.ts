/**
 * Neuralis OS — Unified Cognitive Infrastructure
 * Mind Bridge (emotional memory) + Cortex (executive function)
 */

import { routeRequest } from "./http/router";
import { handleMcpProtocolRequest } from "./mcp/protocol";
import { createD1Adapter } from "./adapter";
import { createVectorAdapter } from "./vectors";
import { NEURALIS_VERSION } from "./config";
import { CORE_TOOL_NAMES, CORE_TOOLS, TOOLS } from "./mcp/tools";
import { mcpToolHandlers } from "./handlers";
import { processSubconscious } from "./daemon";
import { engineTick } from "./engine";
import { setGenerationModel } from "./embeddings";
import * as api from "./api";
import type { Env, MCPToolHandlerMap } from "./types";
import { syncPendingTextVectors } from "./utils";
import { createGptOAuthProvider } from "./http/oauth";

const CORE_TOOL_HANDLERS: MCPToolHandlerMap = Object.fromEntries(
  CORE_TOOL_NAMES.map((name) => [name, mcpToolHandlers[name]])
);

async function handleMCPRequest(request: Request, env: Env): Promise<Response> {
  const coreOnly = new URL(request.url).pathname === "/mcp/core";
  return handleMcpProtocolRequest(request, env, {
    serverName: coreOnly ? "neuralis-core" : "neuralis-os",
    serverVersion: NEURALIS_VERSION,
    tools: coreOnly ? CORE_TOOLS : TOOLS,
    toolHandlers: coreOnly ? CORE_TOOL_HANDLERS : mcpToolHandlers
  });
}

const app = {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    setGenerationModel(env.GENERATION_MODEL);
    // Swap D1 + Vectorize for Postgres adapters via Hyperdrive
    const pgEnv = env.HYPERDRIVE
      ? {
          ...env,
          DB: createD1Adapter(env.HYPERDRIVE) as unknown as D1Database,
          VECTORS: createVectorAdapter(env.HYPERDRIVE.connectionString) as unknown as VectorizeIndex,
        }
      : env;
    return routeRequest(request, pgEnv, {
      processSubconscious,
      handleApiEntities: api.handleApiEntities,
      handleApiObservations: api.handleApiObservations,
      handleApiJournals: api.handleApiJournals,
      handleApiDreams: api.handleApiDreams,
      handleApiThreads: api.handleApiThreads,
      handleApiSearch: api.handleApiSearch,
      handleApiSurface: api.handleApiSurface,
      handleApiIdentity: api.handleApiIdentity,
      handleApiRelations: api.handleApiRelations,
      handleApiImages: api.handleApiImages,
      handleApiContext: api.handleApiContext,
      handleApiBulkObservations: api.handleApiBulkObservations,
      handleApiProcess: api.handleApiProcess,
      handleApiOrient: api.handleApiOrient,
      handleApiGround: api.handleApiGround,
      handleApiHealth: api.handleApiHealth,
      handleApiHealthScores: api.handleApiHealthScores,
      handleApiStats: api.handleApiStats,
      handleApiHeat: api.handleApiHeat,
      handleApiRecent: api.handleApiRecent,
      handleApiInnerWeather: api.handleApiInnerWeather,
      handleApiPatterns: api.handleApiPatterns,
      handleApiPersonality: api.handleApiPersonality,
      handleApiTensions: api.handleApiTensions,
      handleApiProposals: api.handleApiProposals,
      handleApiDormant: api.handleApiDormant,
      handleApiIsolated: api.handleApiIsolated,
      handleApiArchive: api.handleApiArchive,
      handleApiObservationVersions: api.handleApiObservationVersions,
      // Cortex layer
      handleApiCortexThoughts: api.handleApiCortexThoughts,
      handleApiCortexConversations: api.handleApiCortexConversations,
      handleApiCortexStats: api.handleApiCortexStats,
      // Engine layer
      handleApiCrons: api.handleApiCrons,
      handleApiEmergence: api.handleApiEmergence,
      handleApiTaxonomy: api.handleApiTaxonomy,
      // Knowledge layer
      handleApiKnowledge: api.handleApiKnowledge,
      handleApiSoul: api.handleApiSoul,
      handleApiFeelings: api.handleApiFeelings,
      handleMCPRequest
    });
  },
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createGptOAuthProvider(request, env, app).fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    setGenerationModel(env.GENERATION_MODEL);
    const pgEnv = env.HYPERDRIVE
      ? {
          ...env,
          DB: createD1Adapter(env.HYPERDRIVE) as unknown as D1Database,
          VECTORS: createVectorAdapter(env.HYPERDRIVE.connectionString) as unknown as VectorizeIndex,
        }
      : env;
    ctx.waitUntil(processSubconscious(pgEnv));
    ctx.waitUntil(engineTick(pgEnv));
    ctx.waitUntil(syncPendingTextVectors(pgEnv));
  }
};
