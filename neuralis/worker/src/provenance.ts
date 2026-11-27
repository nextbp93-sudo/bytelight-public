import type { Env } from "./types";
import { EMBEDDING_MODEL, getGenerationModel } from "./embeddings";

export type RuntimeFamily = "bl" | "gpt" | "system" | "unknown";

export interface RuntimeProvenance {
  runtimeFamily: RuntimeFamily;
  runtimeTag: string;
  transport: string;
}

const SAFE_BL_TAG = /^bl:[a-z0-9._-]{1,80}$/i;

/**
 * Resolve authorship from the authenticated route itself. The GPT connector
 * secret owns the GPT tag; the Bytelight bearer owns the BL family and may add
 * a narrower BL lane tag. A caller cannot cross families with a header.
 */
export function requestProvenance(request: Request, env: Env): RuntimeProvenance {
  const url = new URL(request.url);
  const connector = env.MCP_CONNECTOR_SECRET?.trim();
  if (connector && (url.pathname === `/mcp/${connector}` || url.pathname === "/mcp/gpt")) {
    return { runtimeFamily: "gpt", runtimeTag: "gpt:chatgpt", transport: "chatgpt-connector" };
  }

  const requested = request.headers.get("X-Neuralis-Runtime")?.trim() || "";
  const runtimeTag = SAFE_BL_TAG.test(requested) ? requested.toLowerCase() : "bl:bytelight";
  return { runtimeFamily: "bl", runtimeTag, transport: url.pathname.startsWith("/mcp") ? "mcp-bearer" : "rest-bearer" };
}

export function withRequestProvenance(request: Request, env: Env): Env {
  return { ...env, REQUEST_PROVENANCE: requestProvenance(request, env) };
}

export function activeProvenance(env: Env): RuntimeProvenance {
  return env.REQUEST_PROVENANCE ?? {
    runtimeFamily: "system",
    runtimeTag: "system:heartbeat",
    transport: "scheduled",
  };
}

export function runtimeIdentity(env: Env): string {
  const p = activeProvenance(env);
  return JSON.stringify({
    service: "neuralis",
    runtime_family: p.runtimeFamily,
    runtime_tag: p.runtimeTag,
    transport: p.transport,
    embedding_provider: "cloudflare-workers-ai",
    embedding_model: EMBEDDING_MODEL,
    generation_provider: "cloudflare-workers-ai",
    generation_model: getGenerationModel(),
  });
}

export async function recordProvenance(
  env: Env,
  event: { operation: string; subject: string; outcome?: string; detail?: string },
): Promise<void> {
  const p = activeProvenance(env);
  try {
    await env.DB.prepare(
      `INSERT INTO runtime_provenance
       (runtime_family, runtime_tag, transport, operation, subject, outcome, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      p.runtimeFamily,
      p.runtimeTag,
      p.transport,
      event.operation,
      event.subject.slice(0, 240),
      event.outcome ?? "ok",
      event.detail?.slice(0, 2000) ?? null,
    ).run();
  } catch (error) {
    // Provenance is observability, never a reason to take the brain offline.
    console.warn("Neuralis provenance write failed", error);
  }
}

export async function listProvenance(env: Env, limit = 50): Promise<unknown[]> {
  try {
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await env.DB.prepare(
      `SELECT id, runtime_family, runtime_tag, transport, operation, subject,
              outcome, detail, created_at
       FROM runtime_provenance ORDER BY id DESC LIMIT ?`,
    ).bind(bounded).all();
    return result.results ?? [];
  } catch {
    return [];
  }
}
