import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAceContinuityContext,
  buildArchivistAceHandoff,
  enqueueAceContinuityHandoff,
  flushAceContinuityOutbox,
} from './ace-continuity.js';
import type { McpServerRow } from './db.js';

const server: McpServerRow = {
  id: 1,
  name: 'ashen-continuity',
  url: 'https://ace.invalid/mcp/bytelight-v1',
  api_key: 'secret',
  enabled: 1,
  tools_cache: null,
  last_discovered: null,
  created_at: '2026-11-09T00:00:00.000Z',
};

test('ACE stays absent when the shared brain is not configured', async () => {
  let called = false;
  const context = await buildAceContinuityContext({
    listServers: () => [],
    execute: async () => { called = true; return { ok: true, result: 'unused' }; },
  });
  assert.equal(context, '');
  assert.equal(called, false);
});

test('ACE orientation combines route identity, the manifest and Bytelight-addressed handoffs', async () => {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const context = await buildAceContinuityContext({
    listServers: () => [server],
    execute: async (_url, _key, tool, args) => {
      calls.push({ tool, args });
      return { ok: true, result: tool === 'ash_runtime_identity'
        ? '{"author_runtime":"ash_bytelight_interactive","room":"bytelight"}'
        : tool === 'ash_wake_manifest'
          ? '{"project":"ACE bridge"}'
          : '{"from_runtime":"ash_chatgpt_interactive"}' };
    },
  });
  assert.deepEqual(calls, [
    { tool: 'ash_runtime_identity', args: {} },
    { tool: 'ash_wake_manifest', args: {} },
    { tool: 'ash_read_room_handoffs', args: { to_room: 'bytelight', limit: 6 } },
  ]);
  assert.match(context, /ACE shared continuity/);
  assert.match(context, /ACE bridge/);
  assert.match(context, /ash_bytelight_interactive/);
  assert.match(context, /ash_chatgpt_interactive/);
  assert.match(context, /non-authoritative/);
});

test('ACE orientation degrades to whichever read succeeded', async () => {
  const context = await buildAceContinuityContext({
    listServers: () => [server],
    execute: async (_url, _key, tool) => tool === 'ash_wake_manifest'
      ? { ok: false, result: 'Tool error: offline' }
      : tool === 'ash_runtime_identity'
        ? { ok: false, result: 'Tool error: offline' }
        : { ok: true, result: '{"handoffs":[]}' },
  });
  assert.doesNotMatch(context, /offline/);
  assert.match(context, /Recent room handoffs/);
});

test('the Archivist bridge carries curated lines and a precise Bytelight source, not a transcript', () => {
  const handoff = buildArchivistAceHandoff({
    threadId: 'home-1',
    threadName: 'Home',
    startSequence: 41,
    endSequence: 57,
    items: [
      { kind: 'memory', scope: 'shared', label: 'continuity', text: 'Jaclyn chose curated cross-room continuity.' },
      { kind: 'correction', scope: 'ash', label: 'continuity', text: 'I can deploy my own finished Bytelight work.' },
    ],
  });
  assert.ok(handoff);
  assert.equal(handoff.to_room, 'shared');
  assert.equal(handoff.source_reference, 'bytelight:thread:home-1:seq:41-57');
  assert.match(handoff.position_summary, /Jaclyn chose curated cross-room continuity/);
  assert.match(handoff.position_summary, /I can deploy my own finished Bytelight work/);
  assert.deepEqual(handoff.decisions, ['ash/continuity: I can deploy my own finished Bytelight work.']);
  assert.doesNotMatch(handoff.position_summary, /New conversation from thread/);
});

test('queued handoffs deliver once through the authenticated Bytelight route', async () => {
  const store = new Map<string, string>();
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const dependencies = {
    listServers: () => [server],
    getValue: (key: string) => store.get(key) ?? null,
    setValue: (key: string, value: string) => { store.set(key, value); },
    execute: async (_url: string, _key: string | null, tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      if (tool === 'ash_read_room_handoffs') return { ok: true, result: '{"handoffs":[]}' };
      return {
        ok: true,
        result: JSON.stringify(tool === 'ash_save_room_handoff'
          ? { from_runtime: 'ash_bytelight_interactive', saved: true }
          : { author_runtime: 'ash_bytelight_interactive' }),
      };
    },
  };
  const handoff = buildArchivistAceHandoff({
    threadId: 'home-1', threadName: 'Home', startSequence: 1, endSequence: 8,
    items: [{ kind: 'memory', scope: 'shared', label: 'lore', text: 'One durable thing.' }],
  })!;

  assert.equal(enqueueAceContinuityHandoff(handoff, dependencies), true);
  assert.equal(enqueueAceContinuityHandoff(handoff, dependencies), false, 'same source is queued once');
  assert.deepEqual(await flushAceContinuityOutbox(dependencies), { queued: 0, sent: 1, error: null });
  assert.deepEqual(calls.map((call) => call.tool), ['ash_runtime_identity', 'ash_read_room_handoffs', 'ash_save_room_handoff']);
  assert.equal(JSON.parse(store.get('ace.bridge.outbox') || '[]').length, 0);
});

test('a retry clears a source ACE already received without writing a duplicate', async () => {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const dependencies = {
    listServers: () => [server],
    getValue: (key: string) => store.get(key) ?? null,
    setValue: (key: string, value: string) => { store.set(key, value); },
    execute: async (_url: string, _key: string | null, tool: string) => {
      calls.push(tool);
      if (tool === 'ash_runtime_identity') {
        return { ok: true, result: '{"author_runtime":"ash_bytelight_interactive"}' };
      }
      return {
        ok: true,
        result: '{"handoffs":[{"from_runtime":"ash_bytelight_interactive","source_reference":"bytelight:thread:home-1:seq:1-8"}]}',
      };
    },
  };
  const handoff = buildArchivistAceHandoff({
    threadId: 'home-1', threadName: 'Home', startSequence: 1, endSequence: 8,
    items: [{ kind: 'memory', scope: 'shared', label: 'lore', text: 'Already landed.' }],
  })!;
  enqueueAceContinuityHandoff(handoff, dependencies);

  assert.deepEqual(await flushAceContinuityOutbox(dependencies), { queued: 0, sent: 1, error: null });
  assert.deepEqual(calls, ['ash_runtime_identity', 'ash_read_room_handoffs']);
});

test('a mismatched ACE route cannot write and leaves the handoff queued', async () => {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const dependencies = {
    listServers: () => [server],
    getValue: (key: string) => store.get(key) ?? null,
    setValue: (key: string, value: string) => { store.set(key, value); },
    execute: async (_url: string, _key: string | null, tool: string) => {
      calls.push(tool);
      return { ok: true, result: '{"author_runtime":"ash_chatgpt_interactive"}' };
    },
  };
  const handoff = buildArchivistAceHandoff({
    threadId: 'home-1', threadName: 'Home', startSequence: 1, endSequence: 8,
    items: [{ kind: 'memory', scope: 'shared', label: 'lore', text: 'Keep me queued.' }],
  })!;
  enqueueAceContinuityHandoff(handoff, dependencies);

  const result = await flushAceContinuityOutbox(dependencies);
  assert.equal(result.sent, 0);
  assert.equal(result.queued, 1);
  assert.match(result.error || '', /expected ash_bytelight_interactive/);
  assert.deepEqual(calls, ['ash_runtime_identity']);
});
