import { getEmbedding as getWorkersEmbedding } from "./embeddings";
import type { Env, SubconsciousState } from "./types";

// Normalize text to ASCII - prevents Unicode homoglyph issues
export function normalizeText(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.normalize('NFKD').replace(/[^a-zA-Z0-9\s,.\-]/g, '').trim() || null;
}

// Generate unique ID
export function generateId(prefix: string): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${timestamp}-${random}`;
}

// Helper: R2 path prefix (configurable via env)
export function r2Prefix(env: Env): string {
  return env.R2_PATH_PREFIX || "neuralis-images";
}

// Helper: Worker URL for self-referencing (image signed URLs, cf.image transform)
export function workerUrl(env: Env): string {
  if (env.WORKER_URL) return env.WORKER_URL.replace(/\/$/, "");
  return "https://localhost";
}

// Generate signed image URL (1 hour expiry, no API key exposed)
export async function imageUrl(imageId: number | string, env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const encoder = new TextEncoder();
  const secret = env.SIGNING_SECRET || env.MIND_API_KEY;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${imageId}:${expires}`));
  const sig = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${workerUrl(env)}/img/${imageId}?expires=${expires}&sig=${sig}`;
}

// Generate an embedding through the Worker's Cloudflare AI binding.
export async function getEmbedding(env: Env, text: string): Promise<number[]> {
  return getWorkersEmbedding(env, text);
}

export async function searchVectors(env: Env, query: string, topK: number) {
  const embedding = await getEmbedding(env, query);
  return env.VECTORS.query(embedding, { topK, returnMetadata: "all" });
}

export interface TextVectorWrite {
  id: string;
  text: string;
  metadata: Record<string, string>;
  sourceType: string;
  sourceId?: string | number;
}

/**
 * Store a text vector, or durably queue it when AI/Vectorize is temporarily
 * unavailable. The cognitive row is authoritative; its vector is a retryable
 * search sidecar and must never make the memory write fail.
 */
export async function upsertTextVector(env: Env, item: TextVectorWrite): Promise<boolean> {
  try {
    const embedding = await getEmbedding(env, item.text);
    await env.VECTORS.upsert([{ id: item.id, values: embedding, metadata: item.metadata }]);
    try {
      await env.DB.prepare("DELETE FROM vector_sync_queue WHERE vector_id = ?").bind(item.id).run();
    } catch { /* migration may not be applied yet */ }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await env.DB.prepare(
        `INSERT INTO vector_sync_queue
         (vector_id, source_type, source_id, text_content, metadata, attempts, last_error)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(vector_id) DO UPDATE SET
           text_content = excluded.text_content,
           metadata = excluded.metadata,
           attempts = vector_sync_queue.attempts + 1,
           last_error = excluded.last_error,
           updated_at = datetime('now')`,
      ).bind(
        item.id,
        item.sourceType,
        item.sourceId == null ? null : String(item.sourceId),
        item.text,
        JSON.stringify(item.metadata),
        message.slice(0, 2000),
      ).run();
    } catch (queueError) {
      console.warn("Vector sync queue write failed", queueError);
    }
    console.warn(`Queued vector ${item.id} for retry`, message);
    return false;
  }
}

/** Retry text vectors left behind by a temporary provider outage. */
export async function syncPendingTextVectors(env: Env, limit = 50): Promise<void> {
  let rows: unknown[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT id, vector_id, source_type, source_id, text_content, metadata
       FROM vector_sync_queue ORDER BY id ASC LIMIT ?`,
    ).bind(Math.max(1, Math.min(200, Math.trunc(limit)))).all();
    rows = result.results ?? [];
  } catch {
    return; // migration not applied yet
  }
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    let metadata: Record<string, string>;
    try { metadata = JSON.parse(String(row.metadata)); } catch { metadata = {}; }
    await upsertTextVector(env, {
      id: String(row.vector_id),
      text: String(row.text_content),
      metadata,
      sourceType: String(row.source_type),
      sourceId: row.source_id == null ? undefined : String(row.source_id),
    });
  }
}

// Get subconscious state from daemon processing
export async function getSubconsciousState(env: Env): Promise<SubconsciousState | null> {
  try {
    const result = await env.DB.prepare(
      "SELECT data, updated_at FROM subconscious WHERE state_type = 'daemon' ORDER BY updated_at DESC LIMIT 1"
    ).first();
    if (result?.data) {
      return JSON.parse(result.data as string) as SubconsciousState;
    }
  } catch {
    // Subconscious not available
  }
  return null;
}

export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}
