import assert from "node:assert/strict";
import test from "node:test";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  generateText,
  getEmbedding,
  getImageEmbedding,
  setGenerationModel,
} from "./embeddings";
import type { Env } from "./types";

function fakeEnv(run: (model: string, input: unknown) => Promise<unknown>): Env {
  return { AI: { run } } as unknown as Env;
}

test("Workers AI text embeddings retain 768 dimensions and are normalized", async () => {
  const raw = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 3 : index === 1 ? 4 : 0);
  const env = fakeEnv(async (model, input) => {
    assert.equal(model, EMBEDDING_MODEL);
    assert.deepEqual(input, {
      input: ["task: clustering | query: hello house"],
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return { data: [{ embedding: raw }] };
  });

  const embedding = await getEmbedding(env, "hello house");
  assert.equal(embedding.length, EMBEDDING_DIMENSIONS);
  assert.equal(embedding[0], 0.6);
  assert.equal(embedding[1], 0.8);
});

test("Workers AI image embeddings send image and context through the multimodal shape", async () => {
  const env = fakeEnv(async (model, input) => {
    assert.equal(model, EMBEDDING_MODEL);
    const body = input as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    assert.equal(body.messages[0].content[0].type, "text");
    assert.equal(body.messages[0].content[1].type, "image_url");
    return { data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(1) }] };
  });

  const embedding = await getImageEmbedding(env, Uint8Array.of(1, 2, 3).buffer, "image/png", "tiny star");
  assert.equal(embedding.length, EMBEDDING_DIMENSIONS);
});

test("Workers AI generation honors the configured model and extracts response text", async () => {
  setGenerationModel("@cf/test/generator");
  const env = fakeEnv(async (model, input) => {
    assert.equal(model, "@cf/test/generator");
    assert.deepEqual(input, {
      messages: [{ role: "user", content: "mechanical task" }],
      stream: false,
    });
    return { response: "done" };
  });
  assert.equal(await generateText(env, "mechanical task"), "done");
});
