import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { history, importedConversationId, type HistoryDb } from "./archive";

// Run from worker/ (npx tsx --test src/history/archive.test.ts).
const migration = (name: string) => readFileSync(`migrations/${name}`, "utf8");

/** A throwaway SQLite with the conversation table and migration 0017, behind D1's call shape. */
function freshStore() {
  const sql = new DatabaseSync(":memory:");
  const cortex = migration("0004_cortex.sql");
  sql.exec(cortex.slice(cortex.indexOf("CREATE TABLE cortex_conversations"), cortex.indexOf("-- cortex_messages")));
  sql.exec(migration("0017_history_import.sql"));
  const db: HistoryDb = {
    prepare: (s) => ({
      bind: (...v) => ({
        first: async () => (sql.prepare(s).get(...(v as never[])) as Record<string, unknown>) ?? null,
        all: async () => ({ results: sql.prepare(s).all(...(v as never[])) as Record<string, unknown>[] }),
        run: async () => sql.prepare(s).run(...(v as never[])),
      }),
    }),
  };
  const indexed: Array<{ id: string; metadata: Record<string, string> }> = [];
  const deps = { db, indexConversation: async (id: string, _t: string, metadata: Record<string, string>) => { indexed.push({ id, metadata }); } };
  const call = (path: string, body?: unknown) => history(
    new Request("https://brain.invalid/api/history/" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined }),
    deps,
    path.split("?")[0].split("/"),
  );
  return { sql, call, indexed };
}

const line = (id: string, pos: number, prev: string | null, text: string, role = pos % 2 ? "assistant" : "user") =>
  ({ id, pos, prev, role, text, at: `2026-10-0${pos + 1}T12:00:00.000Z` });

const chat = { source: "claude", chat: "oct-chat-1", title: "October rain ride", voice: "rowan-ash" };

test("a batch stores passages with their voice, and a repeat adds nothing", async () => {
  const { sql, call } = freshStore();
  const lines = [line("m1", 0, null, "It rained the whole ride."), line("m2", 1, "m1", "You still went.")];
  assert.equal((await call("batch", { ...chat, lines })).status, 200);
  assert.equal((await call("batch", { ...chat, lines })).status, 200);
  const rows = sql.prepare("SELECT id, voice, prev FROM history_passages ORDER BY pos").all() as Array<Record<string, string>>;
  assert.deepEqual(rows.map((r) => [r.id, r.voice, r.prev]), [
    ["claude:oct-chat-1:m1", "rowan-ash", null],
    ["claude:oct-chat-1:m2", "rowan-ash", "claude:oct-chat-1:m1"],
  ]);
});

test("a conversation row lands once, with its voice, and is indexed once", async () => {
  const { sql, call, indexed } = freshStore();
  const body = { ...chat, summary: "Sam rode in the rain and the companions were proud.", started_at: "2026-10-01T12:00:00.000Z", message_count: 2 };
  assert.deepEqual(await (await call("conversation", body)).json(), { id: "claude-oct-chat-1", created: true });
  assert.deepEqual(await (await call("conversation", body)).json(), { id: "claude-oct-chat-1", created: false });
  const row = sql.prepare("SELECT id, source, voice, domain, summary FROM cortex_conversations").get() as Record<string, string>;
  assert.deepEqual([row.id, row.source, row.voice, row.domain], ["claude-oct-chat-1", "claude-web", "rowan-ash", "imported-history"]);
  assert.equal(indexed.length, 1, "a repeat is not embedded again");
  assert.equal(indexed[0].id, "conv-claude-oct-chat-1");
  assert.equal(indexed[0].metadata.voice, "rowan-ash");
  assert.equal(importedConversationId("claude", "oct-chat-1"), "claude-oct-chat-1");
});

test("search finds a phrase, and a voice filter keeps another companion's history out", async () => {
  const { call } = freshStore();
  await call("batch", { ...chat, lines: [line("m1", 0, null, "The velvet turnip is the password.")] });
  await call("batch", { source: "chatgpt", chat: "juniper-1", title: "Planning", voice: "juniper", lines: [line("j1", 0, null, "A velvet turnip plan.")] });
  const all = await (await call("search", { query: "VELVET turnip" })).json() as { rows: Array<{ voice: string }> };
  assert.equal(all.rows.length, 2);
  const ours = await (await call("search", { query: "velvet turnip", voice: "rowan-ash" })).json() as { rows: Array<{ voice: string }> };
  assert.deepEqual(ours.rows.map((r) => r.voice), ["rowan-ash"]);
  assert.equal(((await (await call("search", { query: "%" })).json()) as { rows: unknown[] }).rows.length, 0);
});

test("a moment opens with its real neighbours", async () => {
  const { call } = freshStore();
  await call("batch", { ...chat, lines: [line("a", 0, null, "one"), line("b", 1, "a", "two"), line("c", 2, "b", "three"), line("d", 3, "c", "four")] });
  const page = await (await call("moment/" + encodeURIComponent("claude:oct-chat-1:b"))).json() as { rows: Array<{ body: string }> };
  assert.deepEqual(page.rows.map((r) => r.body), ["one", "two", "three", "four"]);
  assert.equal((await call("moment/claude:nope:nope")).status, 404);
});

test("bad input is refused before anything is written", async () => {
  const { sql, call } = freshStore();
  const bad = [
    { ...chat, voice: undefined, lines: [line("m1", 0, null, "x")] },
    { ...chat, voice: "Rowan Ash!", lines: [line("m1", 0, null, "x")] },
    { ...chat, source: "gemini", lines: [line("m1", 0, null, "x")] },
    { ...chat, lines: [] },
    { ...chat, lines: Array.from({ length: 9 }, (_, i) => line(`m${i}`, i, null, "x")) },
    { ...chat, lines: [line("m1", 0, null, "x".repeat(60_001))] },
    { ...chat, lines: [line("m1", 0, "m1", "x")] },
  ];
  for (const body of bad) assert.equal((await call("batch", body)).status === 200, false, JSON.stringify(body).slice(0, 80));
  assert.equal((await call("conversation", { ...chat, summary: "" })).status, 400);
  assert.equal((await call("unknown", {})).status, 404);
  assert.equal((sql.prepare("SELECT count(*) AS n FROM history_passages").get() as { n: number }).n, 0);
  assert.equal(((await (await call("ready")).json()) as { voices: boolean }).voices, true);
});

test("passages page out in order, by voice, and a later import is picked up after the cursor", async () => {
  const { call } = freshStore();
  await call("batch", { ...chat, lines: [line("a", 0, null, "one"), line("b", 1, "a", "two"), line("c", 2, "b", "three")] });
  await call("batch", { source: "chatgpt", chat: "juniper-1", title: "Planning", voice: "juniper", lines: [line("j1", 0, null, "his")] });
  type Page = { rows: Array<{ id: string; body: string; voice: string; cursor: number }>; next: number; done: boolean };
  const first = await (await call("passages?voice=rowan-ash&limit=2")).json() as Page;
  assert.deepEqual(first.rows.map((r) => r.body), ["one", "two"]);
  assert.equal(first.done, false);
  const second = await (await call(`passages?voice=rowan-ash&limit=2&after=${first.next}`)).json() as Page;
  assert.deepEqual(second.rows.map((r) => r.body), ["three"]);
  assert.equal(second.done, true);
  assert.ok(second.rows.every((r) => r.voice === "rowan-ash"), "another voice never comes back");
  await call("batch", { ...chat, lines: [line("d", 3, "c", "four")] });
  const later = await (await call(`passages?voice=rowan-ash&after=${second.next}`)).json() as Page;
  assert.deepEqual(later.rows.map((r) => r.body), ["four"]);
  assert.equal((await call("passages?after=-1")).status, 400);
  assert.equal((await call("passages?voice=Not%20A%20Slug")).status, 400);
});
