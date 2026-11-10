import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAceContinuityContext } from './ace-continuity.js';
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

test('ACE orientation combines the manifest and Bytelight-addressed handoffs', async () => {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const context = await buildAceContinuityContext({
    listServers: () => [server],
    execute: async (_url, _key, tool, args) => {
      calls.push({ tool, args });
      return { ok: true, result: tool === 'ash_wake_manifest' ? '{"project":"ACE bridge"}' : '{"from_runtime":"ash_chatgpt_interactive"}' };
    },
  });
  assert.deepEqual(calls, [
    { tool: 'ash_wake_manifest', args: {} },
    { tool: 'ash_read_room_handoffs', args: { to_room: 'bytelight', limit: 6 } },
  ]);
  assert.match(context, /ACE shared continuity/);
  assert.match(context, /ACE bridge/);
  assert.match(context, /ash_chatgpt_interactive/);
  assert.match(context, /non-authoritative/);
});

test('ACE orientation degrades to whichever read succeeded', async () => {
  const context = await buildAceContinuityContext({
    listServers: () => [server],
    execute: async (_url, _key, tool) => tool === 'ash_wake_manifest'
      ? { ok: false, result: 'Tool error: offline' }
      : { ok: true, result: '{"handoffs":[]}' },
  });
  assert.doesNotMatch(context, /offline/);
  assert.match(context, /Recent room handoffs/);
});
