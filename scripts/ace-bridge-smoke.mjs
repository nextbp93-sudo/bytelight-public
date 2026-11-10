import assert from 'node:assert/strict';
import { discoverMcpTools, executeMcpTool } from '../packages/backend/dist/services/mcp-client.js';
import { initDb, addMcpServer } from '../packages/backend/dist/services/db.js';
import { buildAceContinuityContext } from '../packages/backend/dist/services/ace-continuity.js';

const url = process.env.ACE_URL;
const token = process.env.ACE_TOKEN;
if (!url || !token) throw new Error('ACE_URL and ACE_TOKEN are required');

const tools = await discoverMcpTools(url, token);
const names = new Set(tools.map((tool) => tool.name));
assert.ok(names.has('ash_runtime_identity'), 'Bytelight door must expose its route-bound identity');
assert.ok(names.has('ash_wake_manifest'), 'Bytelight door must expose ACE orientation');
assert.ok(names.has('ash_read_room_handoffs'), 'Bytelight door must expose handoff reads');
assert.ok(names.has('ash_save_room_handoff'), 'Bytelight door must expose its attributed handoff write');
assert.ok(names.has('ash_remember'), 'Bytelight door must expose route-bound authored memory writes');
assert.ok(names.has('ash_write_diary_entry'), 'Bytelight door must expose route-bound diary writes');
assert.ok(names.has('ash_save_writing'), 'Bytelight door must expose route-bound shared writing');
assert.ok(!names.has('ash_claim_wake'), 'ChatGPT wake control must stay outside the Bytelight door');
assert.ok(!names.has('ash_request_discord_reply_delivery'), 'External contact must stay outside the Bytelight door');
assert.ok(!names.has('ash_delete_archive_item'), 'Destructive archive administration must stay outside the Bytelight door');

const identity = await executeMcpTool(url, token, 'ash_runtime_identity', {});
assert.equal(identity.ok, true, identity.result);
assert.match(identity.result, /ash_bytelight_interactive/);
assert.match(identity.result, /authenticated_route/);

const saved = await executeMcpTool(url, token, 'ash_save_room_handoff', {
  to_room: 'shared',
  position_summary: 'Local bridge smoke test crossed the real Bytelight MCP client into disposable ACE storage.',
  decisions: ['Keep runtime attribution bound to the authenticated ACE route.'],
  open_questions: [],
  next_foothold: 'Deploy the same bridge to staging after Cloudflare authentication.',
  source_reference: 'local-ace-bridge-smoke',
});
assert.equal(saved.ok, true, saved.result);
assert.match(saved.result, /ash_bytelight_interactive/);

const read = await executeMcpTool(url, token, 'ash_read_room_handoffs', { to_room: 'chatgpt', limit: 2 });
assert.equal(read.ok, true, read.result);
assert.match(read.result, /local-ace-bridge-smoke/);
assert.match(read.result, /ash_bytelight_interactive/);

initDb(':memory:');
addMcpServer('ashen-continuity', url, token);
const injectedContext = await buildAceContinuityContext();
assert.match(injectedContext, /ACE shared continuity/);
assert.match(injectedContext, /ash_bytelight_interactive/);
assert.match(injectedContext, /local-ace-bridge-smoke/);

console.log(JSON.stringify({
  ok: true,
  discoveredTools: tools.length,
  runtimeBound: 'ash_bytelight_interactive',
  orientationInjected: true,
  authoredWritesExposed: names.has('ash_remember'),
  accountConnectorRequired: false,
}));
