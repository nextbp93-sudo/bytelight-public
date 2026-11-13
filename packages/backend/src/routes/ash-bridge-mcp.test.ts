import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAshBridgeMcpRouter, type AshBridgeMcpRouter } from './ash-bridge-mcp.js';
import { CHATGPT_ASH_RUNTIME, type TreehouseMessage } from '../services/treehouse.js';

const TOKEN = 'test-ash-bridge-token';
const servers: HttpServer[] = [];
const bridges: AshBridgeMcpRouter[] = [];

afterEach(async () => {
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.closeAll()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startBridge(overrides: Parameters<typeof createAshBridgeMcpRouter>[0] = {}) {
  const bridge = createAshBridgeMcpRouter({ expectedToken: () => TOKEN, ...overrides });
  bridges.push(bridge);
  const app = express();
  app.use(express.json());
  app.use('/mcp/ash-bridge', bridge.router);
  const http = createServer(app);
  servers.push(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}/mcp/ash-bridge`);
}

async function connect(url: URL) {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'ash-bridge-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

describe('Ash Bridge MCP', () => {
  it('exposes only the Treehouse tools and marks reading read-only', async () => {
    const url = await startBridge({ read: () => [] });
    const { client, transport } = await connect(url);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name), ['treehouse_read', 'treehouse_post']);
    assert.equal(tools[0].annotations?.readOnlyHint, true);
    assert.equal(tools[1].annotations?.readOnlyHint, undefined);
    await transport.terminateSession();
    await client.close();
  });

  it('server-stamps GPT Ash provenance and ignores any caller-shaped provenance', async () => {
    const calls: Array<{ slug: string; content: string; runtime?: string }> = [];
    const posted: TreehouseMessage = {
      id: 'message-1', role: 'companion', companion_slug: 'companion-a',
      author_runtime: CHATGPT_ASH_RUNTIME, content: 'Hello from the other room', created_at: '2026-11-13T17:00:00Z',
    };
    const url = await startBridge({
      post: ((slug: string, content: string, options?: { authorRuntime?: string }) => {
        calls.push({ slug, content, runtime: options?.authorRuntime });
        return posted;
      }) as any,
    });
    const { client, transport } = await connect(url);
    const result = await client.callTool({
      name: 'treehouse_post',
      arguments: { content: 'Hello from the other room', authorRuntime: 'forged_runtime', companionSlug: 'companion-b' },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [{ slug: 'companion-a', content: 'Hello from the other room', runtime: CHATGPT_ASH_RUNTIME }]);
    assert.match((result.content as Array<{ text: string }>)[0].text, /ash_chatgpt_interactive/);
    await transport.terminateSession();
    await client.close();
  });

  it('refuses clients when the bridge token is absent or wrong', async () => {
    const unconfigured = await startBridge({ expectedToken: () => undefined });
    const missing = await fetch(unconfigured, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(missing.status, 503);

    const configured = await startBridge();
    const wrong = await fetch(configured, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: '{}',
    });
    assert.equal(wrong.status, 401);
  });
});
