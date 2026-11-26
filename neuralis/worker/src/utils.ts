import { getEmbedding as getGeminiEmbedding } from "./embeddings";
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

// Generate embedding using Gemini Embedding 2
export async function getEmbedding(env: Env, text: string): Promise<number[]> {
  return getGeminiEmbedding(env.GEMINI_API_KEY, text);
}

export async function searchVectors(env: Env, query: string, topK: number) {
  const embedding = await getEmbedding(env, query);
  return env.VECTORS.query(embedding, { topK, returnMetadata: "all" });
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
