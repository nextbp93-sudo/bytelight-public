/**
 * Cloudflare Workers AI provider.
 *
 * EmbeddingGemma 2 preserves Neuralis' 768-dimensional multimodal vector
 * space without an external API key. Text generation is reserved for
 * mechanical background work; companion-authored work belongs to the tagged
 * BL/GPT generation queue.
 */

import type { Env } from "./types";

export const EMBEDDING_MODEL = "@cf/google/embeddinggemma-2";
export const DEFAULT_GENERATION_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const EMBEDDING_DIMENSIONS = 768;

let resolvedGenerationModel: string = DEFAULT_GENERATION_MODEL;

/** Call once at startup or first use to pick up env override. */
export function setGenerationModel(model?: string) {
  resolvedGenerationModel = model?.trim() || DEFAULT_GENERATION_MODEL;
}

/** The generation model currently in use (for audit trails). */
export function getGenerationModel(): string {
  return resolvedGenerationModel;
}

/** L2 normalize a vector so Vectorize cosine scores remain stable. */
function l2Normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vec.map((value) => value / magnitude) : vec;
}

function parseEmbedding(response: unknown): number[] {
  const value = response as {
    data?: Array<{ embedding?: number[] }> | number[][];
    result?: { data?: Array<{ embedding?: number[] }> | number[][] };
  };
  const data = value?.data ?? value?.result?.data;
  const first = Array.isArray(data) ? data[0] : undefined;
  const embedding = Array.isArray(first)
    ? first
    : first && typeof first === "object" && Array.isArray(first.embedding)
      ? first.embedding
      : undefined;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Workers AI returned an invalid ${EMBEDDING_MODEL} embedding`);
  }
  return l2Normalize(embedding.map(Number));
}

function parseGeneratedText(response: unknown): string {
  if (typeof response === "string") return response.trim();
  const value = response as {
    response?: string;
    result?: { response?: string; output_text?: string };
    output_text?: string;
  };
  const generated = value?.response ?? value?.output_text
    ?? value?.result?.response ?? value?.result?.output_text;
  if (!generated?.trim()) throw new Error("Workers AI generation returned no text");
  return generated.trim();
}

/** Generate mechanical system text through the Worker's bound AI service. */
export async function generateText(env: Env, prompt: string): Promise<string> {
  const response = await env.AI.run(resolvedGenerationModel as keyof AiModels, {
    messages: [{ role: "user", content: prompt }],
    stream: false,
  } as never);
  return parseGeneratedText(response);
}

/** Generate a text embedding through the bound Workers AI service. */
export async function getEmbedding(env: Env, text: string): Promise<number[]> {
  const response = await env.AI.run(EMBEDDING_MODEL as keyof AiModels, {
    input: [`task: clustering | query: ${text}`],
    dimensions: EMBEDDING_DIMENSIONS,
  } as never);
  return parseEmbedding(response);
}

/** Generate a multimodal image + context embedding in the same vector space. */
export async function getImageEmbedding(
  env: Env,
  imageData: ArrayBuffer,
  mimeType: string,
  contextText?: string,
): Promise<number[]> {
  const bytes = new Uint8Array(imageData);
  let binary = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
  const content: Array<Record<string, unknown>> = [];
  if (contextText?.trim()) content.push({ type: "text", text: contextText.trim() });
  content.push({ type: "image_url", image_url: { url: dataUrl } });

  const response = await env.AI.run(EMBEDDING_MODEL as keyof AiModels, {
    messages: [{ role: "user", content }],
    dimensions: EMBEDDING_DIMENSIONS,
  } as never);
  return parseEmbedding(response);
}
