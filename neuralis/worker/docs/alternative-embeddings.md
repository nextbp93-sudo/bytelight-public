# Alternative Embedding Providers

Resonant Mind ships with [Gemini Embedding 2](https://ai.google.dev/gemini-api/docs/embeddings) as the default embedding provider. It's free, fast, and supports multimodal embeddings (text + images). But you might want an alternative — for cost, privacy, or self-hosting reasons.

This guide explains how to swap the embedding provider.

## Current default: Gemini Embedding 2

| Property | Value |
|----------|-------|
| Model | `gemini-embedding-2-preview` |
| Dimensions | 768 |
| Cost | Free (with API key from [Google AI Studio](https://aistudio.google.com/apikey)) |
| Multimodal | Yes (text + images) |
| Rate limit | 1,500 requests/minute (free tier) |

## How embeddings work in Resonant Mind

All embedding logic lives in one file: **`src/embeddings.ts`**. It exports two functions:

```typescript
// Text embedding
getEmbedding(apiKey: string, text: string): Promise<number[]>

// Image + text embedding (multimodal)
getImageEmbedding(apiKey: string, imageData: ArrayBuffer, mimeType: string, contextText?: string): Promise<number[]>
```

Every other file calls these functions — so swapping the provider means changing only this one file.

## Alternative: Cloudflare Workers AI (Free)

Cloudflare's built-in AI runs on the same network as your Worker — zero latency, no external API calls.

**Model:** `@cf/baai/bge-base-en-v1.5` (768 dimensions)

```typescript
// src/embeddings.ts — Cloudflare Workers AI version

export async function getEmbedding(
  ai: Ai,  // Change: pass env.AI instead of API key
  text: string
): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", { text: [text] });
  return result.data[0];
}

// Note: Workers AI doesn't support multimodal embeddings.
// For images, fall back to text-only embedding of the description.
export async function getImageEmbedding(
  ai: Ai,
  _imageData: ArrayBuffer,
  _mimeType: string,
  contextText?: string
): Promise<number[]> {
  return getEmbedding(ai, contextText || "image");
}
```

You'll also need to:
1. Add an AI binding to `wrangler.toml`:
   ```toml
   [ai]
   binding = "AI"
   ```
2. Update `src/types.ts` to include `AI: Ai` in the `Env` interface
3. Update calls from `getEmbedding(env.GEMINI_API_KEY, text)` to `getEmbedding(env.AI, text)`

**Pros:** Free, no external API key needed, lowest latency
**Cons:** No multimodal, model is older than Gemini Embedding 2

## Alternative: OpenAI Embeddings

**Model:** `text-embedding-3-small` (1536 dimensions, or configurable down to 768)

```typescript
// src/embeddings.ts — OpenAI version

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 768; // Request 768d for compatibility

export async function getEmbedding(
  apiKey: string,
  text: string
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      input: text,
      dimensions: DIMENSIONS
    })
  });
  const data = await response.json() as any;
  return data.data[0].embedding;
}

export async function getImageEmbedding(
  apiKey: string,
  _imageData: ArrayBuffer,
  _mimeType: string,
  contextText?: string
): Promise<number[]> {
  // OpenAI embeddings API doesn't support images directly
  return getEmbedding(apiKey, contextText || "image");
}
```

Rename `GEMINI_API_KEY` to `OPENAI_API_KEY` in `types.ts` and `wrangler.toml`, or reuse the same env var name.

**Pros:** High quality, widely supported
**Cons:** Costs money ($0.02/1M tokens), no multimodal embeddings

## Alternative: Ollama (Self-Hosted, Free)

Run embeddings locally with no API costs. Requires a machine running [Ollama](https://ollama.com/).

**Model:** `nomic-embed-text` (768 dimensions) or `mxbai-embed-large` (1024 dimensions)

```typescript
// src/embeddings.ts — Ollama version

const OLLAMA_URL = "http://localhost:11434"; // Or your Ollama host
const MODEL = "nomic-embed-text";

export async function getEmbedding(
  _apiKey: string, // Not used, but kept for interface compatibility
  text: string
): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text })
  });
  const data = await response.json() as any;
  return data.embedding;
}

export async function getImageEmbedding(
  apiKey: string,
  _imageData: ArrayBuffer,
  _mimeType: string,
  contextText?: string
): Promise<number[]> {
  return getEmbedding(apiKey, contextText || "image");
}
```

**Important:** Cloudflare Workers can't reach `localhost`. This approach only works if:
- You're running Resonant Mind locally via `wrangler dev`
- Or Ollama is exposed at a public URL / Cloudflare Tunnel

**Pros:** Completely free, private, no external dependencies
**Cons:** Requires running Ollama, can't reach localhost from deployed Workers

## Dimension compatibility

If you change embedding providers, the vector dimensions must match:

| Provider | Model | Dimensions |
|----------|-------|-----------|
| Gemini | `gemini-embedding-2-preview` | 768 |
| Cloudflare | `@cf/baai/bge-base-en-v1.5` | 768 |
| OpenAI | `text-embedding-3-small` | 768 (configurable) |
| OpenAI | `text-embedding-3-large` | 3072 (configurable) |
| Ollama | `nomic-embed-text` | 768 |
| Ollama | `mxbai-embed-large` | 1024 |

**If you change dimensions**, you need to:

1. **D1 + Vectorize:** Delete and recreate the Vectorize index with the new dimensions
2. **Postgres + pgvector:** Alter the embeddings table:
   ```sql
   -- Drop the old column and index
   DROP INDEX idx_embeddings_vector;
   ALTER TABLE embeddings DROP COLUMN embedding;

   -- Add with new dimensions (e.g., 1024)
   ALTER TABLE embeddings ADD COLUMN embedding vector(1024);
   CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
   ```

3. **Revectorize all data** — old vectors are incompatible with a new model. See [migration guide](migration-from-mind-cloud.md#6-revectorize-your-memories).

## Mixing providers

You cannot mix vectors from different models in the same index. An observation embedded with BGE cannot be meaningfully compared to one embedded with Gemini — the vector spaces are different. If you switch models, you must revectorize everything.
