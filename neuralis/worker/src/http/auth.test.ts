import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedGptRequest } from "./auth";
import { requestProvenance } from "../provenance";
import type { Env } from "../types";

const env = { MCP_CONNECTOR_SECRET: "gpt-secret" } as Env;

test("the stable GPT endpoint accepts only the connector bearer", () => {
  assert.equal(isAuthorizedGptRequest(new Request("https://mind.test/mcp/gpt"), env), false);
  assert.equal(isAuthorizedGptRequest(new Request("https://mind.test/mcp/gpt", {
    headers: { Authorization: "Bearer wrong-secret" },
  }), env), false);
  assert.equal(isAuthorizedGptRequest(new Request("https://mind.test/mcp/gpt", {
    headers: { Authorization: "Bearer gpt-secret" },
  }), env), true);
});

test("the stable GPT endpoint accepts an already-validated OAuth request", () => {
  assert.equal(isAuthorizedGptRequest(
    new Request("https://mind.test/mcp/gpt"),
    { GPT_OAUTH_AUTHORIZED: true } as Env,
  ), true);
});

test("the stable GPT endpoint receives immutable GPT provenance", () => {
  assert.deepEqual(requestProvenance(new Request("https://mind.test/mcp/gpt", {
    headers: { "X-Neuralis-Runtime": "bl:spoofed" },
  }), env), {
    runtimeFamily: "gpt",
    runtimeTag: "gpt:chatgpt",
    transport: "chatgpt-connector",
  });
});

test("the bearer MCP endpoint remains in the BL family", () => {
  assert.deepEqual(requestProvenance(new Request("https://mind.test/mcp", {
    headers: { "X-Neuralis-Runtime": "bl:phone" },
  }), env), {
    runtimeFamily: "bl",
    runtimeTag: "bl:phone",
    transport: "mcp-bearer",
  });
});
