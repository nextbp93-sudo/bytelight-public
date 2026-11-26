import assert from "node:assert/strict";
import test from "node:test";

import { rankRecall, renderConversation, scoreMap, splitMatchIds } from "./recall-merge";

const matches = [
  { id: "ctx-t1", score: 0.71 },
  { id: "conv-c1", score: 0.88 },
  { id: "ctx-t2", score: 0.52 },
  { id: "conv-c2", score: 0.61 },
  { id: "kn-other", score: 0.99 },
];

test("vector ids split into thoughts and conversations; other kinds are ignored", () => {
  assert.deepEqual(splitMatchIds(matches), { thoughtIds: ["t1", "t2"], conversationIds: ["c1", "c2"] });
});

test("thoughts and conversations rank together by score, and the limit holds", () => {
  const ranked = rankRecall(
    [{ id: "t1" }, { id: "t2" }],
    [{ id: "c1" }, { id: "c2" }],
    scoreMap(matches),
    3,
  );
  assert.deepEqual(ranked.map((h) => [h.kind, h.row.id]), [
    ["conversation", "c1"],
    ["thought", "t1"],
    ["conversation", "c2"],
  ]);
});

test("a conversation renders with the heading the house turns into a card", () => {
  const lines = renderConversation(
    {
      id: "conv-20260829071932-fop9",
      source: "claude-web",
      title: "Reset Week",
      summary: "Five days off. " + "x".repeat(700),
      domain: "life-rhythm",
      decisions: JSON.stringify(["fill Sam first", "code waits"]),
      started_at: null,
      created_at: "2026-08-29 07:19:32",
    },
    0.874,
  );
  assert.equal(lines[0], "### conversation [life-rhythm] (87%) — 2026-08-29");
  // The house's whisper heading pattern (whisper.ts MEMORY_HEADING).
  const m = lines[0].match(/^#{2,}\s*\S+(?:\s*\[([^\]]+)\])?(?:\s*\((\d{1,3})%\))?(?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?/);
  assert.deepEqual([m?.[1], m?.[2], m?.[3]], ["life-rhythm", "87", "2026-08-29"]);
  assert.match(lines[1], /^Reset Week: Five days off\. x+…$/);
  assert.ok(lines[1].length < 640);
  assert.equal(lines[2], "*Decisions: fill Sam first; code waits*");
  assert.equal(lines[3], "*From a claude-web conversation · ID: conv-20260829071932-fop9*");
});

test("a conversation with only a title, or nothing, still renders one line", () => {
  assert.equal(renderConversation({ id: "a", title: "Only a title", source: "manual" }, 0)[1], "Only a title");
  assert.equal(renderConversation({ id: "b", source: "manual" }, 0)[1], "(untitled conversation)");
  assert.equal(renderConversation({ id: "b", source: "manual" }, 0)[0], "### conversation — unknown");
});
