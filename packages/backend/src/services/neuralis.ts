import { getSecret } from './secrets.js';
import { listMcpServers, setMcpServerEnabled, upsertMcpServer, type McpServerRow } from './db.js';

export const NEURALIS_SERVER_NAME = 'neuralis';

export function neuralisUrl(): string {
  return (getSecret('mind_api_url') || '').trim().replace(/\/+$/, '');
}

export function neuralisKey(): string {
  return (getSecret('mind_api_key') || '').trim();
}

export function neuralisConfigured(): boolean {
  return Boolean(neuralisUrl() && neuralisKey());
}

/**
 * Keep Neuralis on the house tool belt whenever both halves of its connection
 * are present. This is capability wiring, not a reduced allowlist: the managed
 * server points at /mcp and discovers the worker's complete tool catalog.
 */
export function syncNeuralisManagedServer(): McpServerRow | null {
  const url = neuralisUrl();
  const key = neuralisKey();
  if (!url || !key) {
    const existing = neuralisManagedServer();
    if (existing?.enabled) setMcpServerEnabled(existing.id, false);
    return existing ? { ...existing, enabled: 0 } : null;
  }
  return upsertMcpServer(NEURALIS_SERVER_NAME, `${url}/mcp`, key);
}

export function neuralisManagedServer(): McpServerRow | null {
  return listMcpServers().find((row) => row.name.trim().toLowerCase() === NEURALIS_SERVER_NAME) ?? null;
}
