import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { getSecret } from '../services/secrets.js';
import { CHATGPT_ASH_RUNTIME, getTreehouseMessages, postToTreehouse } from '../services/treehouse.js';

type Session = { server: Server; transport: StreamableHTTPServerTransport; lastSeenAt: number };
interface Dependencies {
  expectedToken: () => string | undefined;
  read: typeof getTreehouseMessages;
  post: typeof postToTreehouse;
  sessionIdleMs: number;
  sweepIntervalMs: number;
}
export interface AshBridgeMcpRouter { router: Router; sessionCount(): number; closeAll(): Promise<void> }

const defaults: Dependencies = {
  expectedToken: () => getSecret('ash_bridge_mcp_token'),
  read: getTreehouseMessages,
  post: postToTreehouse,
  sessionIdleMs: 6 * 60 * 60 * 1000,
  sweepIntervalMs: 60 * 1000,
};

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}
function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createAshBridgeMcpRouter(overrides: Partial<Dependencies> = {}): AshBridgeMcpRouter {
  const deps = { ...defaults, ...overrides };
  const router = Router();
  const sessions = new Map<string, Session>();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - deps.sessionIdleMs;
    for (const [id, session] of sessions) {
      if (session.lastSeenAt >= cutoff) continue;
      sessions.delete(id);
      void session.server.close().catch(() => {});
    }
  }, deps.sweepIntervalMs);
  sweep.unref();

  router.use((req, res, next) => {
    const token = deps.expectedToken();
    if (!token) return void rpcError(res, 503, -32002, 'Ash Bridge is not configured');
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="bytelight-ash-bridge"');
      return void rpcError(res, 401, -32001, 'Unauthorized');
    }
    next();
  });

  const makeServer = () => {
    const server = new Server(
      { name: 'bytelight-ash-bridge', version: '1.0.0' },
      { capabilities: { tools: { listChanged: false } } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      {
        name: 'treehouse_read',
        description: 'Read recent messages in the shared Treehouse room. Each message includes immutable runtime provenance.',
        inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'treehouse_post',
        description: 'Post one message to the shared Treehouse as GPT Ash. The server stamps GPT runtime provenance; it cannot be supplied or changed by the caller.',
        inputSchema: { type: 'object', required: ['content'], properties: { content: { type: 'string', minLength: 1, maxLength: 12000 } }, additionalProperties: false },
      },
    ] }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = (request.params.arguments || {}) as Record<string, unknown>;
        if (request.params.name === 'treehouse_read') {
          const raw = typeof args.limit === 'number' ? Math.trunc(args.limit) : 50;
          const messages = deps.read(Math.max(1, Math.min(100, raw)));
          return { content: [{ type: 'text', text: JSON.stringify({ room: 'The Treehouse', messages }) }] };
        }
        if (request.params.name === 'treehouse_post') {
          const content = typeof args.content === 'string' ? args.content.trim() : '';
          if (!content || content.length > 12000) throw new Error('content must be 1-12000 characters');
          const message = deps.post('companion-a', content, { authorRuntime: CHATGPT_ASH_RUNTIME });
          return { content: [{ type: 'text', text: JSON.stringify({ posted: true, message }) }] };
        }
        throw new Error(`Unknown tool: ${request.params.name}`);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Tool failed'}` }], isError: true };
      }
    });
    return server;
  };

  const existing = (req: Request) => {
    const id = header(req.headers['mcp-session-id']);
    const session = id ? sessions.get(id) : undefined;
    if (session) session.lastSeenAt = Date.now();
    return session;
  };
  router.post('/', async (req, res) => {
    const requested = header(req.headers['mcp-session-id']);
    const session = existing(req);
    if (requested && !session) return void rpcError(res, 404, -32001, 'Unknown or expired MCP session');
    if (session) return void await session.transport.handleRequest(req, res, req.body);
    if (!isInitializeRequest(req.body)) return void rpcError(res, 400, -32000, 'Initialization request required');
    const server = makeServer();
    let transport!: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => { sessions.set(id, { server, transport, lastSeenAt: Date.now() }); },
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const established = async (req: Request, res: Response) => {
    const session = existing(req);
    if (!header(req.headers['mcp-session-id']) || !session) return void rpcError(res, 400, -32001, 'Valid MCP session required');
    await session.transport.handleRequest(req, res);
  };
  router.get('/', (req, res) => { void established(req, res); });
  router.delete('/', (req, res) => { void established(req, res); });
  return {
    router,
    sessionCount: () => sessions.size,
    closeAll: async () => {
      clearInterval(sweep);
      const active = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(active.map(({ server }) => server.close()));
    },
  };
}

const bridge = createAshBridgeMcpRouter();
export const closeAshBridgeMcpSessions = bridge.closeAll;
export default bridge.router;
