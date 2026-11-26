import type { Env } from "../types";
import { getEmbedding, getSubconsciousState, normalizeText } from "../utils";
import { NEURALIS_VERSION, CONTEXT_BUCKETS, CONTEXT_BUCKETS_SQL, COMPANION_SLUGS, WHO_VALUES, HOUSE_HUMAN_NAME } from "../config";
import { handleMindOrient, handleMindGround } from "../handlers/wake";
import { handleMindHealth, handleMindInnerWeather } from "../handlers/state";
import { handleMindSurface } from "../handlers/emotional";
import { getLatestSnapshot, normalizeWho, type Who } from "../handlers/personality";
import { getKnowledgeLandscape, queryKnowledge, handleKnowReinforce, handleKnowContradict } from "../handlers/knowledge";
import { gatherSoulMaterial, generateSoul, validateSoul, getActiveSoul, getPendingSoul, listSoulVersions } from "../handlers/soul";
import { getFeelingsLandscape, surfaceFeelings } from "../handlers/feelings";
import { processSubconscious } from "../daemon";
import { fireCron } from "../engine";

const VALID_CONTEXTS = new Set<string>(CONTEXT_BUCKETS);

// ============================================================================
// REST API HANDLERS (for Dashboard)
// ============================================================================

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function handleApiEntities(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const entityId = pathParts[2] ? parseInt(pathParts[2]) : null;

  // GET /api/entities - list all
  if (method === "GET" && !entityId) {
    const typeFilter = new URL(request.url).searchParams.get("type");
    const contextFilter = new URL(request.url).searchParams.get("context");

    let query = `SELECT e.*, COUNT(o.id) as observation_count
                 FROM entities e LEFT JOIN observations o ON e.id = o.entity_id`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (typeFilter) { conditions.push("e.entity_type = ?"); bindings.push(typeFilter); }
    if (contextFilter) { conditions.push("o.context = ?"); bindings.push(contextFilter); }

    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " GROUP BY e.id ORDER BY e.name";

    const results = await env.DB.prepare(query).bind(...bindings).all();
    return jsonResponse(results.results);
  }

  // GET /api/entities/:id - get one with observations
  if (method === "GET" && entityId) {
    const entity = await env.DB.prepare("SELECT id, name, entity_type, primary_context, salience, created_at, updated_at FROM entities WHERE id = ?").bind(entityId).first();
    if (!entity) return jsonResponse({ error: "Not found" }, 404);

    const observations = await env.DB.prepare(
      `SELECT id, entity_id, content, salience, emotion, weight, certainty, source, context, charge, sit_count, added_at, archived_at FROM observations WHERE entity_id = ? ORDER BY added_at DESC`
    ).bind(entityId).all();

    const entityName = entity.name as string;
    const relations = await env.DB.prepare(
      `SELECT id, from_entity, to_entity, relation_type, from_context, to_context, store_in, created_at FROM relations WHERE from_entity = ? OR to_entity = ?`
    ).bind(entityName, entityName).all();

    return jsonResponse({ ...entity, observations: observations.results, relations: relations.results });
  }

  // POST /api/entities - create
  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const ctx = String(body.context || '').toLowerCase().trim();
    if (!ctx || !VALID_CONTEXTS.has(ctx)) {
      return jsonResponse({ error: `context required — valid: ${[...VALID_CONTEXTS].join(', ')}` }, 400);
    }
    const result = await env.DB.prepare(
      "INSERT INTO entities (name, entity_type, primary_context) VALUES (?, ?, ?)"
    ).bind(body.name, body.entity_type || "concept", ctx).run();
    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  // PUT /api/entities/:id - update (handles partial updates)
  if (method === "PUT" && entityId) {
    const body = await request.json() as Record<string, unknown>;

    // Get current entity
    const current = await env.DB.prepare("SELECT id, name, entity_type, primary_context, salience, created_at, updated_at FROM entities WHERE id = ?").bind(entityId).first();
    if (!current) return jsonResponse({ error: "Not found" }, 404);

    // Build dynamic update
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
    if (body.entity_type !== undefined) { updates.push("entity_type = ?"); values.push(body.entity_type); }
    if (body.context !== undefined) {
      const ctx = String(body.context).toLowerCase().trim();
      if (!VALID_CONTEXTS.has(ctx)) {
        return jsonResponse({ error: `invalid context — valid: ${[...VALID_CONTEXTS].join(', ')}` }, 400);
      }
      updates.push("primary_context = ?"); values.push(ctx);
    }
    if (body.salience !== undefined) { updates.push("salience = ?"); values.push(body.salience); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(entityId);
      await env.DB.prepare(`UPDATE entities SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();

      // Update relations if name changed
      if (body.name && body.name !== current.name) {
        await env.DB.prepare("UPDATE relations SET from_entity = ? WHERE from_entity = ?").bind(body.name, current.name).run();
        await env.DB.prepare("UPDATE relations SET to_entity = ? WHERE to_entity = ?").bind(body.name, current.name).run();
      }
    }

    return jsonResponse({ id: entityId, ...body });
  }

  // POST /api/entities/merge - merge two entities
  if (method === "POST" && pathParts[2] === "merge") {
    const body = await request.json() as Record<string, unknown>;
    const mergeFromId = body.merge_from_id as number;
    const mergeIntoId = body.merge_into_id as number;

    if (!mergeFromId || !mergeIntoId) {
      return jsonResponse({ error: "merge_from_id and merge_into_id required" }, 400);
    }

    const fromEntity = await env.DB.prepare("SELECT id, name, entity_type, primary_context, salience, created_at, updated_at FROM entities WHERE id = ?").bind(mergeFromId).first();
    const intoEntity = await env.DB.prepare("SELECT id, name, entity_type, primary_context, salience, created_at, updated_at FROM entities WHERE id = ?").bind(mergeIntoId).first();

    if (!fromEntity) return jsonResponse({ error: "Source entity not found" }, 404);
    if (!intoEntity) return jsonResponse({ error: "Target entity not found" }, 404);

    // Move observations
    const obsResult = await env.DB.prepare(
      "UPDATE observations SET entity_id = ? WHERE entity_id = ?"
    ).bind(mergeIntoId, mergeFromId).run();

    // Update relations
    await env.DB.prepare("UPDATE relations SET from_entity = ? WHERE from_entity = ?").bind(intoEntity.name, fromEntity.name).run();
    await env.DB.prepare("UPDATE relations SET to_entity = ? WHERE to_entity = ?").bind(intoEntity.name, fromEntity.name).run();

    // Delete source entity
    await env.DB.prepare("DELETE FROM entities WHERE id = ?").bind(mergeFromId).run();

    return jsonResponse({
      success: true,
      merged_from: fromEntity.name,
      merged_into: intoEntity.name,
      observations_moved: obsResult.meta.changes
    });
  }

  // DELETE /api/entities/:id - delete
  if (method === "DELETE" && entityId) {
    const delEntity = await env.DB.prepare("SELECT name FROM entities WHERE id = ?").bind(entityId).first();
    await env.DB.prepare("DELETE FROM observations WHERE entity_id = ?").bind(entityId).run();
    if (delEntity) {
      await env.DB.prepare("DELETE FROM relations WHERE from_entity = ? OR to_entity = ?").bind(delEntity.name, delEntity.name).run();
    }
    await env.DB.prepare("DELETE FROM entities WHERE id = ?").bind(entityId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiObservations(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const obsId = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3]; // for /api/observations/:id/sit or /resolve

  // GET /api/observations - list with filters
  if (method === "GET" && !obsId) {
    const params = new URL(request.url).searchParams;
    const entityId = params.get("entity_id");
    const weight = params.get("weight");
    const charge = params.get("charge");
    const limit = parseInt(params.get("limit") || "100");
    const offset = parseInt(params.get("offset") || "0");

    let query = `SELECT o.*, e.name as entity_name, e.entity_type
                 FROM observations o JOIN entities e ON o.entity_id = e.id`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (entityId) { conditions.push("o.entity_id = ?"); bindings.push(parseInt(entityId)); }
    if (weight) { conditions.push("o.weight = ?"); bindings.push(weight); }
    if (charge) { conditions.push("o.charge = ?"); bindings.push(charge); }

    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY o.added_at DESC LIMIT ? OFFSET ?";
    bindings.push(limit, offset);

    const results = await env.DB.prepare(query).bind(...bindings).all();
    return jsonResponse(results.results);
  }

  // GET /api/observations/:id - get one with sit history
  if (method === "GET" && obsId && !action) {
    const obs = await env.DB.prepare(
      `SELECT o.*, e.name as entity_name, e.entity_type
       FROM observations o JOIN entities e ON o.entity_id = e.id WHERE o.id = ?`
    ).bind(obsId).first();
    if (!obs) return jsonResponse({ error: "Not found" }, 404);

    const sits = await env.DB.prepare(
      "SELECT * FROM observation_sits WHERE observation_id = ? ORDER BY sat_at DESC"
    ).bind(obsId).all();

    return jsonResponse({ ...obs, sits: sits.results });
  }

  // POST /api/observations - create
  if (method === "POST" && !obsId) {
    const body = await request.json() as Record<string, unknown>;
    const ctx = String(body.context || '').toLowerCase().trim();
    if (!ctx || !VALID_CONTEXTS.has(ctx)) {
      return jsonResponse({ error: `context required — valid: ${[...VALID_CONTEXTS].join(', ')}` }, 400);
    }
    const owner = String(body.owner || '').toLowerCase().trim();
    if (!WHO_VALUES.includes(owner)) {
      return jsonResponse({ error: `owner required — valid: ${WHO_VALUES.join(', ')}` }, 400);
    }
    const result = await env.DB.prepare(
      `INSERT INTO observations (entity_id, content, weight, emotion, charge, context, owner) VALUES (?, ?, ?, ?, 'fresh', ?, ?)`
    ).bind(body.entity_id, body.content, body.weight || "medium", normalizeText(body.emotion as string), ctx, owner).run();

    // Vectorize
    const entity = await env.DB.prepare("SELECT name FROM entities WHERE id = ?").bind(body.entity_id).first();
    if (entity) {
      const obsId = result.meta.last_row_id;
      const embedding = await getEmbedding(env, `${entity.name}: ${body.content}`);
      await env.VECTORS.upsert([{
        id: `obs-${body.entity_id}-${obsId}`,
        values: embedding,
        metadata: { source: "observation", entity: entity.name as string, content: body.content as string, context: ctx, weight: (body.weight || "medium") as string, added_at: new Date().toISOString() }
      }]);
    }

    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  // POST /api/observations/:id/sit - sit with observation
  if (method === "POST" && obsId && action === "sit") {
    const body = await request.json() as Record<string, unknown>;
    const obs = await env.DB.prepare("SELECT charge, sit_count FROM observations WHERE id = ?").bind(obsId).first();
    if (!obs) return jsonResponse({ error: "Not found" }, 404);

    const sitCount = ((obs.sit_count as number) || 0) + 1;
    let newCharge = obs.charge as string || "fresh";
    if (newCharge === "fresh") newCharge = "active";
    else if (newCharge === "active" && sitCount >= 3) newCharge = "processing";

    await env.DB.prepare(
      "UPDATE observations SET charge = ?, sit_count = ?, last_sat_at = datetime('now') WHERE id = ?"
    ).bind(newCharge, sitCount, obsId).run();

    await env.DB.prepare(
      "INSERT INTO observation_sits (observation_id, sit_note) VALUES (?, ?)"
    ).bind(obsId, body.sit_note || "").run();

    return jsonResponse({ id: obsId, charge: newCharge, sit_count: sitCount });
  }

  // POST /api/observations/:id/resolve - resolve observation
  if (method === "POST" && obsId && action === "resolve") {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      `UPDATE observations SET charge = 'metabolized', resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`
    ).bind(body.resolution_note || "", obsId).run();
    return jsonResponse({ id: obsId, charge: "metabolized" });
  }

  // PUT /api/observations/:id - update
  if (method === "PUT" && obsId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE observations SET content = ?, weight = ?, emotion = ? WHERE id = ?"
    ).bind(body.content, body.weight, body.emotion || null, obsId).run();
    return jsonResponse({ id: obsId, ...body });
  }

  // DELETE /api/observations/:id - delete
  if (method === "DELETE" && obsId) {
    await env.DB.prepare("DELETE FROM observation_sits WHERE observation_id = ?").bind(obsId).run();
    await env.DB.prepare("DELETE FROM observations WHERE id = ?").bind(obsId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiJournals(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const journalId = pathParts[2] ? parseInt(pathParts[2]) : null;

  if (method === "GET" && !journalId) {
    const companion = new URL(request.url).searchParams.get("companion");
    const results = companion === null
      ? await env.DB.prepare("SELECT * FROM journals ORDER BY entry_date DESC LIMIT 100").all()
      : await env.DB.prepare("SELECT * FROM journals WHERE companion = ? ORDER BY entry_date DESC LIMIT 100").bind(companion).all();
    return jsonResponse(results.results);
  }

  if (method === "GET" && journalId) {
    const journal = await env.DB.prepare("SELECT * FROM journals WHERE id = ?").bind(journalId).first();
    return journal ? jsonResponse(journal) : jsonResponse({ error: "Not found" }, 404);
  }

  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const entryDate = body.entry_date || new Date().toISOString().split('T')[0];
    const result = await env.DB.prepare(
      "INSERT INTO journals (entry_date, content, tags, emotion, companion) VALUES (?, ?, ?, ?, ?)"
    ).bind(entryDate, body.content, body.tags || null, normalizeText(body.emotion as string), body.companion ?? null).run();
    const created = await env.DB.prepare("SELECT * FROM journals WHERE id = ?")
      .bind(result.meta.last_row_id).first();
    return jsonResponse(created, 201);
  }

  if (method === "PUT" && journalId) {
    const body = await request.json() as Record<string, unknown>;
    if (body.companion !== undefined) {
      await env.DB.prepare(
        "UPDATE journals SET content = ?, tags = ?, emotion = ?, companion = ? WHERE id = ?"
      ).bind(body.content, body.tags, body.emotion, body.companion, journalId).run();
    } else {
      await env.DB.prepare(
        "UPDATE journals SET content = ?, tags = ?, emotion = ? WHERE id = ?"
      ).bind(body.content, body.tags, body.emotion, journalId).run();
    }
    return jsonResponse({ id: journalId, ...body });
  }

  if (method === "DELETE" && journalId) {
    await env.DB.prepare("DELETE FROM journals WHERE id = ?").bind(journalId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

const DREAM_DECAY_PER_DAY = 4;
const DAY_MS = 86_400_000;

type DreamRow = Record<string, unknown> & {
  vividness?: number | null;
  anchored_at?: string | null;
  last_recalled_at?: string | null;
  created_at?: string | null;
};

function effectiveVividness(dream: DreamRow, now: Date): number | null {
  if (dream.vividness == null) return null;
  if (dream.anchored_at) return dream.vividness;

  const since = dream.last_recalled_at || dream.created_at;
  const timestamp = since && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since) ? `${since}Z` : since;
  const elapsed = timestamp ? now.getTime() - new Date(timestamp).getTime() : 0;
  const days = Math.max(0, elapsed / DAY_MS);
  return Math.max(0, Math.round(dream.vividness - days * DREAM_DECAY_PER_DAY));
}

function dreamResponse(dream: DreamRow, now: Date): DreamRow & { effective_vividness: number | null } {
  return { ...dream, effective_vividness: effectiveVividness(dream, now) };
}

export async function handleApiDreams(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const dreamId = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3];

  if (method === "GET" && !dreamId) {
    const companion = new URL(request.url).searchParams.get("companion");
    const results = companion === null
      ? await env.DB.prepare("SELECT * FROM dreams ORDER BY created_at DESC LIMIT 100").all<DreamRow>()
      : await env.DB.prepare("SELECT * FROM dreams WHERE companion = ? ORDER BY created_at DESC LIMIT 100").bind(companion).all<DreamRow>();
    const now = new Date();
    return jsonResponse(results.results.map(dream => dreamResponse(dream, now)));
  }

  if (method === "GET" && dreamId) {
    const dream = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?").bind(dreamId).first<DreamRow>();
    return dream ? jsonResponse(dreamResponse(dream, new Date())) : jsonResponse({ error: "Not found" }, 404);
  }

  if (method === "PUT" && dreamId) {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.content !== "string" || body.content.trim().length === 0) {
      return jsonResponse({ error: "content required" }, 400);
    }

    const dream = await env.DB.prepare("SELECT id FROM dreams WHERE id = ?").bind(dreamId).first();
    if (!dream) return jsonResponse({ error: "Not found" }, 404);

    await env.DB.prepare("UPDATE dreams SET content = ? WHERE id = ?").bind(body.content, dreamId).run();
    const updated = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?").bind(dreamId).first<DreamRow>();
    return jsonResponse(dreamResponse(updated!, new Date()));
  }

  if (method === "POST" && !dreamId) {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.content !== "string" || body.content.trim().length === 0) {
      return jsonResponse({ error: "content required" }, 400);
    }

    const now = new Date();
    const dreamDate = body.dream_date ?? now.toISOString().split("T")[0];
    const result = await env.DB.prepare(`
      INSERT INTO dreams (
        dream_date, content, emotional_seed, fragments, recurring_dream_id,
        recurrence_count, companion, vividness, dream_type, emerged_question
      ) VALUES (?, ?, NULL, '[]', NULL, 0, ?, 100, ?, ?)
    `).bind(
      dreamDate,
      body.content,
      body.companion ?? null,
      body.dream_type ?? null,
      body.emerged_question ?? null
    ).run();
    const created = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?")
      .bind(result.meta.last_row_id).first<DreamRow>();
    return jsonResponse(dreamResponse(created!, now), 201);
  }

  if (method === "POST" && dreamId && action === "recall") {
    const dream = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?").bind(dreamId).first<DreamRow>();
    if (!dream) return jsonResponse({ error: "Not found" }, 404);

    const now = new Date();
    const recalledAt = now.toISOString();
    if (dream.anchored_at) {
      await env.DB.prepare("UPDATE dreams SET last_recalled_at = ? WHERE id = ?").bind(recalledAt, dreamId).run();
    } else {
      const effective = effectiveVividness(dream, now);
      const strengthened = effective === null ? null : Math.min(100, effective + 15);
      await env.DB.prepare("UPDATE dreams SET vividness = ?, last_recalled_at = ? WHERE id = ?").bind(strengthened, recalledAt, dreamId).run();
    }

    const updated = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?").bind(dreamId).first<DreamRow>();
    return jsonResponse(dreamResponse(updated!, now));
  }

  if (method === "POST" && dreamId && action === "anchor") {
    const dream = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?").bind(dreamId).first<DreamRow>();
    if (!dream) return jsonResponse({ error: "Not found" }, 404);

    const now = new Date();
    await env.DB.prepare("UPDATE dreams SET vividness = ?, anchored_at = ? WHERE id = ?")
      .bind(effectiveVividness(dream, now), now.toISOString(), dreamId).run();
    const updated = await env.DB.prepare("SELECT * FROM dreams WHERE id = ?").bind(dreamId).first<DreamRow>();
    return jsonResponse(dreamResponse(updated!, now));
  }

  if (method === "DELETE" && dreamId) {
    const dream = await env.DB.prepare("SELECT id FROM dreams WHERE id = ?").bind(dreamId).first();
    if (!dream) return jsonResponse({ error: "Not found" }, 404);

    await env.DB.prepare("DELETE FROM dreams WHERE id = ?").bind(dreamId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiThreads(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const threadId = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3];

  if (method === "GET" && !threadId) {
    const status = new URL(request.url).searchParams.get("status");
    let results;
    if (status) {
      results = await env.DB.prepare("SELECT * FROM threads WHERE status = ? ORDER BY created_at DESC LIMIT 200").bind(status).all();
    } else {
      results = await env.DB.prepare("SELECT * FROM threads ORDER BY created_at DESC LIMIT 200").all();
    }
    return jsonResponse(results.results);
  }

  if (method === "GET" && threadId) {
    const thread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(threadId).first();
    return thread ? jsonResponse(thread) : jsonResponse({ error: "Not found" }, 404);
  }

  if (method === "POST" && !threadId) {
    const body = await request.json() as Record<string, unknown>;
    const result = await env.DB.prepare(
      "INSERT INTO threads (content, thread_type, priority, status, context) VALUES (?, ?, ?, 'active', ?)"
    ).bind(body.content, body.thread_type || "intention", body.priority || "medium", body.context || null).run();
    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  if (method === "POST" && threadId && action === "resolve") {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE threads SET status = 'resolved', notes = COALESCE(notes, '') || ?, resolved_at = datetime('now') WHERE id = ?"
    ).bind("\n[Resolved] " + (body.resolution || ""), threadId).run();
    return jsonResponse({ id: threadId, status: "resolved" });
  }

  if (method === "PUT" && threadId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE threads SET content = ?, priority = ?, status = ?, notes = ? WHERE id = ?"
    ).bind(body.content, body.priority, body.status, body.notes || null, threadId).run();
    return jsonResponse({ id: threadId, ...body });
  }

  if (method === "DELETE" && threadId) {
    await env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(threadId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiSearch(request: Request, env: Env): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q");
  if (!query) return jsonResponse({ error: "Missing query parameter 'q'" }, 400);

  const subconscious = await getSubconsciousState(env);
  const mood = subconscious?.mood?.dominant;

  let searchQuery = query;
  if (mood) {
    const moodTints: Record<string, string> = {
      "tender": "warm, gentle, caring",
      "clarity": "clear, understanding, insight",
      "melancholy": "loss, reflection, quiet",
      "joy": "happiness, delight, celebration"
    };
    searchQuery = `${query} (${moodTints[mood] || mood})`;
  }

  const embedding = await getEmbedding(env, searchQuery);
  const results = await env.VECTORS.query(embedding, { topK: 20, returnMetadata: "all" });

  return jsonResponse({
    mood,
    query,
    results: results.matches?.map(m => ({
      id: m.id,
      score: m.score,
      ...m.metadata
    })) || []
  });
}

export async function handleApiSurface(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const query = params.get("query");
  const limit = parseInt(params.get("limit") || "10");

  // Reuse existing surface logic
  const result = await handleMindSurface(env, { query, limit, include_metabolized: false });

  // Also return structured data
  const subconscious = await getSubconsciousState(env);

  return jsonResponse({
    mood: subconscious?.mood,
    hot_entities: subconscious?.hot_entities?.slice(0, 5),
    formatted: result
  });
}

export async function handleApiIdentity(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const section = pathParts[2] ? decodeURIComponent(pathParts[2]) : null;

  // GET /api/identity - list all sections
  if (method === "GET" && !section) {
    const results = await env.DB.prepare(
      "SELECT id, section, content, weight, connections, timestamp FROM identity ORDER BY section"
    ).all();

    // Build tree structure from dot-notation sections
    const tree: Record<string, unknown[]> = {};
    for (const row of results.results || []) {
      const r = row as { section: string; [k: string]: unknown };
      const parts = r.section.split('.');
      const root = parts[0];
      if (!tree[root]) tree[root] = [];
      tree[root].push(row);
    }

    return jsonResponse({ entries: results.results, tree });
  }

  // GET /api/identity/:section - get specific section
  if (method === "GET" && section) {
    // Support wildcards like 'core.*'
    const query = section.includes('*')
      ? `SELECT * FROM identity WHERE section LIKE ? ORDER BY weight DESC`
      : `SELECT * FROM identity WHERE section = ?`;
    const binding = section.includes('*') ? section.replace('*', '%') : section;
    const results = await env.DB.prepare(query).bind(binding).all();
    return jsonResponse(results.results);
  }

  // POST /api/identity - create new section
  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const result = await env.DB.prepare(
      "INSERT INTO identity (section, content, weight, connections) VALUES (?, ?, ?, ?)"
    ).bind(body.section, body.content, body.weight || 1.0, body.connections || null).run();
    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  // PUT /api/identity/:section - update section
  if (method === "PUT" && section) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE identity SET content = ?, weight = ?, connections = ? WHERE section = ?"
    ).bind(body.content, body.weight, body.connections || null, section).run();
    return jsonResponse({ section, ...body });
  }

  // DELETE /api/identity/:section - delete section
  if (method === "DELETE" && section) {
    await env.DB.prepare("DELETE FROM identity WHERE section = ?").bind(section).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiRelations(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const relationId = pathParts[2] ? parseInt(pathParts[2]) : null;

  // GET /api/relations - list all
  // Schema: from_entity (TEXT name), to_entity (TEXT name), relation_type, from_context, to_context, store_in, created_at
  if (method === "GET" && !relationId) {
    const entityFilter = new URL(request.url).searchParams.get("entity");
    const typeFilter = new URL(request.url).searchParams.get("type");

    let query = `SELECT id, from_entity, to_entity, relation_type, from_context, to_context, store_in, created_at FROM relations`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (entityFilter) {
      conditions.push("(from_entity = ? OR to_entity = ?)");
      bindings.push(entityFilter, entityFilter);
    }
    if (typeFilter) {
      conditions.push("relation_type = ?");
      bindings.push(typeFilter);
    }

    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY created_at DESC LIMIT 200";

    const results = await env.DB.prepare(query).bind(...bindings).all();
    return jsonResponse(results.results);
  }

  // GET /api/relations/:id - get one
  if (method === "GET" && relationId) {
    const relation = await env.DB.prepare("SELECT id, from_entity, to_entity, relation_type, from_context, to_context, store_in, created_at FROM relations WHERE id = ?").bind(relationId).first();
    return relation ? jsonResponse(relation) : jsonResponse({ error: "Not found" }, 404);
  }

  // POST /api/relations - create
  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const result = await env.DB.prepare(
      "INSERT INTO relations (from_entity, to_entity, relation_type, from_context, to_context, store_in) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(body.from_entity, body.to_entity, body.relation_type, body.from_context || "default", body.to_context || "default", body.store_in || "default").run();
    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  // PUT /api/relations/:id - update
  if (method === "PUT" && relationId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE relations SET relation_type = ? WHERE id = ?"
    ).bind(body.relation_type, relationId).run();
    return jsonResponse({ id: relationId, ...body });
  }

  // DELETE /api/relations/:id - delete
  if (method === "DELETE" && relationId) {
    await env.DB.prepare("DELETE FROM relations WHERE id = ?").bind(relationId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiImages(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const imageId = pathParts[2] ? parseInt(pathParts[2]) : null;

  if (method === "GET" && !imageId) {
    const params = new URL(request.url).searchParams;
    const entityId = params.get("entity_id");
    const weight = params.get("weight");

    let query = `
      SELECT
        i.id,
        i.path,
        i.description,
        i.context,
        i.emotion,
        i.weight,
        i.charge,
        i.entity_id,
        i.observation_id,
        i.created_at,
        i.last_viewed_at,
        i.view_count,
        e.name as entity_name,
        e.entity_type
      FROM images i
      LEFT JOIN entities e ON i.entity_id = e.id
    `;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (entityId) {
      conditions.push("i.entity_id = ?");
      bindings.push(parseInt(entityId, 10));
    }

    if (weight) {
      conditions.push("i.weight = ?");
      bindings.push(weight);
    }

    if (conditions.length) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += " ORDER BY i.created_at DESC LIMIT 200";

    const results = await env.DB.prepare(query).bind(...bindings).all();
    return jsonResponse(results.results || []);
  }

  if (method === "GET" && imageId) {
    const image = await env.DB.prepare(
      `SELECT
         i.id,
         i.path,
         i.description,
         i.context,
         i.emotion,
         i.weight,
         i.charge,
         i.entity_id,
         i.observation_id,
         i.created_at,
         i.last_viewed_at,
         i.view_count,
         e.name as entity_name,
         e.entity_type
       FROM images i
       LEFT JOIN entities e ON i.entity_id = e.id
       WHERE i.id = ?`
    ).bind(imageId).first();

    return image ? jsonResponse(image) : jsonResponse({ error: "Not found" }, 404);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiContext(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const contextId = pathParts[2] || null;
  const url = new URL(request.url);
  const scopeFilter = url.searchParams.get("scope");

  // GET /api/context - list all or filter by scope
  if (method === "GET" && !contextId) {
    let query = "SELECT * FROM context_entries";
    const bindings: unknown[] = [];

    if (scopeFilter) {
      query += " WHERE scope = ?";
      bindings.push(scopeFilter);
    }
    query += " ORDER BY updated_at DESC LIMIT 200";

    const results = bindings.length
      ? await env.DB.prepare(query).bind(...bindings).all()
      : await env.DB.prepare(query).all();
    return jsonResponse(results.results || []);
  }

  // GET /api/context/:id - get one
  if (method === "GET" && contextId) {
    const entry = await env.DB.prepare("SELECT * FROM context_entries WHERE id = ?").bind(contextId).first();
    return entry ? jsonResponse(entry) : jsonResponse({ error: "Not found" }, 404);
  }

  // POST /api/context - create
  if (method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const id = body.id || `ctx-${Date.now()}`;
    await env.DB.prepare(
      "INSERT INTO context_entries (id, scope, content, links) VALUES (?, ?, ?, ?)"
    ).bind(id, body.scope || "default", body.content, body.links || "[]").run();
    return jsonResponse({ id, ...body }, 201);
  }

  // PUT /api/context/:id - update
  if (method === "PUT" && contextId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE context_entries SET content = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.content, contextId).run();
    return jsonResponse({ id: contextId, ...body });
  }

  // DELETE /api/context/:id - delete
  if (method === "DELETE" && contextId) {
    await env.DB.prepare("DELETE FROM context_entries WHERE id = ?").bind(contextId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiBulkObservations(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await request.json() as { action: string; ids: number[]; data?: Record<string, unknown> };
  const { action, ids, data } = body;

  if (!ids || !ids.length) return jsonResponse({ error: "No ids provided" }, 400);

  switch (action) {
    case "delete":
      for (const id of ids) {
        await env.DB.prepare("DELETE FROM observation_sits WHERE observation_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM observations WHERE id = ?").bind(id).run();
      }
      return jsonResponse({ deleted: ids.length });

    case "weight":
      if (!data?.weight) return jsonResponse({ error: "No weight provided" }, 400);
      for (const id of ids) {
        await env.DB.prepare("UPDATE observations SET weight = ? WHERE id = ?").bind(data.weight, id).run();
      }
      return jsonResponse({ updated: ids.length });

    case "resolve":
      for (const id of ids) {
        await env.DB.prepare(
          "UPDATE observations SET charge = 'metabolized', resolved_at = datetime('now') WHERE id = ?"
        ).bind(id).run();
      }
      return jsonResponse({ resolved: ids.length });

    default:
      return jsonResponse({ error: "Unknown action" }, 400);
  }
}

export async function handleApiProcess(env: Env): Promise<Response> {
  await processSubconscious(env);
  return jsonResponse({ status: "processed", timestamp: new Date().toISOString() });
}

export async function handleApiOrient(env: Env): Promise<Response> {
  const output = await handleMindOrient(env);
  return jsonResponse({ output });
}

export async function handleApiGround(env: Env): Promise<Response> {
  const output = await handleMindGround(env);
  return jsonResponse({ output });
}

export async function handleApiHealth(env: Env): Promise<Response> {
  const output = await handleMindHealth(env);
  return jsonResponse({ output });
}

export async function handleApiPersonality(env: Env): Promise<Response> {
  const whos: Who[] = [...WHO_VALUES];

  const ledgers = await Promise.all(whos.map(async (who) => {
    const [live, snapshot] = await Promise.all([
      env.DB.prepare(
        `SELECT COALESCE(SUM(e_i_delta),0) e_i, COALESCE(SUM(s_n_delta),0) s_n,
                COALESCE(SUM(t_f_delta),0) t_f, COALESCE(SUM(j_p_delta),0) j_p,
                COUNT(*) total
         FROM axis_signals WHERE who = ?`
      ).bind(who).first(),
      getLatestSnapshot(env, who),
    ]);

    const total = (live?.total as number) || 0;
    const axes = {
      e_i: (live?.e_i as number) || 0,
      s_n: (live?.s_n as number) || 0,
      t_f: (live?.t_f as number) || 0,
      j_p: (live?.j_p as number) || 0,
    };
    const liveType = total === 0 ? null :
      (axes.e_i >= 0 ? "I" : "E") + (axes.s_n >= 0 ? "N" : "S") +
      (axes.t_f >= 0 ? "F" : "T") + (axes.j_p >= 0 ? "P" : "J");

    return {
      who,
      type: liveType,
      confidence: Math.min(100, Math.round((total / 50) * 100)),
      signals: total,
      axes,
      snapshot: snapshot ? {
        type: snapshot.type, confidence: snapshot.confidence, date: snapshot.snapshotDate,
      } : null,
    };
  }));

  const [shadows, vocabTop] = await Promise.all([
    env.DB.prepare(
      `SELECT s.who, s.shadow_for_type, s.recorded_at, v.emotion_word
       FROM shadow_moments s LEFT JOIN emotion_vocabulary v ON v.emotion_id = s.emotion_id
       ORDER BY s.recorded_at DESC LIMIT 5`
    ).all(),
    env.DB.prepare(
      `SELECT emotion_word, category, times_used FROM emotion_vocabulary
       WHERE times_used > 0 ORDER BY times_used DESC LIMIT 8`
    ).all(),
  ]);

  return jsonResponse({
    ledgers,
    shadows: shadows.results || [],
    vocabulary_top: vocabTop.results || [],
  });
}

export async function handleApiHealthScores(env: Env): Promise<Response> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const subconscious = await getSubconsciousState(env);

  const [
    entityCount, obsCount, activeThreads, staleThreads,
    journalCount, journalsRecent, identityCount, recentObs
  ] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'active'`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'active' AND updated_at < ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM journals`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM journals WHERE created_at > ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM identity`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations WHERE added_at > ?`).bind(sevenDaysAgo).first()
  ]);

  const entities = entityCount?.c as number || 0;
  const observations = obsCount?.c as number || 0;
  const active = activeThreads?.c as number || 0;
  const stale = staleThreads?.c as number || 0;
  const journals7d = (journalsRecent?.c as number) || 0;
  const journals = (journalCount?.c as number) || 0;
  const identity = identityCount?.c as number || 0;
  const recentObsCount = recentObs?.c as number || 0;

  // Subconscious score
  let subconscious_score = 0;
  let daemon_processed_at: string | null = null;
  let mood: string | null = null;

  if (subconscious?.processed_at) {
    daemon_processed_at = subconscious.processed_at;
    const ageHours = Math.round((now.getTime() - new Date(subconscious.processed_at).getTime()) / (1000 * 60 * 60));
    if (ageHours < 1) subconscious_score = 100;
    else if (ageHours < 2) subconscious_score = 70;
    else if (ageHours < 6) subconscious_score = 40;
    else subconscious_score = 10;

    if (subconscious.mood?.dominant) {
      mood = subconscious.mood.dominant;
    }
  }

  const db_score = Math.min(100, Math.round((entities / 100) * 50 + (observations / 500) * 50));
  const thread_score = active > 0 ? (stale < 3 ? 100 : stale < 6 ? 60 : 30) : 50;
  const journal_score = journals7d >= 3 ? 100 : journals7d >= 1 ? 70 : journals > 0 ? 40 : 0;
  const identity_score = identity >= 50 ? 100 : Math.round((identity / 50) * 100);
  const activity_score = recentObsCount >= 20 ? 100 : Math.round((recentObsCount / 20) * 100);
  const overall = Math.round((db_score + thread_score + journal_score + identity_score + activity_score + subconscious_score) / 6);

  return jsonResponse({
    db_score,
    thread_score,
    journal_score,
    identity_score,
    activity_score,
    subconscious_score,
    overall,
    daemon_processed_at,
    mood
  });
}

export async function handleApiRecent(env: Env): Promise<Response> {
  // Last 20 observations with entity names
  const observations = await env.DB.prepare(`
    SELECT o.id, o.content, o.salience, o.emotion, o.weight, o.charge, o.added_at, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    ORDER BY o.added_at DESC
    LIMIT 20
  `).all();

  // Last 5 journals
  const journals = await env.DB.prepare(`
    SELECT id, entry_date, content, emotion, created_at
    FROM journals
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  // Last 5 thread changes (any status change)
  const threads = await env.DB.prepare(`
    SELECT id, thread_type, content, priority, status, context, created_at, updated_at, resolved_at
    FROM threads
    ORDER BY COALESCE(resolved_at, updated_at, created_at) DESC
    LIMIT 5
  `).all();

  return jsonResponse({
    observations: observations.results || [],
    journals: journals.results || [],
    threads: threads.results || []
  });
}

export async function handleApiInnerWeather(env: Env): Promise<Response> {
  const output = await handleMindInnerWeather(env);
  try {
    return jsonResponse(JSON.parse(output));
  } catch {
    return jsonResponse({ output });
  }
}

export async function handleApiStats(env: Env): Promise<Response> {
  const [
    entityCount,
    observationCount,
    journalCount,
    unprocessedCount,
    subconsciousState
  ] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as count FROM entities`).first(),
    env.DB.prepare(`SELECT COUNT(*) as count FROM observations`).first(),
    env.DB.prepare(`SELECT COUNT(*) as count FROM journals`).first(),
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM observations WHERE charge IS NULL OR charge != 'metabolized'`
    ).first(),
    getSubconsciousState(env)
  ]);

  return jsonResponse({
    version: NEURALIS_VERSION,
    counts: {
      entities: (entityCount?.count as number) || 0,
      observations: (observationCount?.count as number) || 0,
      journals: (journalCount?.count as number) || 0,
      unprocessed: (unprocessedCount?.count as number) || 0
    },
    daemon: subconsciousState || null
  });
}

export async function handleApiHeat(env: Env): Promise<Response> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT
       e.name,
       COUNT(o.id) as count,
       SUM(
         CASE o.weight
           WHEN 'heavy' THEN 3
           WHEN 'medium' THEN 2
           ELSE 1
         END
       ) as score
     FROM observations o
     JOIN entities e ON o.entity_id = e.id
     WHERE o.added_at > ?
       AND o.archived_at IS NULL
     GROUP BY e.id
     ORDER BY score DESC, count DESC, e.name ASC
     LIMIT 20`
  ).bind(sevenDaysAgo).all();

  const rows = (result.results || []) as Array<{
    name: string;
    count: number;
    score: number;
  }>;
  const maxScore = rows[0]?.score || 1;

  return jsonResponse({
    entities: rows.map((row) => ({
      name: row.name,
      count: row.count,
      heat: row.score / maxScore
    }))
  });
}

export async function handleApiPatterns(env: Env): Promise<Response> {
  const days = 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // What's alive - entities with recent activity
  const activity = await env.DB.prepare(
    `SELECT e.name, e.entity_type, COUNT(o.id) as obs_count
     FROM entities e
     LEFT JOIN observations o ON e.id = o.entity_id AND o.added_at > ?
     GROUP BY e.id
     HAVING obs_count > 0
     ORDER BY obs_count DESC
     LIMIT 10`
  ).bind(cutoff).all();

  // Emotional weight distribution
  const weights = await env.DB.prepare(
    `SELECT weight, COUNT(*) as count FROM observations WHERE added_at > ? GROUP BY weight`
  ).bind(cutoff).all();

  // Charge distribution (emotional processing state)
  const charges = await env.DB.prepare(
    `SELECT charge, COUNT(*) as count FROM observations GROUP BY charge`
  ).all();

  // Salience distribution (from observations, not entities)
  const salience = await env.DB.prepare(
    `SELECT salience, COUNT(*) as count FROM observations GROUP BY salience ORDER BY count DESC`
  ).all();

  // Foundational entities - entities with foundational observations
  const foundational = await env.DB.prepare(
    `SELECT DISTINCT e.name, e.entity_type FROM entities e
     JOIN observations o ON e.id = o.entity_id
     WHERE o.salience = 'foundational'`
  ).all();

  return jsonResponse({
    period_days: days,
    alive: activity.results || [],
    weights: weights.results || [],
    charges: charges.results || [],
    salience: salience.results || [],
    foundational: foundational.results || []
  });
}

export async function handleApiTensions(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const id = pathParts[2];

  // GET /api/tensions - list all
  if (request.method === "GET" && !id) {
    const active = await env.DB.prepare(
      `SELECT id, pole_a, pole_b, context, visits, created_at, last_visited
       FROM tensions WHERE resolved_at IS NULL
       ORDER BY created_at DESC`
    ).all();

    const resolved = await env.DB.prepare(
      `SELECT id, pole_a, pole_b, context, visits, created_at, resolved_at, resolution
       FROM tensions WHERE resolved_at IS NOT NULL
       ORDER BY resolved_at DESC
       LIMIT 10`
    ).all();

    return jsonResponse({
      active: active.results || [],
      resolved: resolved.results || [],
      active_count: active.results?.length || 0,
      resolved_count: resolved.results?.length || 0
    });
  }

  // POST /api/tensions - create new
  if (request.method === "POST" && !id) {
    const body = await request.json() as any;
    const tensionId = `tension-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await env.DB.prepare(
      `INSERT INTO tensions (id, pole_a, pole_b, context, visits, created_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))`
    ).bind(tensionId, body.pole_a, body.pole_b, body.context || null).run();

    return jsonResponse({ id: tensionId, success: true });
  }

  // POST /api/tensions/:id/visit - sit with tension
  if (request.method === "POST" && pathParts[3] === "visit") {
    await env.DB.prepare(
      `UPDATE tensions SET visits = visits + 1, last_visited = datetime('now') WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({ success: true });
  }

  // POST /api/tensions/:id/resolve - resolve tension
  if (request.method === "POST" && pathParts[3] === "resolve") {
    const body = await request.json() as any;

    await env.DB.prepare(
      `UPDATE tensions SET resolved_at = datetime('now'), resolution = ? WHERE id = ?`
    ).bind(body.resolution || null, id).run();

    return jsonResponse({ success: true });
  }

  // DELETE /api/tensions/:id
  if (request.method === "DELETE" && id) {
    await env.DB.prepare(`DELETE FROM tensions WHERE id = ?`).bind(id).run();
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown tensions endpoint" }, 404);
}

// === PROPOSALS API ===
export async function handleApiProposals(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const id = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3]; // accept or reject

  // GET /api/proposals - list all proposals
  if (request.method === "GET" && !id) {
    const status = new URL(request.url).searchParams.get("status") || "pending";

    let query = `
      SELECT dp.*,
             oa.content as from_content, ob.content as to_content,
             ea.name as from_entity_name, eb.name as to_entity_name,
             cs.co_count
      FROM daemon_proposals dp
      LEFT JOIN observations oa ON dp.from_obs_id = oa.id
      LEFT JOIN observations ob ON dp.to_obs_id = ob.id
      LEFT JOIN entities ea ON dp.from_entity_id = ea.id
      LEFT JOIN entities eb ON dp.to_entity_id = eb.id
      LEFT JOIN co_surfacing cs ON (
        (cs.obs_a_id = dp.from_obs_id AND cs.obs_b_id = dp.to_obs_id) OR
        (cs.obs_a_id = dp.to_obs_id AND cs.obs_b_id = dp.from_obs_id)
      )
    `;

    if (status !== "all") {
      query += ` WHERE dp.status = ?`;
    }
    query += ` ORDER BY dp.proposed_at DESC LIMIT 100`;

    const results = status !== "all"
      ? await env.DB.prepare(query).bind(status).all()
      : await env.DB.prepare(query).all();

    return jsonResponse(results.results);
  }

  // POST /api/proposals/:id/accept - accept proposal and create relation
  if (request.method === "POST" && id && action === "accept") {
    const body = await request.json() as { relation_type?: string };
    const relationType = body.relation_type || "related_to";

    // Get the proposal
    const proposal = await env.DB.prepare(
      `SELECT * FROM daemon_proposals WHERE id = ?`
    ).bind(id).first();

    if (!proposal) return jsonResponse({ error: "Proposal not found" }, 404);

    // Get entity names
    const fromEntity = await env.DB.prepare(
      `SELECT name FROM entities WHERE id = ?`
    ).bind(proposal.from_entity_id).first();
    const toEntity = await env.DB.prepare(
      `SELECT name FROM entities WHERE id = ?`
    ).bind(proposal.to_entity_id).first();

    if (fromEntity && toEntity) {
      // Create the relation
      await env.DB.prepare(
        `INSERT INTO relations (from_entity, to_entity, relation_type, context) VALUES (?, ?, ?, 'default')`
      ).bind(fromEntity.name, toEntity.name, relationType).run();
    }

    // Update proposal status
    await env.DB.prepare(
      `UPDATE daemon_proposals SET status = 'accepted', resolved_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    // Mark co_surfacing as relation created
    await env.DB.prepare(
      `UPDATE co_surfacing SET relation_created = 1
       WHERE (obs_a_id = ? AND obs_b_id = ?) OR (obs_a_id = ? AND obs_b_id = ?)`
    ).bind(proposal.from_obs_id, proposal.to_obs_id, proposal.to_obs_id, proposal.from_obs_id).run();

    return jsonResponse({ success: true, relation_created: true });
  }

  // POST /api/proposals/:id/reject - reject proposal
  if (request.method === "POST" && id && action === "reject") {
    await env.DB.prepare(
      `UPDATE daemon_proposals SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown proposals endpoint" }, 404);
}

// === DORMANT API ===
export async function handleApiDormant(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const id = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3]; // surface or archive

  // GET /api/dormant - list dormant observations
  if (request.method === "GET" && !id) {
    const results = await env.DB.prepare(`
      SELECT doo.*, o.content, o.weight, o.emotion, o.added_at, o.charge,
             e.name as entity_name, e.entity_type,
             CAST((julianday('now') - julianday(o.added_at)) AS INTEGER) as days_old
      FROM dormant_observations doo
      JOIN observations o ON doo.observation_id = o.id
      JOIN entities e ON o.entity_id = e.id
      WHERE o.archived_at IS NULL
        AND (o.charge != 'metabolized' OR o.charge IS NULL)
      ORDER BY doo.first_marked DESC
      LIMIT 100
    `).all();

    return jsonResponse(results.results);
  }

  // POST /api/dormant/:id/surface - force surface
  if (request.method === "POST" && id && action === "surface") {
    await env.DB.prepare(
      `DELETE FROM dormant_observations WHERE observation_id = ?`
    ).bind(id).run();

    await env.DB.prepare(
      `UPDATE observations SET novelty_score = 1.0, last_surfaced_at = NULL WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({ success: true });
  }

  // POST /api/dormant/:id/archive - archive
  if (request.method === "POST" && id && action === "archive") {
    await env.DB.prepare(
      `UPDATE observations SET archived_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    await env.DB.prepare(
      `DELETE FROM dormant_observations WHERE observation_id = ?`
    ).bind(id).run();

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown dormant endpoint" }, 404);
}

export async function handleApiIsolated(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const action = pathParts[2]; // empty (list), connect, or ignore

  // GET /api/isolated - list isolated entities
  if (request.method === "GET" && !action) {
    const isolated = await env.DB.prepare(`
      SELECT e.id, e.name, e.entity_type, e.primary_context, e.salience,
             COUNT(o.id) as obs_count
      FROM entities e
      LEFT JOIN observations o ON o.entity_id = e.id AND o.archived_at IS NULL
      WHERE COALESCE(e.intentionally_isolated, 0) = 0
        AND (e.salience IS NULL OR e.salience NOT IN ('archive'))
        AND NOT EXISTS (
          SELECT 1 FROM relations r
          WHERE r.from_entity = e.name OR r.to_entity = e.name
        )
      GROUP BY e.id, e.name, e.entity_type, e.primary_context, e.salience
      ORDER BY obs_count DESC, e.name ASC
      LIMIT 100
    `).all();

    return jsonResponse(isolated.results);
  }

  // POST /api/isolated/connect - create a relation
  if (request.method === "POST" && action === "connect") {
    const body = await request.json() as { entity?: string; to_entity?: string; relation_type?: string };
    if (!body.entity || !body.to_entity) {
      return jsonResponse({ error: "entity and to_entity required" }, 400);
    }
    await env.DB.prepare(`
      INSERT INTO relations (from_entity, to_entity, relation_type)
      VALUES (?, ?, ?)
    `).bind(body.entity, body.to_entity, body.relation_type || "relates_to").run();
    return jsonResponse({ success: true });
  }

  // POST /api/isolated/ignore - mark intentionally standalone
  if (request.method === "POST" && action === "ignore") {
    const body = await request.json() as { entity?: string };
    if (!body.entity) {
      return jsonResponse({ error: "entity required" }, 400);
    }
    await env.DB.prepare(
      `UPDATE entities SET intentionally_isolated = 1 WHERE name = ?`
    ).bind(body.entity).run();
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown isolated endpoint" }, 404);
}

// === ARCHIVE API ===
export async function handleApiArchive(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const id = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3]; // rescue or search

  // GET /api/archive - list archived observations
  if (request.method === "GET" && !id && action !== "search") {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const results = await env.DB.prepare(`
      SELECT o.*, e.name as entity_name, e.entity_type
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE o.archived_at IS NOT NULL
      ORDER BY o.archived_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM observations WHERE archived_at IS NOT NULL`
    ).first();

    return jsonResponse({
      observations: results.results,
      total: countResult?.total || 0,
      limit,
      offset
    });
  }

  // GET /api/archive/search?q=... - semantic search in archive
  if (request.method === "GET" && action === "search") {
    const query = new URL(request.url).searchParams.get("q");
    if (!query) return jsonResponse({ error: "Query required" }, 400);

    const embedding = await getEmbedding(env, query);
    const vectorResults = await env.VECTORS.query(embedding, {
      topK: 30,
      returnMetadata: "all"
    });

    // Filter to only archived observations
    const obsIds: number[] = [];
    for (const match of vectorResults.matches || []) {
      if (match.id.startsWith("obs-")) {
        const parts = match.id.split("-");
        if (parts.length >= 3) {
          obsIds.push(parseInt(parts[2]));
        }
      }
    }

    if (obsIds.length === 0) return jsonResponse([]);

    const placeholders = obsIds.map(() => "?").join(",");
    const results = await env.DB.prepare(`
      SELECT o.*, e.name as entity_name, e.entity_type
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE o.id IN (${placeholders}) AND o.archived_at IS NOT NULL
      ORDER BY o.archived_at DESC
    `).bind(...obsIds).all();

    return jsonResponse(results.results);
  }

  // POST /api/archive/:id/rescue - un-archive observation
  if (request.method === "POST" && id && action === "rescue") {
    await env.DB.prepare(
      `UPDATE observations SET archived_at = NULL, novelty_score = 0.8 WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown archive endpoint" }, 404);
}

// === OBSERVATION VERSIONS API ===
export async function handleApiObservationVersions(request: Request, env: Env, obsId: number): Promise<Response> {
  // GET /api/observations/:id/versions - get version history
  if (request.method === "GET") {
    const versions = await env.DB.prepare(`
      SELECT * FROM observation_versions
      WHERE observation_id = ?
      ORDER BY version_num DESC
    `).bind(obsId).all();

    return jsonResponse(versions.results);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

// === CORTEX API HANDLERS ===
import { handleCortexRemember, handleCortexRecall } from "../cortex/remember";
import { handleCortexSaveConversation, handleCortexSearchConversations } from "../cortex/conversations";
import { handleCortexStats } from "../cortex/stats";

export async function handleApiCortexThoughts(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  // POST /api/cortex/thoughts — save a thought
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const result = await handleCortexRemember(env, body);
    return jsonResponse({ result });
  }

  // GET /api/cortex/thoughts?query=... — recall thoughts
  if (request.method === "GET") {
    const url = new URL(request.url);
    const params: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams) {
      params[key] = value;
    }
    if (params.limit) params.limit = parseInt(params.limit as string);
    const result = await handleCortexRecall(env, params);
    return jsonResponse({ result });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiCortexConversations(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const convId = pathParts[3] || null;

  // POST /api/cortex/conversations — save a conversation
  if (request.method === "POST" && !convId) {
    const body = await request.json() as Record<string, unknown>;
    const result = await handleCortexSaveConversation(env, body);
    return jsonResponse({ result });
  }

  // GET /api/cortex/conversations/:id — get a single conversation with messages
  if (request.method === "GET" && convId) {
    const conv = await env.DB.prepare("SELECT * FROM cortex_conversations WHERE id = ?").bind(convId).first();
    if (!conv) return jsonResponse({ error: "Not found" }, 404);

    const messages = await env.DB.prepare(
      "SELECT * FROM cortex_messages WHERE conversation_id = ? ORDER BY msg_index"
    ).bind(convId).all();

    return jsonResponse({ ...conv, messages: messages.results });
  }

  // GET /api/cortex/conversations?query=... — search conversations
  if (request.method === "GET") {
    const url = new URL(request.url);
    const params: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams) {
      params[key] = value;
    }
    if (params.limit) params.limit = parseInt(params.limit as string);
    if (params.has_open_questions) params.has_open_questions = params.has_open_questions === "true";
    const result = await handleCortexSearchConversations(env, params);
    return jsonResponse({ result });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function handleApiCortexStats(env: Env): Promise<Response> {
  const result = await handleCortexStats(env);
  return jsonResponse({ result });
}

// ============================================================================
// Engine: Crons CRUD + Fire Now
// ============================================================================

export async function handleApiCrons(
  request: Request,
  env: Env,
  pathParts: string[]
): Promise<Response> {
  const cronId = pathParts[2] ? parseInt(pathParts[2], 10) : null;

  // POST /api/crons/:id/fire — fire a cron immediately
  if (cronId && pathParts[3] === "fire" && request.method === "POST") {
    try {
      const status = await fireCron(env, cronId);
      return jsonResponse({ id: cronId, status, fired_at: new Date().toISOString() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: msg }, 400);
    }
  }

  // PATCH /api/crons/:id — update a cron (enable/disable, label, frequency)
  if (cronId && request.method === "PATCH") {
    const body = await request.json() as Record<string, unknown>;
    const sets: string[] = [];
    const bindings: unknown[] = [];

    if (body.enabled !== undefined) {
      sets.push("enabled = ?");
      bindings.push(body.enabled ? 1 : 0);
    }
    if (body.label !== undefined) {
      sets.push("label = ?");
      bindings.push(body.label);
    }
    if (body.frequency_minutes !== undefined) {
      sets.push("frequency_minutes = ?");
      bindings.push(body.frequency_minutes);
    }
    if (body.agentic_action !== undefined) {
      sets.push("agentic_action = ?");
      bindings.push(body.agentic_action || null);
    }

    if (sets.length === 0) {
      return jsonResponse({ error: "No fields to update" }, 400);
    }

    bindings.push(cronId);
    await env.DB.prepare(
      `UPDATE crons SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...bindings).run();

    const updated = await env.DB.prepare("SELECT * FROM crons WHERE id = ?").bind(cronId).first();
    return jsonResponse(updated);
  }

  // DELETE /api/crons/:id
  if (cronId && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM crons WHERE id = ?").bind(cronId).run();
    return jsonResponse({ deleted: cronId });
  }

  // GET /api/crons/:id — single cron
  if (cronId && request.method === "GET") {
    const cron = await env.DB.prepare("SELECT * FROM crons WHERE id = ?").bind(cronId).first();
    if (!cron) return jsonResponse({ error: "Not found" }, 404);
    return jsonResponse(cron);
  }

  // POST /api/crons — create a cron
  if (!cronId && request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const preset = body.preset as string;
    const label = (body.label as string) || null;
    const frequencyMinutes = (body.frequency_minutes as number) ?? 0;
    const agenticAction = (body.agentic_action as string) || null;

    if (!preset) return jsonResponse({ error: "preset is required" }, 400);

    const result = await env.DB.prepare(
      "INSERT INTO crons (preset, label, frequency_minutes, agentic_action, enabled) VALUES (?, ?, ?, ?, 1)"
    ).bind(preset, label, frequencyMinutes, agenticAction).run();

    const created = await env.DB.prepare(
      "SELECT * FROM crons WHERE id = ?"
    ).bind(result.meta.last_row_id).first();

    return jsonResponse(created, 201);
  }

  // GET /api/crons — list all
  if (!cronId && request.method === "GET") {
    const crons = await env.DB.prepare(
      "SELECT * FROM crons ORDER BY created_at ASC"
    ).all();
    return jsonResponse(crons.results || []);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

// ============================================================================
// Engine: Emergence Fuel Gauge
// ============================================================================

export async function handleApiEmergence(env: Env): Promise<Response> {
  // co_surfacing pairs at co_count >= 2
  const pairsResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM co_surfacing WHERE co_count >= 2"
  ).first();
  const pairs = (pairsResult?.count as number) || 0;

  // pending daemon_proposals
  const proposalsResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM daemon_proposals WHERE status = 'pending'"
  ).first();
  const pendingProposals = (proposalsResult?.count as number) || 0;

  return jsonResponse({
    co_surfacing_pairs: pairs,
    pending_proposals: pendingProposals,
  });
}

export async function handleApiTaxonomy(env: Env): Promise<Response> {
  // Unfiled count: anything not in the seven canonical buckets
  const unfiledResult = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM observations WHERE context NOT IN (${CONTEXT_BUCKETS_SQL}) AND archived_at IS NULL`
  ).first();
  const unfiled = (unfiledResult?.count as number) || 0;

  // Total active observations
  const totalResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE archived_at IS NULL"
  ).first();
  const total = (totalResult?.count as number) || 0;

  // Owner coverage: how many have owner set
  const signedResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE owner IS NOT NULL AND archived_at IS NULL"
  ).first();
  const signed = (signedResult?.count as number) || 0;

  // Context distribution
  const distribution = await env.DB.prepare(
    "SELECT context, COUNT(*) as count FROM observations WHERE archived_at IS NULL GROUP BY context ORDER BY count DESC"
  ).all();

  return jsonResponse({
    unfiled,
    total,
    signed,
    unsigned: total - signed,
    signed_ratio: total > 0 ? Math.round((signed / total) * 100) : 0,
    distribution: distribution.results,
  });
}

export { jsonResponse };

// ============================================================================
// Knowledge layer (NESTknow port): /api/know
// ============================================================================

/**
 * GET  /api/know                 → landscape (status, categories, hottest, cooling, candidates, tracks)
 * GET  /api/know?who=<slug>       → landscape filtered to one ledger
 * GET  /api/know/query?q=...     → usage-weighted semantic search (votes, like the MCP tool)
 * GET  /api/know/items           → recent items (limit, status, who)
 * GET  /api/know/sessions        → curriculum sessions (track, who, limit)
 * POST /api/know/items/:id/reinforce | /contradict  { context }
 */
export async function handleApiKnowledge(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const url = new URL(request.url);
  const sub = pathParts[2];
  const whoParam = url.searchParams.get("who");
  const who = whoParam && whoParam !== "all" ? normalizeWho(whoParam) : null;

  if (!sub && request.method === "GET") {
    return jsonResponse(await getKnowledgeLandscape(env, who));
  }

  if (sub === "query" && request.method === "GET") {
    const q = url.searchParams.get("q") || "";
    if (!q.trim()) return jsonResponse({ error: "q is required" }, 400);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);
    const category = url.searchParams.get("category") || undefined;
    const results = await queryKnowledge(env, q, { limit, category, who });
    return jsonResponse({ query: q, results });
  }

  if (sub === "items" && !pathParts[3] && request.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const status = url.searchParams.get("status");
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (status) { clauses.push("status = ?"); binds.push(status); }
    if (who) { clauses.push("who = ?"); binds.push(who); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `SELECT id, content, category, who, status, confidence, heat_score, access_count, last_accessed_at, contradiction_count, created_at
       FROM knowledge_items ${where} ORDER BY heat_score DESC, created_at DESC LIMIT ?`
    ).bind(...binds, limit).all();
    return jsonResponse(rows.results || []);
  }

  if (sub === "items" && pathParts[3] && request.method === "POST") {
    const id = parseInt(pathParts[3], 10);
    let context = "";
    try { context = ((await request.json()) as { context?: string }).context || ""; } catch { /* empty body ok */ }
    if (pathParts[4] === "reinforce") {
      return jsonResponse({ result: await handleKnowReinforce(env, { knowledge_id: id, context: context || "dashboard" }) });
    }
    if (pathParts[4] === "contradict") {
      return jsonResponse({ result: await handleKnowContradict(env, { knowledge_id: id, context: context || "dashboard" }) });
    }
    return jsonResponse({ error: "Unknown item action" }, 404);
  }

  if (sub === "sessions" && request.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const track = url.searchParams.get("track");
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (track) { clauses.push("track = ?"); binds.push(track); }
    if (who) { clauses.push("who = ?"); binds.push(who); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `SELECT id, track, topic, who, status, notes, practice_output, reflection, mastery_delta, started_at, completed_at
       FROM knowledge_sessions ${where} ORDER BY started_at DESC LIMIT ?`
    ).bind(...binds, limit).all();
    return jsonResponse(rows.results || []);
  }

  return jsonResponse({ error: "Unknown knowledge endpoint" }, 404);
}

// ============================================================================
// Soul portraits (NESTsoul port): /api/soul
// ============================================================================

/**
 * GET  /api/soul?who=<slug>           → { who, active, pending, history }
 * GET  /api/soul                       → every companion, keyed by slug
 * GET  /api/soul/gather?who=<slug>      → raw material text (what a portrait is built from)
 * POST /api/soul/generate  { who, voice_profile? }  → gather + synthesise + store PENDING (30–60s)
 * POST /api/soul/validate  { who, action: validate|reject, version?, validated_by?, note? }
 */
export async function handleApiSoul(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const url = new URL(request.url);
  const sub = pathParts[2];

  const snapshot = async (who: Who) => {
    const [active, pending, history] = await Promise.all([
      getActiveSoul(env, who), getPendingSoul(env, who), listSoulVersions(env, who, 10),
    ]);
    return { who, active, pending, history };
  };

  if (!sub && request.method === "GET") {
    const whoParam = url.searchParams.get("who");
    if (whoParam) return jsonResponse(await snapshot(normalizeWho(whoParam)));
    const snaps = await Promise.all(COMPANION_SLUGS.map((slug) => snapshot(slug)));
    return jsonResponse(Object.fromEntries(COMPANION_SLUGS.map((slug, i) => [slug, snaps[i]])));
  }

  if (sub === "gather" && request.method === "GET") {
    const who = normalizeWho(url.searchParams.get("who"));
    const raw = await gatherSoulMaterial(env, who);
    return jsonResponse({ who, raw, chars: raw.length });
  }

  if (sub === "generate" && request.method === "POST") {
    let body: { who?: string; voice_profile?: string } = {};
    try { body = await request.json() as typeof body; } catch { /* empty body */ }
    const who = normalizeWho(body.who);
    try {
      const result = await generateSoul(env, who, body.voice_profile || "");
      return jsonResponse({ ok: true, who, version: result.id, model: result.model, content: result.content, status: "pending" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`soul generate failed for ${who}: ${msg}`);
      return jsonResponse({ ok: false, error: `Synthesis failed: ${msg.slice(0, 300)}` }, 500);
    }
  }

  if (sub === "validate" && request.method === "POST") {
    let body: { who?: string; action?: string; version?: number; validated_by?: string; note?: string } = {};
    try { body = await request.json() as typeof body; } catch { /* empty body */ }
    const who = normalizeWho(body.who);
    const action = body.action === "reject" ? "reject" : "validate";
    const result = await validateSoul(env, who, action, {
      version: body.version ? Number(body.version) : undefined,
      validatedBy: body.validated_by || HOUSE_HUMAN_NAME,
      note: body.note,
    });
    return jsonResponse({ ok: true, action, result, ...(await snapshot(who)) });
  }

  return jsonResponse({ error: "Unknown soul endpoint" }, 404);
}

// ============================================================================
// Feelings stream (NESTeq port): /api/feelings
// ============================================================================

/**
 * Read-only by design. The companions feel, sit, and metabolize from a
 * session (mind_feel / mind_sit / mind_resolve). The dashboard is the window.
 *
 * GET  /api/feelings?who=&days=          → landscape (totals, pillars, most-felt, by ledger, charges, recent)
 * GET  /api/feelings/surface?who=&limit= → what's worth sitting with
 * GET  /api/feelings/recent?who=&limit=  → newest first
 */
export async function handleApiFeelings(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const url = new URL(request.url);
  const sub = pathParts[2];
  const whoParam = url.searchParams.get("who");
  const who = whoParam && whoParam !== "all" ? normalizeWho(whoParam) : null;
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);

  if (!sub && request.method === "GET") {
    const days = parseInt(url.searchParams.get("days") || "7", 10);
    return jsonResponse(await getFeelingsLandscape(env, days, who));
  }

  if (sub === "surface" && request.method === "GET") {
    return jsonResponse(await surfaceFeelings(env, { limit, who, includeMetabolized: url.searchParams.get("include_metabolized") === "true" }));
  }

  if (sub === "recent" && request.method === "GET") {
    const wf = who ? " WHERE who = ?" : "";
    const rows = await env.DB.prepare(
      `SELECT id, content, emotion, who, intensity, weight, pillar, charge, sit_count, linked_entity, context, tags, created_at,
              COALESCE(strength, 0.5) AS strength, COALESCE(access_count, 0) AS access_count, resolution_note
       FROM feelings${wf} ORDER BY created_at DESC LIMIT ?`
    ).bind(...(who ? [who] : []), limit).all();
    return jsonResponse(rows.results || []);
  }

  return jsonResponse({ error: "Unknown feelings endpoint" }, 404);
}
