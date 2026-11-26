import assert from "node:assert/strict";
import test from "node:test";

import { mcpToolHandlers } from "../handlers";
import { CORE_TOOL_NAMES, CORE_TOOLS, TOOLS } from "./tools";

test("every advertised MCP tool has exactly one dispatch handler", () => {
  const advertised = TOOLS.map((tool) => tool.name).sort();
  const implemented = Object.keys(mcpToolHandlers).sort();

  assert.equal(new Set(advertised).size, advertised.length, "tool definitions must be unique");
  assert.deepEqual(implemented, advertised);
});

test("know_store accepts every Neuralis provenance source, including feelings", () => {
  const knowStore = TOOLS.find((tool) => tool.name === "know_store");
  assert.ok(knowStore);

  const properties = knowStore.inputSchema.properties as Record<string, unknown>;
  const sourceType = (properties.sources as {
    items?: { properties?: { source_type?: { enum?: string[] } } };
  }).items?.properties?.source_type;

  assert.deepEqual(sourceType?.enum, [
    "feeling",
    "observation",
    "journal",
    "conversation",
    "thought",
    "manual",
  ]);
});

test("the always-loaded core is the exact eight-tool live memory surface", () => {
  assert.deepEqual(CORE_TOOLS.map((tool) => tool.name), [...CORE_TOOL_NAMES]);
  assert.equal(new Set(CORE_TOOL_NAMES).size, 8);
  assert.ok(CORE_TOOL_NAMES.includes("mind_feel"));
  assert.ok(CORE_TOOL_NAMES.includes("mind_feelings"));
});
