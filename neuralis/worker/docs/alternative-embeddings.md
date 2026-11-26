# Embedding Provider

Neuralis uses Cloudflare Workers AI through the native `AI` binding. The
default model is `@cf/google/embeddinggemma-2`: 768 dimensions with text and
image input in one vector space. It needs no Gemini, OpenAI, or other external
API key.

All provider logic lives in `src/embeddings.ts`:

```typescript
getEmbedding(env: Env, text: string): Promise<number[]>
getImageEmbedding(
  env: Env,
  imageData: ArrayBuffer,
  mimeType: string,
  contextText?: string,
): Promise<number[]>
```

The required binding is already declared in `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

## Changing providers

You may replace the implementation in `src/embeddings.ts`, but preserve both
function signatures and the 768-dimensional output unless you intentionally
rebuild every stored vector.

Provider changes are migrations, not ordinary configuration changes. Vectors
from different models cannot be meaningfully compared even when their array
length is identical. To change models safely:

1. Stop writes or preserve every failed sidecar in `vector_sync_queue`.
2. Create a new Vectorize index with the new model's dimensions.
3. Re-embed entities, observations, journals, feelings, knowledge, Cortex data,
   and images from their authoritative D1/R2 records.
4. Switch the Worker binding only after the replacement index is complete.
5. Recalibrate similarity thresholds against real house data.

Do not mix old and new vectors in one index. The D1 records are authoritative;
Vectorize is a searchable sidecar that can be rebuilt.

## Local models

A deployed Cloudflare Worker cannot reach `localhost`. Ollama or another local
embedding server must be exposed through an authenticated public endpoint, or
used only while running `wrangler dev` on the same machine. That architecture
adds another service to keep online and is not the default deployment.
