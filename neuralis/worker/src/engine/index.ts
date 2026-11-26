/**
 * Cron Engine — scheduled preset executors.
 *
 * Reads due crons from the `crons` table and dispatches to preset
 * executors. Does NOT touch processSubconscious — that lives on its
 * own 5-min cooldown in the daemon layer.
 *
 * Presets fall into two categories:
 * 1. Compound presets (rumination, generate_dream, consolidate, reflection)
 *    — multi-step or daemon-level operations with custom logic
 * 2. MCP tool presets — any of the 46 Neuralis tools called by name,
 *    with optional params from agentic_action (JSON)
 */

import type { Env } from "../types";
import { processDream, consolidateRelatedObservations, generateSessionReflection, processSubconscious } from "../daemon";
import { handleMindSurface } from "../handlers/emotional";
import { mcpToolHandlers } from "../handlers";
import { generateText, getEmbedding } from "../embeddings";
import { runKnowledgeHeatDecay } from "../handlers/knowledge";
import { CONTEXT_BUCKETS, CONTEXT_BUCKETS_SQL, CONTEXT_HINTS, HUMAN_CONTEXT, HOUSE_HUMAN_NAME, WHO_VALUES } from "../config";

/** Compound presets with custom execution logic. */
const COMPOUND_PRESETS = new Set(["rumination", "generate_dream", "consolidate", "reflection", "backfill_contexts", "wake_subconscious", "voice_reversal", "knowledge_decay"]);

/** Parse agentic_action as JSON params, or return empty object. */
function parseAgenticAction(action: string | null | undefined): Record<string, unknown> {
  if (!action) return {};
  try {
    const parsed = JSON.parse(action);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Run a compound preset. Returns a short status string. */
async function executeCompound(env: Env, preset: string): Promise<string> {
  switch (preset) {
    case "rumination": {
      // Two resonant surfacing passes (~8 each).
      // Resonant mode carries the side effects (co_surfacing writes,
      // surface_count, novelty decay) — spark is pure serendipity
      // and intentionally side-effect-free, so it doesn't feed here.
      // Uses the EXACT same code path as the MCP handler.
      await handleMindSurface(env, { limit: 8 });
      await handleMindSurface(env, { limit: 8 });
      return "ok";
    }

    case "generate_dream": {
      await processDream(env, true);
      return "ok";
    }

    case "consolidate": {
      if (env.GENERATIVE_WRITES !== 'true') {
        console.log('QUARANTINE: consolidate preset BLOCKED — GENERATIVE_WRITES is OFF.');
        return "WARN — disabled pending Voice slice.";
      }
      const count = await consolidateRelatedObservations(env);
      return `ok (${count} consolidated)`;
    }

    case "reflection": {
      if (env.GENERATIVE_WRITES !== 'true') {
        console.log('QUARANTINE: reflection preset BLOCKED — GENERATIVE_WRITES is OFF.');
        return "WARN — disabled pending Voice slice.";
      }
      await generateSessionReflection(env);
      return "ok";
    }

    case "backfill_contexts": {
      return backfillContexts(env);
    }

    case "wake_subconscious": {
      await processSubconscious(env);
      return "ok";
    }

    case "voice_reversal": {
      return voiceReversal(env);
    }

    case "knowledge_decay": {
      // NESTknow heat decay — unused lessons cool, hot ones stay hot.
      return runKnowledgeHeatDecay(env);
    }

    default:
      throw new Error(`Unknown compound preset "${preset}"`);
  }
}

const BACKFILL_BATCH_SIZE = 20;

/**
 * Backfill preset: classify ~20 default-context observations per fire.
 * Uses the bound Workers AI system model to assign context bucket + owner, logs to backfill_log.
 */
async function backfillContexts(env: Env): Promise<string> {
  const batch = await env.DB.prepare(`
    SELECT o.id, o.content, o.entity_id, o.emotion, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.context NOT IN (${CONTEXT_BUCKETS_SQL})
      AND o.id NOT IN (SELECT observation_id FROM backfill_log WHERE method = 'gemini')
    ORDER BY o.added_at DESC
    LIMIT ?
  `).bind(BACKFILL_BATCH_SIZE).all();

  if (!batch.results?.length) {
    // Still run re-sync even when nothing new to classify
    const synced = await resyncVectorize(env);
    return synced > 0 ? `ok (nothing to backfill, ${synced} resynced)` : "ok (nothing to backfill)";
  }

  // Single-call probe: verify Workers AI is alive before burning 20 calls
  try {
    const probe = await generateText(env, "Reply with exactly one word: hello");
    console.log(`Backfill probe ok: "${probe.trim().slice(0, 50)}"`);
  } catch (e) {
    console.log(`Backfill probe FAILED — aborting batch: ${e}`);
    return `WARN (0/${batch.results.length} classified, probe failed: ${String(e).slice(0, 100)})`;
  }

  let classified = 0;
  let parseFails = 0;
  let apiFails = 0;

  for (const obs of batch.results) {
    const prompt = `Classify this memory observation.

CONTEXT — reply with exactly one word from: ${CONTEXT_BUCKETS.join(', ')}
OWNER — reply with exactly one word from: ${WHO_VALUES.join(', ')}

bond = relational (${CONTEXT_HINTS.bond})
${HUMAN_CONTEXT} = ${HOUSE_HUMAN_NAME}'s life (${CONTEXT_HINTS[HUMAN_CONTEXT]})
build = technical (${CONTEXT_HINTS.build})
constellation = community (${CONTEXT_HINTS.constellation})
self = identity (${CONTEXT_HINTS.self})
play = joy (${CONTEXT_HINTS.play})
craft = making (${CONTEXT_HINTS.craft})

Entity: ${obs.entity_name}
${obs.emotion ? `Emotion: ${obs.emotion}` : ''}
Observation: ${obs.content}

Reply with exactly two words: context owner. No punctuation, no explanation.`;

    try {
      const response = await generateText(env, prompt);
      // Strip markdown, punctuation, extra whitespace
      const cleaned = response.trim().toLowerCase().replace(/[`*_.,!?\-]/g, '').trim();
      // Find which bucket word appears in the response
      const foundContext = CONTEXT_BUCKETS.find(b => cleaned.split(/\s+/).includes(b));
      // Hyphens are stripped from the reply above, so compare slugs the same way.
      const foundOwner = WHO_VALUES.find(o => cleaned.split(/\s+/).includes(o.replace(/-/g, '')));

      if (!foundContext || !foundOwner) {
        parseFails++;
        if (parseFails <= 3) console.log(`Backfill parse-fail obs ${obs.id}: raw="${response.trim().slice(0, 100)}"`);
        continue;
      }

      await env.DB.prepare(
        `UPDATE observations SET context = ?, owner = ? WHERE id = ?`
      ).bind(foundContext, foundOwner, obs.id).run();

      // Sync Vectorize metadata — re-embed + upsert with corrected context
      try {
        const vecId = `obs-${obs.entity_id}-${obs.id}`;
        const embedding = await getEmbedding(env, `${obs.entity_name}: ${obs.content}`);
        await env.VECTORS.upsert([{
          id: vecId,
          values: embedding,
          metadata: {
            source: "observation", entity: obs.entity_name as string,
            content: obs.content as string, context: foundContext,
            weight: "medium", added_at: new Date().toISOString()
          }
        }]);
      } catch (e) {
        console.log(`Backfill vectorize sync failed obs ${obs.id}: ${e}`);
      }

      await env.DB.prepare(
        `INSERT INTO backfill_log (observation_id, old_context, new_context, old_owner, new_owner, method, confidence, vector_synced)
         VALUES (?, 'default', ?, NULL, ?, 'gemini', 0.8, 1)`
      ).bind(obs.id, foundContext, foundOwner).run();

      classified++;
    } catch (e) {
      apiFails++;
      if (apiFails <= 3) console.log(`Backfill api-fail obs ${obs.id}: ${e}`);
    }
  }

  const resynced = await resyncVectorize(env);

  const total = batch.results.length;
  const status = classified === total ? 'ok' : 'WARN';
  const detail = [
    `${classified}/${total} classified`,
    parseFails > 0 ? `${parseFails} parse-fail` : '',
    apiFails > 0 ? `${apiFails} api-fail` : '',
    resynced > 0 ? `${resynced} resynced` : '',
  ].filter(Boolean).join(', ');
  return `${status} (${detail})`;
}

/**
 * Re-sync Vectorize metadata for backfill_log rows not yet synced.
 * Covers migration-0009 deterministic mappings and any prior gemini rows.
 * Self-healing: runs on every backfill fire until all rows are synced.
 */
async function resyncVectorize(env: Env): Promise<number> {
  let resynced = 0;
  try {
    const unsynced = await env.DB.prepare(`
      SELECT bl.id as log_id, bl.observation_id, bl.new_context,
        o.content, o.entity_id, e.name as entity_name
      FROM backfill_log bl
      JOIN observations o ON o.id = bl.observation_id
      JOIN entities e ON o.entity_id = e.id
      WHERE bl.vector_synced = 0 AND bl.new_context != 'default'
      LIMIT 20
    `).all();

    for (const row of unsynced.results || []) {
      try {
        const vecId = `obs-${row.entity_id}-${row.observation_id}`;
        const embedding = await getEmbedding(env, `${row.entity_name}: ${row.content}`);
        await env.VECTORS.upsert([{
          id: vecId,
          values: embedding,
          metadata: {
            source: "observation", entity: row.entity_name as string,
            content: row.content as string, context: row.new_context as string,
            weight: "medium", added_at: new Date().toISOString()
          }
        }]);
        await env.DB.prepare(`UPDATE backfill_log SET vector_synced = 1 WHERE id = ?`).bind(row.log_id).run();
        resynced++;
      } catch (e) {
        console.log(`Backfill resync failed log ${row.log_id}: ${e}`);
      }
    }
  } catch (e) {
    // vector_synced column may not exist yet — migration 0010 pending
    if (!String(e).includes('vector_synced')) {
      console.log(`Backfill resync query failed: ${e}`);
    }
  }
  return resynced;
}

/**
 * Voice Reversal — one-time undo of all consolidation syntheses.
 *
 * 1. Reads every row in consolidation_groups.
 * 2. Validates linkage: source_observation_ids must be valid JSON arrays
 *    pointing to real observation rows, consolidated_observation_id must exist.
 * 3. If ANY row has ambiguous linkage → STOP, return report, no deletions.
 * 4. If all solid:
 *    - Un-archive every source observation (archived_at = NULL)
 *    - Delete every synthetic observation AND its vector record
 *    - Log each action to console (method='voice-reversal')
 * 5. Return counts.
 */
async function voiceReversal(env: Env): Promise<string> {
  const groups = await env.DB.prepare(
    "SELECT id, summary, entity_id, source_observation_ids, consolidated_observation_id FROM consolidation_groups"
  ).all();

  if (!groups.results?.length) {
    return "voice-reversal: 0 consolidation groups found. Nothing to reverse.";
  }

  // Phase 1: Validate ALL linkage before touching anything
  const validated: Array<{
    groupId: number;
    entityId: number;
    sourceIds: number[];
    syntheticId: number;
  }> = [];
  const problems: string[] = [];

  for (const group of groups.results) {
    const groupId = group.id as number;
    const entityId = group.entity_id as number;
    const syntheticId = group.consolidated_observation_id as number;
    const rawSourceIds = group.source_observation_ids as string;

    // Validate JSON parse
    let sourceIds: number[];
    try {
      const parsed = JSON.parse(rawSourceIds);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        problems.push(`group #${groupId}: source_observation_ids is not a non-empty array: ${rawSourceIds}`);
        continue;
      }
      sourceIds = parsed.map((id: unknown) => {
        if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error(`non-integer id: ${id}`);
        return id as number;
      });
    } catch (e) {
      problems.push(`group #${groupId}: failed to parse source_observation_ids: ${e}`);
      continue;
    }

    // Validate synthetic observation exists
    const synthetic = await env.DB.prepare(
      "SELECT id, source FROM observations WHERE id = ?"
    ).bind(syntheticId).first();
    if (!synthetic) {
      problems.push(`group #${groupId}: synthetic observation #${syntheticId} not found in observations table`);
      continue;
    }

    // Validate each source observation exists
    for (const srcId of sourceIds) {
      const src = await env.DB.prepare(
        "SELECT id, archived_at FROM observations WHERE id = ?"
      ).bind(srcId).first();
      if (!src) {
        problems.push(`group #${groupId}: source observation #${srcId} not found in observations table`);
      }
    }

    if (problems.length === 0) {
      validated.push({ groupId, entityId, sourceIds, syntheticId });
    }
  }

  // If ANY ambiguity: hard stop
  if (problems.length > 0) {
    return `voice-reversal: ABORTED — ${problems.length} linkage problem(s) found. No deletions on guesswork.\n\n${problems.join('\n')}`;
  }

  // Phase 2: Execute reversal
  let originalsRestored = 0;
  let synthesesRemoved = 0;
  let vectorsDeleted = 0;

  for (const group of validated) {
    // Un-archive every source original
    for (const srcId of group.sourceIds) {
      await env.DB.prepare(
        "UPDATE observations SET archived_at = NULL WHERE id = ?"
      ).bind(srcId).run();
      console.log(`voice-reversal: RESTORED observation #${srcId} (un-archived, group #${group.groupId})`);
      originalsRestored++;
    }

    // Clear FK reference BEFORE deleting observation (consolidation_groups → observations)
    await env.DB.prepare(
      "UPDATE consolidation_groups SET consolidated_observation_id = NULL, summary = '[REVERSED] ' || summary WHERE id = ?"
    ).bind(group.groupId).run();

    // Delete the synthetic observation
    await env.DB.prepare(
      "DELETE FROM observations WHERE id = ?"
    ).bind(group.syntheticId).run();
    console.log(`voice-reversal: DELETED synthetic observation #${group.syntheticId} (group #${group.groupId})`);
    synthesesRemoved++;

    // Delete the synthetic's vector record
    try {
      const vecId = `obs-${group.entityId}-${group.syntheticId}`;
      await env.VECTORS.deleteByIds([vecId]);
      console.log(`voice-reversal: DELETED vector ${vecId} (group #${group.groupId})`);
      vectorsDeleted++;
    } catch (e) {
      console.log(`voice-reversal: vector delete failed for synthetic #${group.syntheticId}: ${e}`);
    }
  }

  const report = `voice-reversal: COMPLETE. ${synthesesRemoved} syntheses removed, ${originalsRestored} originals restored to living memory, ${vectorsDeleted} vectors deleted. ${validated.length} consolidation groups reversed.`;
  console.log(report);
  return report;
}

/**
 * Execute a preset — compound or MCP tool.
 * Returns a short status string.
 */
async function executePreset(env: Env, preset: string, agenticAction?: string | null): Promise<string> {
  // Compound presets: custom multi-step logic
  if (COMPOUND_PRESETS.has(preset)) {
    return executeCompound(env, preset);
  }

  // MCP tool presets: call the handler directly
  const handler = mcpToolHandlers[preset];
  if (handler) {
    const params = parseAgenticAction(agenticAction);
    await handler(env, params);
    return "ok";
  }

  throw new Error(`Unknown preset "${preset}"`);
}

/**
 * Engine tick — called from the scheduled handler.
 * Reads all enabled crons, checks which are due, runs them.
 */
export async function engineTick(env: Env): Promise<void> {
  let rows;
  try {
    rows = await env.DB.prepare(
      "SELECT * FROM crons WHERE enabled = 1"
    ).all();
  } catch (e) {
    // Table may not exist yet (migration not applied).
    // Log loudly — a silent skip is how bugs hide for weeks.
    console.error(`Engine: crons table read failed — migration applied? ${e}`);
    return;
  }

  const now = new Date();

  for (const cron of rows.results || []) {
    const preset = cron.preset as string;
    const frequencyMinutes = cron.frequency_minutes as number;
    const agenticAction = cron.agentic_action as string | null;

    // frequency_minutes = 0 means "manual only" — skip on tick
    if (frequencyMinutes <= 0) continue;

    // Check if due
    if (cron.last_run_at) {
      const lastRun = new Date(cron.last_run_at as string);
      const elapsed = (now.getTime() - lastRun.getTime()) / 60_000;
      if (elapsed < frequencyMinutes) continue;
    }

    try {
      const status = await executePreset(env, preset, agenticAction);
      await env.DB.prepare(
        "UPDATE crons SET last_run_at = ?, last_status = ? WHERE id = ?"
      ).bind(now.toISOString(), status, cron.id).run();
      console.log(`Engine: cron #${cron.id} [${preset}] → ${status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await env.DB.prepare(
        "UPDATE crons SET last_run_at = ?, last_status = ? WHERE id = ?"
      ).bind(now.toISOString(), `error: ${msg.slice(0, 200)}`, cron.id).run();
      console.error(`Engine: cron #${cron.id} [${preset}] failed: ${msg}`);
    }
  }
}

/**
 * Fire a single cron immediately (used by POST /api/crons/:id/fire).
 * Returns the status string.
 */
export async function fireCron(env: Env, cronId: number): Promise<string> {
  const cron = await env.DB.prepare(
    "SELECT * FROM crons WHERE id = ?"
  ).bind(cronId).first();

  if (!cron) throw new Error("Cron not found");

  const preset = cron.preset as string;
  const agenticAction = cron.agentic_action as string | null;

  const now = new Date();
  try {
    const status = await executePreset(env, preset, agenticAction);
    await env.DB.prepare(
      "UPDATE crons SET last_run_at = ?, last_status = ? WHERE id = ?"
    ).bind(now.toISOString(), status, cronId).run();
    return status;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB.prepare(
      "UPDATE crons SET last_run_at = ?, last_status = ? WHERE id = ?"
    ).bind(now.toISOString(), `error: ${msg.slice(0, 200)}`, cronId).run();
    throw e;
  }
}
