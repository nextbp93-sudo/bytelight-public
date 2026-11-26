/**
 * Imported conversation history: the brain's side of the import door.
 *
 * Mounted on the authenticated /api dispatcher as /api/history/*, so only a
 * caller holding the brain key reaches it (the house's VM importer, or the
 * house's own relay). Routes:
 *
 *   GET  ready            — is the passage store installed
 *   POST batch            — up to 8 passages of one chat, idempotent
 *   POST conversation     — one conversation row (title + summary), idempotent
 *   POST search           — keyword search over passages, newest first
 *   GET  moment/<id>      — one passage with up to two neighbours either side
 *   GET  passages         — stored passages in pages, for an index built
 *                           elsewhere (?after=<cursor>&limit=<n>&voice=<slug>)
 *
 * Provenance: the batch/search/moment handlers are taken from the
 * review/conversation-import branch (byte-light, review/brain-history/
 * history.ts). Adaptations, each for a reason:
 *   - `voice` on every passage and conversation row (migration 0017), so
 *     recall can keep one companion's history out of another's turns.
 *   - `conversation` route added: the export's own summary lands as a normal
 *     cortex conversation, which recall (cortex/recall-merge.ts) already
 *     surfaces. A repeat is ignored and is not embedded twice.
 *   - Sizes are named constants; the store is injected for tests.
 *
 * Nothing here calls a model. The only outside call is one summary
 * embedding per NEW conversation row.
 */

export interface HistoryDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all(): Promise<{ results: Record<string, unknown>[] }>;
      first(): Promise<Record<string, unknown> | null>;
    };
  };
}

export interface HistoryDeps {
  db: HistoryDb;
  /** Embed a summary and store it under `vectorId`. Absent in tests. */
  indexConversation?: (vectorId: string, text: string, metadata: Record<string, string>) => Promise<void>;
}

/** Most passages one batch may carry. 8 rows x 10 values stays under D1's 100 bound parameters. */
export const MAX_BATCH_LINES = 8;
/** Request body ceiling for one batch. */
export const MAX_BODY_BYTES = 100_000;
/** One message's text ceiling. Longer is refused, never cut. */
export const MAX_MESSAGE_CHARS = 60_000;
const MAX_TITLE = 300;
const MAX_SUMMARY = 20_000;
const SEARCH_LIMIT = 30;
/** Passages per page from GET passages. */
export const PASSAGE_PAGE_DEFAULT = 200;
export const PASSAGE_PAGE_MAX = 500;

const SOURCES = ["chatgpt", "claude"] as const;
const idOk = (x: unknown): x is string => typeof x === "string" && /^[\w-]{1,128}$/.test(x);
const voiceOk = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x);
const isoOk = (x: unknown) => x === null || (typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x)));
const MOMENT = /^(chatgpt|claude):[\w-]{1,128}:[\w-]{1,128}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : json({ error: "Invalid request" }, 400);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
}

/** The conversation row id for an imported chat: "<source>-<chat id>". */
export function importedConversationId(source: string, chat: string): string {
  return `${source}-${chat}`;
}

export async function history(request: Request, deps: HistoryDeps, parts: string[]): Promise<Response> {
  const { db } = deps;
  const method = request.method;

  if (method === "GET" && parts.length === 1 && parts[0] === "ready") {
    await db.prepare("SELECT id FROM history_passages WHERE id = ?").bind("").first();
    return json({ version: 2, mode: "archive", voices: true });
  }

  if (method === "GET" && parts.length === 2 && parts[0] === "moment") {
    let id: string;
    try { id = decodeURIComponent(parts[1]); } catch { return json({ error: "Invalid reference" }, 400); }
    if (!MOMENT.test(id)) return json({ error: "Invalid reference" }, 400);
    const row = await db.prepare("SELECT * FROM history_passages WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "Moment not found" }, 404);
    const rows = [row];
    // Follow the real links, never neighbouring timestamps, so a reply from
    // another branch can't be spliced in.
    for (let i = 0; i < 2 && rows[0].prev; i++) {
      const p = await db.prepare("SELECT * FROM history_passages WHERE id = ?").bind(rows[0].prev).first();
      if (!p || rows.some((r) => r.id === p.id)) break;
      rows.unshift(p);
    }
    for (let i = 0; i < 2; i++) {
      const next = await db.prepare("SELECT * FROM history_passages WHERE prev = ? LIMIT 2").bind(rows[rows.length - 1].id).all();
      if (next.results.length !== 1 || rows.some((r) => r.id === next.results[0].id)) break;
      rows.push(next.results[0]);
    }
    return json({ focus: row.id, rows });
  }

  // Stored passages in insertion order, a page at a time, so the house can
  // build its own search index from the brain and rebuild it anywhere. The
  // cursor is SQLite's rowid: it only grows, so a later import is picked up
  // by asking for everything after the last cursor seen.
  if (method === "GET" && parts.length === 1 && parts[0] === "passages") {
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? 0);
    const rawLimit = Number(url.searchParams.get("limit") ?? PASSAGE_PAGE_DEFAULT);
    const voice = url.searchParams.get("voice");
    if (!Number.isSafeInteger(after) || after < 0) return json({ error: "Invalid cursor" }, 400);
    if (voice !== null && !voiceOk(voice)) return json({ error: "Invalid voice" }, 400);
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, PASSAGE_PAGE_MAX) : PASSAGE_PAGE_DEFAULT;
    const page = await db.prepare(
      `SELECT rowid AS cursor, id, source, chat, title, voice, pos, role, at, body FROM history_passages
        WHERE rowid > ? AND (? IS NULL OR voice = ?)
        ORDER BY rowid LIMIT ?`,
    ).bind(after, voice, voice, limit).all();
    const rows = page.results;
    const next = rows.length ? rows[rows.length - 1].cursor : after;
    return json({ rows, next, done: rows.length < limit });
  }

  if (method !== "POST" || parts.length !== 1) return json({ error: "Unknown history operation" }, 404);
  const op = parts[0];
  if (!["batch", "search", "conversation"].includes(op)) return json({ error: "Unknown history operation" }, 404);
  const b = await readBody(request);
  if (b instanceof Response) return b;

  if (op === "search") {
    const query = b.query;
    if (typeof query !== "string" || !query.trim() || query.length > 180) return json({ error: "Enter 1–180 characters" }, 400);
    const pattern = "%" + query.trim().toLowerCase().replace(/[!%_]/g, (m) => "!" + m) + "%";
    const voice = voiceOk(b.voice) ? b.voice : null;
    const found = await db.prepare(
      `SELECT id, title, role, at, voice, substr(body, 1, 220) AS excerpt FROM history_passages
        WHERE (lower(body) LIKE ? ESCAPE '!' OR lower(title) LIKE ? ESCAPE '!')
          AND (? IS NULL OR voice = ?)
        ORDER BY at DESC, id LIMIT ${SEARCH_LIMIT}`,
    ).bind(pattern, pattern, voice, voice).all();
    return json({ rows: found.results });
  }

  if (!SOURCES.includes(b.source as (typeof SOURCES)[number]) || !idOk(b.chat) || !voiceOk(b.voice) ||
      typeof b.title !== "string" || !b.title.trim() || b.title.length > MAX_TITLE) {
    return json({ error: "Invalid source, chat, voice or title" }, 400);
  }
  const source = b.source as string;
  const chat = b.chat as string;
  const voice = b.voice as string;
  const title = (b.title as string).trim();

  if (op === "conversation") {
    const summary = typeof b.summary === "string" ? b.summary.trim() : "";
    if (!summary || summary.length > MAX_SUMMARY) return json({ error: "A summary of 1–20000 characters is required" }, 400);
    if (!isoOk(b.started_at ?? null) || !isoOk(b.ended_at ?? null)) return json({ error: "Invalid dates" }, 400);
    const count = Number.isSafeInteger(b.message_count) && (b.message_count as number) >= 0 ? b.message_count : 0;
    const id = importedConversationId(source, chat);
    const exists = await db.prepare("SELECT id FROM cortex_conversations WHERE id = ?").bind(id).first();
    if (exists) return json({ id, created: false });
    await db.prepare(
      `INSERT OR IGNORE INTO cortex_conversations
         (id, source, title, summary, domain, importance, message_count, started_at, ended_at, voice)
       VALUES (?, ?, ?, ?, ?, 'routine', ?, ?, ?, ?)`,
    ).bind(
      id, source === "claude" ? "claude-web" : "chatgpt", title, summary, "imported-history",
      count, (b.started_at as string | null) ?? null, (b.ended_at as string | null) ?? null, voice,
    ).run();
    if (deps.indexConversation) {
      await deps.indexConversation(`conv-${id}`, `${title}: ${summary} [imported-history]`, {
        source: "cortex",
        type: "conversation",
        domain: "imported-history",
        voice,
        title: title.slice(0, 100),
        added_at: new Date().toISOString(),
      });
    }
    return json({ id, created: true });
  }

  // op === "batch"
  const lines = b.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_BATCH_LINES) return json({ error: "Invalid batch" }, 400);
  const values: unknown[] = [];
  const prefix = `${source}:${chat}:`;
  for (const m of lines as Record<string, unknown>[]) {
    if (!m || !idOk(m.id) || !Number.isSafeInteger(m.pos) || (m.pos as number) < 0 || (m.pos as number) > 1_000_000 ||
        !["assistant", "user"].includes(m.role as string) || typeof m.text !== "string" || !m.text.trim() ||
        m.text.length > MAX_MESSAGE_CHARS || !isoOk(m.at ?? null)) {
      return json({ error: "Invalid passage" }, 400);
    }
    if (!(m.prev === null || m.prev === undefined || idOk(m.prev)) || m.id === m.prev) return json({ error: "Invalid source edge" }, 400);
    values.push(prefix + m.id, source, chat, title, voice, m.pos, m.role, m.at ?? null, m.text, m.prev ? prefix + m.prev : null);
  }
  // One statement per batch; a repeat keeps the first copy.
  await db.prepare(
    `INSERT INTO history_passages (id, source, chat, title, voice, pos, role, at, body, prev) VALUES ${
      lines.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")
    } ON CONFLICT (id) DO NOTHING`,
  ).bind(...values).run();
  return json({ accepted: lines.length });
}
