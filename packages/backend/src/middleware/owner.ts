import { type Request } from 'express';
import { createHash } from 'node:crypto';
import { parse } from 'cookie';
import { getWebSession } from '../services/db.js';
import { getCookieName } from '../middleware/auth.js';

export interface BuilderOwner {
  audience: 'owner';
  thread: string;
  session: string;
}

function requireHttpsOrigin(req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (!isHttps) throw new Error('HTTPS origin required');
  const originHeader = req.headers.origin;
  if (typeof originHeader !== 'string' || !originHeader) throw new Error('Origin header required');
  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    throw new Error('Invalid Origin header');
  }
  const hostHeader = (req.headers['x-forwarded-host'] ?? req.headers.host ?? '') as string;
  const expectedHost = hostHeader.split(',')[0]?.trim().toLowerCase();
  if (originUrl.protocol !== 'https:' || !expectedHost || originUrl.host.toLowerCase() !== expectedHost) {
    throw new Error('Cross-origin mutation denied');
  }
}

export function createWebRestOwner(deps = { session: getWebSession }) {
  return function owner(req: Request): BuilderOwner {
    // The shared auth middleware deliberately allows passwordless local apps.
    // Owner REST requires an actual owner session even in that configuration.
    const token = parse(req.headers.cookie || '')[getCookieName()];
    if (!token) throw new Error("Owner session required");
    const session = deps.session(token);
    if (!session || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) throw new Error('Owner session required');
    if (req.method !== 'GET') {
      requireHttpsOrigin(req);
    }
    return { audience: 'owner', thread: 'owner-web', session: createHash('sha256').update(token).digest('hex') };
  };
}

export const webRestOwner = createWebRestOwner();
