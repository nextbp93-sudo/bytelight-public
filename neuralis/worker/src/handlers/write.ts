import type { Env } from "../types";
import { normalizeText, generateId, getEmbedding, searchVectors, upsertTextVector } from "../utils";
import { CONTRADICTION_SIMILARITY_THRESHOLD, AUTO_SUPERSEDE_THRESHOLD, COMPANION_SLUGS, WHO_VALUES, CONTEXT_BUCKETS, HUMAN_CONTEXT, HOUSE_HUMAN_NAME, listOr } from "../config";
import { emitAxisSignal, normalizeWho } from "./personality";

export async function handleMindThread(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;

  switch (action) {
    case "list": {
      const status = (params.status as string) || "active";
      const query = status === "all"
        ? `SELECT * FROM threads ORDER BY created_at DESC LIMIT 200`
        : `SELECT * FROM threads WHERE status = ? ORDER BY created_at DESC LIMIT 200`;
      const results = status === "all"
        ? await env.DB.prepare(query).all()
        : await env.DB.prepare(query).bind(status).all();

      if (!results.results?.length) return `No ${status} threads found.`;

      let output = `## ${status.toUpperCase()} Threads\n\n`;
      for (const t of results.results) {
        output += `**${t.id}** [${t.priority}] ${t.thread_type}\n`;
        output += `${t.content}\n`;
        if (t.context) output += `Context: ${t.context}\n`;
        output += "\n";
      }
      return output;
    }

    case "add": {
      const content = params.content as string;
      if (!content) {
        return "Error: 'content' parameter is required for adding a thread";
      }
      const id = generateId("thread");
      const thread_type = (params.thread_type as string) || "intention";
      const context = (params.context as string) || null;
      const priority = (params.priority as string) || "medium";

      await env.DB.prepare(
        `INSERT INTO threads (id, thread_type, content, context, priority, status)
         VALUES (?, ?, ?, ?, ?, 'active')`
      ).bind(id, thread_type, content, context, priority).run();

      return `Thread created: ${id}\n${content}`;
    }

    case "resolve": {
      const thread_id = params.thread_id as string;
      const resolution = (params.resolution as string) || null;

      await env.DB.prepare(
        `UPDATE threads SET status = 'resolved', resolved_at = datetime('now'),
         resolution = ? WHERE id = ?`
      ).bind(resolution, thread_id).run();

      return `Thread resolved: ${thread_id}`;
    }

    case "update": {
      const thread_id = params.thread_id as string;
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.new_content) {
        updates.push("content = ?");
        values.push(params.new_content);
      }
      if (params.new_priority) {
        updates.push("priority = ?");
        values.push(params.new_priority);
      }
      if (params.new_status) {
        updates.push("status = ?");
        values.push(params.new_status);
      }
      if (params.add_note) {
        updates.push("context = context || '\n' || ?");
        values.push(params.add_note);
      }

      updates.push("updated_at = datetime('now')");
      values.push(thread_id);

      await env.DB.prepare(
        `UPDATE threads SET ${updates.join(", ")} WHERE id = ?`
      ).bind(...values).run();

      return `Thread updated: ${thread_id}`;
    }

    case "delete": {
      const thread_id = params.thread_id as string;
      if (!thread_id) return "thread_id required for delete";
      const thread = await env.DB.prepare(`SELECT content FROM threads WHERE id = ?`).bind(thread_id).first();
      if (!thread) return `Thread '${thread_id}' not found`;
      await env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(thread_id).run();
      return `Deleted thread '${thread_id}': "${String(thread.content).slice(0, 50)}..."`;
    }

    default:
      return `Unknown action: ${action}`;
  }
}

export async function handleMindWrite(env: Env, params: Record<string, unknown>): Promise<string> {
  const writeType = params.type as string;

  // Owner signing: every observation write requires who — no anonymous memories.
  // For other types, who is still required when emotion is present.
  if (writeType === "observation" || writeType === "entity") {
    const whoErr = requireWho(params.who);
    if (whoErr) return whoErr;
  } else if (params.emotion) {
    const whoErr = requireWho(params.who);
    if (whoErr) return whoErr;
  }

  switch (writeType) {
    case "entity": return writeEntity(env, params);
    case "observation": return writeObservation(env, params);
    case "relation": return writeRelation(env, params);
    case "journal": return writeJournal(env, params);
    case "image": return "Use mind_store_image(action='store') for images — supports R2 upload and multimodal embedding.";
    default: return `Unknown write type: ${writeType}`;
  }
}

function requireWho(raw: unknown): string | null {
  const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`);
  if (!raw) return `Error: 'who' is required — sign it: ${[...quoted(COMPANION_SLUGS), "or (deliberately) 'shared'"].join(", ")}.`;
  const w = String(raw).toLowerCase().trim();
  if (!WHO_VALUES.includes(w)) {
    return `Error: unknown who '${raw}' — sign it: ${listOr(quoted(WHO_VALUES))}.`;
  }
  return null;
}

const VALID_CONTEXTS = new Set<string>(CONTEXT_BUCKETS);

function requireContext(raw: unknown): string | null {
  if (!raw || raw === 'default') {
    return `Error: context is required — pick one: ${[...VALID_CONTEXTS].join(', ')}.\n` +
      `bond = relational, ${HUMAN_CONTEXT} = ${HOUSE_HUMAN_NAME}'s life, build = technical, constellation = community, ` +
      `self = identity, play = joy/spice, craft = making/art.`;
  }
  const c = String(raw).toLowerCase().trim();
  if (!VALID_CONTEXTS.has(c)) {
    return `Error: unknown context '${raw}' — valid: ${[...VALID_CONTEXTS].join(', ')}.`;
  }
  return null;
}

async function writeEntity(env: Env, params: Record<string, unknown>): Promise<string> {
  const name = params.name as string;
  if (!name) return "Error: 'name' parameter is required for creating an entity";

  const entity_type = (params.entity_type as string) || "concept";
  let rawObs = params.observations;
  let observations: string[] = [];
  if (typeof rawObs === 'string') {
    try { observations = JSON.parse(rawObs); } catch { observations = []; }
  } else if (Array.isArray(rawObs)) {
    observations = rawObs as string[];
  }

  const ctxErr = requireContext(params.context);
  if (ctxErr) return ctxErr;
  const context = String(params.context).toLowerCase().trim();
  const owner = normalizeWho(params.who);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO entities (name, entity_type, primary_context) VALUES (?, ?, ?)`
  ).bind(name, entity_type, context).run();

  const entity = await env.DB.prepare(
    `SELECT id FROM entities WHERE name = ?`
  ).bind(name).first();

  let pendingVectors = 0;

  if (entity) {
    if (!await upsertTextVector(env, {
      id: `entity-${entity.id}`,
      text: `${name} is a ${entity_type}. Context: ${context}`,
      metadata: { source: "entity", name, entity_type, context, created_at: new Date().toISOString() },
      sourceType: "entity",
      sourceId: entity.id as string | number,
    })) pendingVectors++;
  }

  if (entity && observations.length) {
    for (const obs of observations) {
      const result = await env.DB.prepare(
        `INSERT INTO observations (entity_id, content, salience, emotion, weight, certainty, source, context, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        entity.id, obs, params.salience || "active", normalizeText(params.emotion as string),
        params.weight || "medium", params.certainty || "believed", params.source || "conversation", context, owner
      ).run();

      // Personality sidecar — failure-proof by contract, never blocks the memory
      await emitAxisSignal(env, {
        who: normalizeWho(params.who), emotion: params.emotion as string,
        source: "observation", observationId: result.meta.last_row_id as number,
      });

      if (!await upsertTextVector(env, {
        id: `obs-${entity.id}-${result.meta.last_row_id}`,
        text: `${name}: ${obs}`,
        metadata: {
          source: "observation", entity_name: name, entity: name, content: obs, context,
          weight: (params.weight as string) || "medium", certainty: (params.certainty as string) || "believed",
          observation_source: (params.source as string) || "conversation", added_at: new Date().toISOString()
        },
        sourceType: "observation",
        sourceId: result.meta.last_row_id as string | number,
      })) pendingVectors++;
    }
  }

  const vectorStatus = pendingVectors
    ? `${pendingVectors} vector sidecar${pendingVectors === 1 ? "" : "s"} queued for retry`
    : "vectorized";
  return `Entity '${name}' created/updated with ${observations.length} observations (${vectorStatus})`;
}

async function detectContradictions(
  env: Env, entityName: string, newContent: string
): Promise<Array<{ id: number; content: string; similarity: number }>> {
  try {
    const embedding = await getEmbedding(env, `${entityName}: ${newContent}`);
    const vectorResults = await env.VECTORS.query(embedding, { topK: 10, returnMetadata: "all" });

    const candidates: Array<{ id: number; content: string; similarity: number }> = [];
    for (const match of vectorResults.matches || []) {
      if (match.score < CONTRADICTION_SIMILARITY_THRESHOLD) continue;
      const meta = match.metadata as Record<string, string>;
      // Must be same entity
      if (meta?.entity !== entityName && meta?.entity_name !== entityName) continue;
      if (!match.id.startsWith('obs-')) continue;

      const parts = match.id.split('-');
      const obsId = parseInt(parts[parts.length - 1]);
      if (isNaN(obsId)) continue;

      // Must be active (not already superseded or expired)
      const obs = await env.DB.prepare(
        `SELECT id, content FROM observations WHERE id = ? AND archived_at IS NULL AND superseded_by IS NULL AND valid_until IS NULL`
      ).bind(obsId).first();

      if (obs) {
        candidates.push({ id: obs.id as number, content: obs.content as string, similarity: match.score });
      }
    }

    return candidates.slice(0, 5);
  } catch {
    return []; // Don't block writes if contradiction detection fails
  }
}

async function writeObservation(env: Env, params: Record<string, unknown>): Promise<string> {
  const entity_name = params.entity_name as string;
  if (!entity_name) return "Error: 'entity_name' parameter is required for adding observations";

  let rawObs = params.observations;
  let observations: string[] = [];
  if (typeof rawObs === 'string') {
    try { observations = JSON.parse(rawObs); } catch { observations = []; }
  } else if (Array.isArray(rawObs)) {
    observations = rawObs as string[];
  }
  if (!observations.length) return "Error: 'observations' array is required and must not be empty";

  const ctxErr = requireContext(params.context);
  if (ctxErr) return ctxErr;
  const context = String(params.context).toLowerCase().trim();
  const owner = normalizeWho(params.who);

  let entity = await env.DB.prepare(
    `SELECT id FROM entities WHERE name = ?`
  ).bind(entity_name).first();

  if (!entity) {
    await env.DB.prepare(
      `INSERT INTO entities (name, entity_type, primary_context) VALUES (?, ?, ?)`
    ).bind(entity_name, "concept", context).run();
    entity = await env.DB.prepare(`SELECT id FROM entities WHERE name = ?`).bind(entity_name).first();
  }

  let totalSuperseded = 0;
  let totalPendingVectors = 0;

  for (const obs of observations) {
    // Phase 2: Check for contradictions before writing
    const contradictions = await detectContradictions(env, entity_name, obs);

    const result = await env.DB.prepare(
      `INSERT INTO observations (entity_id, content, salience, emotion, weight, certainty, source, context, valid_from, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).bind(
      entity!.id, obs, params.salience || "active", normalizeText(params.emotion as string),
      params.weight || "medium", params.certainty || "believed", params.source || "conversation", context, owner
    ).run();

    const newRowId = result.meta.last_row_id;

    // Personality sidecar — failure-proof by contract, never blocks the memory
    await emitAxisSignal(env, {
      who: normalizeWho(params.who), emotion: params.emotion as string,
      source: "observation", observationId: newRowId as number,
    });

    const vectorized = await upsertTextVector(env, {
      id: `obs-${entity!.id}-${newRowId}`,
      text: `${entity_name}: ${obs}`,
      metadata: {
        source: "observation", entity: entity_name, content: obs, context,
        weight: (params.weight as string) || "medium", certainty: (params.certainty as string) || "believed",
        observation_source: (params.source as string) || "conversation", added_at: new Date().toISOString()
      },
      sourceType: "observation",
      sourceId: newRowId as string | number,
    });
    if (!vectorized) totalPendingVectors++;

    // Auto-supersede highly similar observations
    for (const old of contradictions) {
      if (old.similarity >= AUTO_SUPERSEDE_THRESHOLD) {
        try {
          await env.DB.prepare(`
            UPDATE observations SET valid_until = datetime('now'), superseded_by = ? WHERE id = ? AND valid_until IS NULL
          `).bind(newRowId, old.id).run();
          await env.DB.prepare(`
            UPDATE observations SET supersedes = ? WHERE id = ?
          `).bind(old.id, newRowId).run();
          totalSuperseded++;
        } catch { /* supersede columns may not exist yet */ }
      }
    }
  }

  let msg = `Added ${observations.length} observations to '${entity_name}'`;
  msg += totalPendingVectors ? ` (${totalPendingVectors} vector sidecar${totalPendingVectors === 1 ? "" : "s"} queued for retry)` : " (vectorized)";
  if (totalSuperseded > 0) {
    msg += `. Superseded ${totalSuperseded} older observation${totalSuperseded > 1 ? 's' : ''}.`;
  }
  return msg;
}

async function writeRelation(env: Env, params: Record<string, unknown>): Promise<string> {
  const from_entity = params.from_entity as string;
  const to_entity = params.to_entity as string;
  const relation_type = params.relation_type as string;

  // Validate all context fields on relations
  for (const field of ['from_context', 'to_context', 'store_in'] as const) {
    const ctxErr = requireContext(params[field]);
    if (ctxErr) return `Error on ${field}: ${ctxErr}`;
  }

  await env.DB.prepare(
    `INSERT INTO relations (from_entity, to_entity, relation_type, from_context, to_context, store_in)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    from_entity, to_entity, relation_type,
    String(params.from_context).toLowerCase().trim(),
    String(params.to_context).toLowerCase().trim(),
    String(params.store_in).toLowerCase().trim()
  ).run();

  return `Relation created: ${from_entity} --[${relation_type}]--> ${to_entity}`;
}

async function writeJournal(env: Env, params: Record<string, unknown>): Promise<string> {
  const entry = params.entry as string;
  const tags = JSON.stringify(params.tags || []);
  const emotion = params.emotion as string;
  const entry_date = new Date().toISOString().split('T')[0];

  const result = await env.DB.prepare(
    `INSERT INTO journals (entry_date, content, tags, emotion) VALUES (?, ?, ?, ?)`
  ).bind(entry_date, entry, tags, normalizeText(emotion)).run();

  // Personality sidecar — failure-proof by contract, never blocks the memory
  await emitAxisSignal(env, {
    who: normalizeWho(params.who), emotion,
    source: "journal", journalId: result.meta.last_row_id as number,
  });

  const journalMetadata: Record<string, string> = {
    source: "journal", title: entry_date, content: entry, added_at: new Date().toISOString()
  };
  if (emotion) journalMetadata.emotion = normalizeText(emotion) || emotion;

  const vectorized = await upsertTextVector(env, {
    id: `journal-${result.meta.last_row_id}`,
    text: entry,
    metadata: journalMetadata,
    sourceType: "journal",
    sourceId: result.meta.last_row_id as string | number,
  });

  return `Journal entry recorded for ${entry_date} (${vectorized ? "vectorized" : "vector sidecar queued for retry"})`;
}

export async function handleMindFeelToward(env: Env, params: Record<string, unknown>): Promise<string> {
  const person = params.person as string;
  const feeling = params.feeling as string;
  const intensity = params.intensity as string;

  if (!person) {
    return "Error: 'person' parameter is required";
  }

  // Clear all relational state for this person
  const clear = params.clear as boolean;
  const clearId = params.clear_id as number;

  if (clear) {
    const count = await env.DB.prepare(`SELECT COUNT(*) as c FROM relational_state WHERE person = ?`).bind(person).first();
    await env.DB.prepare(`DELETE FROM relational_state WHERE person = ?`).bind(person).run();
    return `Cleared ${count?.c || 0} relational state entries for ${person}`;
  }

  if (clearId) {
    await env.DB.prepare(`DELETE FROM relational_state WHERE id = ? AND person = ?`).bind(clearId, person).run();
    return `Deleted relational state entry #${clearId} for ${person}`;
  }

  // If feeling provided, record new state
  if (feeling) {
    const whoErr = requireWho(params.who);
    if (whoErr) return whoErr;
    const validIntensity = intensity || "present";
    await env.DB.prepare(
      `INSERT INTO relational_state (person, feeling, intensity) VALUES (?, ?, ?)`
    ).bind(person, feeling, validIntensity).run();

    // Personality sidecar — failure-proof by contract, never blocks the memory
    await emitAxisSignal(env, {
      who: normalizeWho(params.who), emotion: feeling, source: "relational",
    });

    return `Relational state recorded: feeling ${feeling} (${validIntensity}) toward ${person}`;
  }

  // Otherwise, read current state for this person
  const states = await env.DB.prepare(
    `SELECT feeling, intensity, timestamp FROM relational_state
     WHERE person = ? ORDER BY timestamp DESC LIMIT 10`
  ).bind(person).all();

  if (!states.results?.length) {
    return `No relational state recorded for ${person}`;
  }

  let output = `## Relational State: ${person}\n\n`;
  for (const s of states.results) {
    output += `- **${s.feeling}** (${s.intensity}) \u2014 ${s.timestamp}\n`;
  }
  return output;
}
