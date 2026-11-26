import { Router } from 'express';
import { neuralisConfigured, neuralisKey, neuralisUrl, syncNeuralisManagedServer } from '../services/neuralis.js';
import { errMessage } from '../util/errors.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PROXY_BODY_BYTES = 2 * 1024 * 1024;

function cachedToolCount(raw: string | null): number {
  if (!raw) return 0;
  try {
    const tools = JSON.parse(raw);
    return Array.isArray(tools) ? tools.length : 0;
  } catch {
    return 0;
  }
}

function upstreamUrl(path: string, query: string): string {
  const clean = path.replace(/^\/+/, '');
  if (!/^[a-zA-Z0-9/_-]*$/.test(clean)) throw new Error('Invalid Neuralis path');
  return `${neuralisUrl()}/api/${clean}${query}`;
}

export function createNeuralisRoutes(): Router {
  const router = Router();

  router.get('/neuralis/status', async (_req, res) => {
    if (!neuralisConfigured()) {
      res.json({ configured: false, online: false, runtimeFamily: 'bl', runtimeTag: 'bl:phone' });
      return;
    }

    const managed = syncNeuralisManagedServer();
    try {
      const health = await fetch(`${neuralisUrl()}/health`, { signal: AbortSignal.timeout(5000) });
      res.json({
        configured: true,
        online: health.ok,
        runtimeFamily: 'bl',
        runtimeTag: 'bl:phone',
        mcp: managed ? { enabled: Boolean(managed.enabled), toolCount: cachedToolCount(managed.tools_cache) } : null,
      });
    } catch (error) {
      res.json({ configured: true, online: false, runtimeFamily: 'bl', runtimeTag: 'bl:phone', error: errMessage(error) });
    }
  });

  // Authenticated same-origin proxy. The phone never receives the worker key;
  // the worker sees an immutable BL-family door and records it in provenance.
  router.use('/neuralis', async (req, res) => {
    if (!neuralisConfigured()) {
      res.status(503).json({ error: 'Neuralis is not configured' });
      return;
    }

    try {
      let body: string | undefined;
      if (METHODS_WITH_BODY.has(req.method) && req.body !== undefined) {
        body = JSON.stringify(req.body);
        if (Buffer.byteLength(body) > MAX_PROXY_BODY_BYTES) {
          res.status(413).json({ error: 'Neuralis request is too large' });
          return;
        }
      }

      const upstream = await fetch(upstreamUrl(req.path, req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), {
        method: req.method,
        headers: {
          Authorization: `Bearer ${neuralisKey()}`,
          'X-Neuralis-Runtime': 'bl:phone',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal: AbortSignal.timeout(65_000),
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      res.send(bytes);
    } catch (error) {
      res.status(502).json({ error: errMessage(error) });
    }
  });

  return router;
}
