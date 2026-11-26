import { getDb } from './init.js';

// ─── Managed MCP servers ────────────────────────────────────────
// Ported from the upstream fork's services/db/mcp-servers.ts, Apache 2.0 —
// adapted to byte-light's monolithic db.ts (NAMED ADAPTATION #3).

export interface McpServerRow {
  id: number;
  name: string;
  url: string;
  api_key: string | null;
  enabled: number;
  tools_cache: string | null;
  last_discovered: string | null;
  created_at: string;
}

export function listMcpServers(): McpServerRow[] {
  return getDb().prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as McpServerRow[];
}

export function getMcpServer(id: number): McpServerRow | null {
  return (getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow | undefined) ?? null;
}

export function addMcpServer(name: string, url: string, apiKey?: string): McpServerRow {
  const stmt = getDb().prepare('INSERT INTO mcp_servers (name, url, api_key) VALUES (?, ?, ?)');
  const result = stmt.run(name, url, apiKey ?? null);
  return getMcpServer(result.lastInsertRowid as number)!;
}

export function upsertMcpServer(name: string, url: string, apiKey?: string): McpServerRow {
  const existing = getDb().prepare('SELECT * FROM mcp_servers WHERE lower(name) = lower(?) LIMIT 1').get(name) as McpServerRow | undefined;
  if (!existing) return addMcpServer(name, url, apiKey);
  if (existing.url === url && existing.api_key === (apiKey ?? null) && existing.enabled === 1) return existing;
  getDb().prepare(`
    UPDATE mcp_servers
    SET url = ?, api_key = ?, enabled = 1, tools_cache = NULL, last_discovered = NULL
    WHERE id = ?
  `).run(url, apiKey ?? null, existing.id);
  return getMcpServer(existing.id)!;
}

export function deleteMcpServer(id: number): boolean {
  const result = getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  return result.changes > 0;
}

export function setMcpServerEnabled(id: number, enabled: boolean): boolean {
  const result = getDb().prepare('UPDATE mcp_servers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function updateMcpServerToolsCache(id: number, toolsJson: string, discoveredAt: string): void {
  getDb().prepare('UPDATE mcp_servers SET tools_cache = ?, last_discovered = ? WHERE id = ?').run(toolsJson, discoveredAt, id);
}
