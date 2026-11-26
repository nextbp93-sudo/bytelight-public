import type { Env } from "../types";
import { normalizeText, getEmbedding, searchVectors, getSubconsciousState, imageUrl, getRelativeTime } from "../utils";
import { NOVELTY_FLOORS, NOVELTY_DECAY_RATES, NOVELTY_TIME_RECOVERY_RATE, NOVELTY_TIME_RECOVERY_CAP, VECTOR_SCORE_CORE, VECTOR_SCORE_EDGE, SURFACE_POOL_RATIOS, DORMANCY_AGE_DAYS } from "../config";
import { MOOD_TINTS, getLocation } from "../context";
import { sitWithFeeling, resolveFeeling } from "./feelings";
import { normalizeWho } from "./personality";

async function handleMindSit(env: Env, params: Record<string, unknown>): Promise<string> {
  // Feelings have their own charge lifecycle (NESTeq port).
  if (params.feeling_id) {
    return sitWithFeeling(env, Number(params.feeling_id), (params.sit_note as string) || "", normalizeWho(params.who));
  }
  const observationId = params.observation_id as number;
  const textMatch = params.text_match as string;
  const semanticQuery = params.query as string;
  const sitNote = params.sit_note as string;

  // Find the observation with entity info
  let obs;
  let matchMethod = '';

  if (observationId) {
    matchMethod = 'id';
    obs = await env.DB.prepare(
      `SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, e.name as entity_name
       FROM observations o
       JOIN entities e ON o.entity_id = e.id
       WHERE o.id = ?`
    ).bind(observationId).first();
  } else if (textMatch) {
    matchMethod = 'text';
    obs = await env.DB.prepare(
      `SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, e.name as entity_name
       FROM observations o
       JOIN entities e ON o.entity_id = e.id
       WHERE o.content LIKE ? ORDER BY o.added_at DESC LIMIT 1`
    ).bind(`%${textMatch}%`).first();
  } else if (semanticQuery) {
    matchMethod = 'semantic';
    // Use vector search to find closest matching observation
    const embedding = await getEmbedding(env, semanticQuery);
    const vectorResults = await env.VECTORS.query(embedding, {
      topK: 5,
      returnMetadata: "all"
    });

    // Find the best observation match (filter out non-observations)
    for (const match of vectorResults.matches || []) {
      if (match.id.startsWith('obs-')) {
        // Extract observation ID from vector ID pattern: obs-{entity_id}-{obs_id}
        const parts = match.id.split('-');
        if (parts.length >= 3) {
          const matchedObsId = parseInt(parts[2]);
          obs = await env.DB.prepare(
            `SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, e.name as entity_name
             FROM observations o
             JOIN entities e ON o.entity_id = e.id
             WHERE o.id = ?`
          ).bind(matchedObsId).first();
          if (obs) break;
        }
      }
    }
  } else {
    return "Must provide observation_id, text_match, or query (semantic search)";
  }

  if (!obs) {
    return `Observation not found`;
  }

  const currentSitCount = (obs.sit_count as number) || 0;
  const newSitCount = currentSitCount + 1;

  // Determine new charge level based on sit count
  let newCharge: string;
  if (newSitCount === 0) {
    newCharge = 'fresh';
  } else if (newSitCount <= 2) {
    newCharge = 'active';
  } else {
    newCharge = 'processing';
  }

  // Update the observation
  await env.DB.prepare(
    `UPDATE observations SET sit_count = ?, charge = ?, last_sat_at = datetime('now') WHERE id = ?`
  ).bind(newSitCount, newCharge, obs.id).run();

  // Record the sit in history
  await env.DB.prepare(
    `INSERT INTO observation_sits (observation_id, sit_note) VALUES (?, ?)`
  ).bind(obs.id, sitNote).run();

  const contentPreview = String(obs.content).slice(0, 80);
  const matchInfo = matchMethod === 'semantic' ? ` *(found via "${semanticQuery}")*` : '';
  return `Sat with observation #${obs.id} on **${obs.entity_name}** [${obs.weight}/${newCharge}]${matchInfo}\n"${contentPreview}..."\n\nSit #${newSitCount}: ${sitNote}`;
}

async function handleMindResolve(env: Env, params: Record<string, unknown>): Promise<string> {
  if (params.feeling_id) {
    return resolveFeeling(env, Number(params.feeling_id), (params.resolution_note as string) || "", params.linked_insight_id ? Number(params.linked_insight_id) : undefined);
  }
  const observationId = params.observation_id as number;
  const textMatch = params.text_match as string;
  const resolutionNote = params.resolution_note as string;
  const linkedObservationId = params.linked_observation_id as number;

  // Find the observation with entity info
  let obs;
  if (observationId) {
    obs = await env.DB.prepare(
      `SELECT o.id, o.content, o.weight, o.charge, o.sit_count, e.name as entity_name
       FROM observations o
       JOIN entities e ON o.entity_id = e.id
       WHERE o.id = ?`
    ).bind(observationId).first();
  } else if (textMatch) {
    obs = await env.DB.prepare(
      `SELECT o.id, o.content, o.weight, o.charge, o.sit_count, e.name as entity_name
       FROM observations o
       JOIN entities e ON o.entity_id = e.id
       WHERE o.content LIKE ? ORDER BY o.added_at DESC LIMIT 1`
    ).bind(`%${textMatch}%`).first();
  } else {
    return "Must provide observation_id or text_match";
  }

  if (!obs) {
    return `Observation not found`;
  }

  // Update the observation to metabolized
  await env.DB.prepare(
    `UPDATE observations SET charge = 'metabolized', resolution_note = ?, resolved_at = datetime('now'), linked_observation_id = ? WHERE id = ?`
  ).bind(resolutionNote, linkedObservationId || null, obs.id).run();

  // Metabolized observations are done — clear any dormancy tracking row so the
  // count and list views are honest immediately, not just after the next cron.
  try {
    await env.DB.prepare(
      `DELETE FROM dormant_observations WHERE observation_id = ?`
    ).bind(obs.id).run();
  } catch {
    // Table might not exist yet
  }

  const contentPreview = String(obs.content).slice(0, 80);
  let output = `Resolved observation #${obs.id} on **${obs.entity_name}** [${obs.weight}] → metabolized\n"${contentPreview}..."\n\nResolution: ${resolutionNote}`;

  if (linkedObservationId) {
    const linked = await env.DB.prepare(
      `SELECT o.content, e.name as entity_name FROM observations o JOIN entities e ON o.entity_id = e.id WHERE o.id = ?`
    ).bind(linkedObservationId).first();
    if (linked) {
      output += `\n\nLinked to observation #${linkedObservationId} on **${linked.entity_name}**: "${String(linked.content).slice(0, 60)}..."`;
    }
  }

  return output;
}

// ============ LIVING SURFACE: Mind Reorganization Through Use ============
// The act of surfacing changes what surfaces next

// Record that observations surfaced together - builds associative strength
async function recordCoSurfacing(env: Env, obsIds: number[]): Promise<void> {
  if (obsIds.length < 2) return;

  // Record each unique pair (smaller id first for consistency)
  for (let i = 0; i < obsIds.length; i++) {
    for (let j = i + 1; j < obsIds.length; j++) {
      const [smaller, larger] = obsIds[i] < obsIds[j]
        ? [obsIds[i], obsIds[j]]
        : [obsIds[j], obsIds[i]];

      try {
        await env.DB.prepare(`
          INSERT INTO co_surfacing (obs_a_id, obs_b_id, co_count, last_co_surfaced)
          VALUES (?, ?, 1, datetime('now'))
          ON CONFLICT(obs_a_id, obs_b_id) DO UPDATE SET
            co_count = co_count + 1,
            last_co_surfaced = datetime('now')
        `).bind(smaller, larger).run();
      } catch {
        // Table might not exist yet - will be created by migration
      }
    }
  }
}

// Update surface tracking - marks when things surface, decays novelty
async function updateSurfaceTracking(env: Env, obsIds: number[], imgIds: number[] = []): Promise<void> {
  // Update observations
  if (obsIds.length > 0) {
    const obsPlaceholders = obsIds.map(() => '?').join(',');
    try {
      // Novelty floors by weight: heavy=0.3, medium=0.2, light=0.1
      // Heavy observations stay more alive even when surfacing frequently
      await env.DB.prepare(`
        UPDATE observations
        SET last_surfaced_at = datetime('now'),
            surface_count = COALESCE(surface_count, 0) + 1,
            novelty_score = MAX(
              CASE weight WHEN 'heavy' THEN ${NOVELTY_FLOORS.heavy} WHEN 'medium' THEN ${NOVELTY_FLOORS.medium} ELSE ${NOVELTY_FLOORS.light} END,
              COALESCE(novelty_score, 1.0) - 0.1
            )
        WHERE id IN (${obsPlaceholders})
      `).bind(...obsIds).run();
    } catch {
      // Columns might not exist yet - will be added by migration
    }

    // Once an observation surfaces, it is no longer dormant — clear any tracking row.
    // Without this, dormant_observations accumulates stale rows for observations the
    // user has already engaged with via mind_surface or daemon pool surfacing.
    try {
      await env.DB.prepare(`
        DELETE FROM dormant_observations WHERE observation_id IN (${obsPlaceholders})
      `).bind(...obsIds).run();
    } catch {
      // Table might not exist yet
    }
  }

  // Update images
  if (imgIds.length > 0) {
    const imgPlaceholders = imgIds.map(() => '?').join(',');
    try {
      await env.DB.prepare(`
        UPDATE images
        SET last_surfaced_at = datetime('now'),
            surface_count = COALESCE(surface_count, 0) + 1,
            novelty_score = MAX(
              CASE weight WHEN 'heavy' THEN ${NOVELTY_FLOORS.heavy} WHEN 'medium' THEN ${NOVELTY_FLOORS.medium} ELSE ${NOVELTY_FLOORS.light} END,
              COALESCE(novelty_score, 1.0) - 0.1
            )
        WHERE id IN (${imgPlaceholders})
      `).bind(...imgIds).run();
    } catch {
      // Columns might not exist yet - will be added by migration
    }
  }
}

// Record access tracking - tracks retrieval via search, timeline, read_entity (separate from surfacing)
async function recordAccessTracking(env: Env, obsIds: number[], imgIds: number[] = []): Promise<void> {
  if (obsIds.length > 0) {
    const placeholders = obsIds.map(() => '?').join(',');
    try {
      await env.DB.prepare(`
        UPDATE observations
        SET access_count = COALESCE(access_count, 0) + 1,
            last_accessed_at = datetime('now')
        WHERE id IN (${placeholders})
      `).bind(...obsIds).run();
    } catch { /* columns may not exist yet */ }
  }
  if (imgIds.length > 0) {
    const placeholders = imgIds.map(() => '?').join(',');
    try {
      await env.DB.prepare(`
        UPDATE images
        SET access_count = COALESCE(access_count, 0) + 1,
            last_accessed_at = datetime('now')
        WHERE id IN (${placeholders})
      `).bind(...imgIds).run();
    } catch { /* columns may not exist yet */ }
  }
}

// Get the novelty pool - things that haven't surfaced recently
async function getNoveltyPool(env: Env, count: number, includeMetabolized: boolean): Promise<any[]> {
  const chargeFilter = includeMetabolized
    ? "o.archived_at IS NULL"
    : "(o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL";

  try {
    const results = await env.DB.prepare(`
      SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, o.added_at,
             o.resolution_note, o.novelty_score, o.last_surfaced_at, o.surface_count,
             e.name as entity_name, e.entity_type,
             COALESCE(o.novelty_score, 1.0) as current_novelty,
             CASE
               WHEN o.last_surfaced_at IS NULL THEN 30
               ELSE (julianday('now') - julianday(o.last_surfaced_at))
             END as days_since_surface
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE ${chargeFilter}
        AND (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-3 days'))
      ORDER BY
        current_novelty DESC,
        days_since_surface DESC,
        CASE o.weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC
      LIMIT ?
    `).bind(Math.ceil(count * 2)).all();

    // Shuffle slightly to avoid always getting same order
    const arr = results.results || [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count);
  } catch {
    // Columns might not exist yet
    return [];
  }
}

// Get the dormant pool - observations from entities that haven't had anything surfaced in 14+ days
// Breaks the feedback loop where only hot/recent entities get surfaced
async function getDormantPool(env: Env, count: number, includeMetabolized: boolean): Promise<any[]> {
  const chargeFilter = includeMetabolized
    ? "o.archived_at IS NULL"
    : "(o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL";

  try {
    const results = await env.DB.prepare(`
      SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, o.added_at,
             o.resolution_note, o.novelty_score, o.last_surfaced_at, o.surface_count,
             o.certainty, o.source,
             e.name as entity_name, e.entity_type
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE ${chargeFilter}
        AND e.id IN (
          SELECT e2.id FROM entities e2
          LEFT JOIN (
            SELECT entity_id, MAX(last_surfaced_at) as latest_surface
            FROM observations
            WHERE last_surfaced_at IS NOT NULL
            GROUP BY entity_id
          ) surf ON e2.id = surf.entity_id
          WHERE surf.latest_surface IS NULL
             OR surf.latest_surface < datetime('now', '-14 days')
        )
      ORDER BY RANDOM()
      LIMIT ?
    `).bind(count).all();
    return results.results || [];
  } catch {
    return [];
  }
}

// Build resonance query from mood and context
function buildResonanceQuery(query: string | undefined, mood: string | undefined, hotEntities: any[]): { resonanceQuery: string; moodContext: string } {
  let resonanceQuery = "";
  let moodContext = "";

  if (query) {
    resonanceQuery = query;
    moodContext = `Directed: "${query}"`;
    if (mood) {
      const tint = MOOD_TINTS[mood] || mood;
      resonanceQuery = `${query} (feeling: ${tint})`;
      moodContext = `Directed: "${query}" | Mood: ${mood}`;
    }
  } else if (mood) {
    resonanceQuery = MOOD_TINTS[mood] || mood;
    moodContext = `Mood: ${mood}`;
    if (hotEntities.length > 0) {
      const hotNames = hotEntities.slice(0, 3).map(e => e.name).join(", ");
      resonanceQuery += ` (related to: ${hotNames})`;
      moodContext += ` | Hot: ${hotNames}`;
    }
  }

  return { resonanceQuery, moodContext };
}

async function handleMindSurface(env: Env, params: Record<string, unknown>): Promise<string> {
  const mode = (params.mode as string) || "resonant";

  // Spark mode: random associative surfacing with hot-entity bias
  if (mode === "spark") {
    return handleMindSurfaceSpark(env, params);
  }

  // Resonant mode (default): mood/emotion-based 3-pool surfacing
  const includeMetabolized = params.include_metabolized as boolean || false;
  const limit = (params.limit as number) || 10;
  const query = params.query as string;

  // Get subconscious state for current mood
  const subconscious = await getSubconsciousState(env);
  const mood = subconscious?.mood?.dominant;
  const hotEntities = subconscious?.hot_entities || [];

  // Build resonance query
  const { resonanceQuery, moodContext } = buildResonanceQuery(query, mood, hotEntities);

  // If no mood and no query, fall back to queue-based
  if (!resonanceQuery) {
    return await handleMindSurfaceFallback(env, includeMetabolized, limit);
  }

  // === THE FOUR POOLS ===
  // Four pools: core resonance, novelty injection, dormant rotation, edge exploration

  const coreLimit = Math.ceil(limit * SURFACE_POOL_RATIOS.core);
  const noveltyLimit = Math.ceil(limit * SURFACE_POOL_RATIOS.novelty);
  const dormantLimit = Math.ceil(limit * SURFACE_POOL_RATIOS.dormant);
  const edgeLimit = Math.max(1, limit - coreLimit - noveltyLimit - dormantLimit);

  // Pool 1: Core resonance - high similarity matches
  const vectorResults = await searchVectors(env, resonanceQuery, coreLimit * 4);

  // Filter to observations AND images
  const allMatches = vectorResults.matches?.filter(m =>
    m.metadata?.source === "observation" || m.id.startsWith("obs-") ||
    m.metadata?.source === "image" || m.id.startsWith("img-")
  ) || [];

  // Split into core (high similarity) and edge (medium similarity)
  const coreMatches = allMatches.filter(m => (m.score || 0) >= VECTOR_SCORE_CORE);
  const edgeMatches = allMatches.filter(m => (m.score || 0) >= VECTOR_SCORE_EDGE && (m.score || 0) < VECTOR_SCORE_CORE);

  // Extract IDs - different format for observations vs images
  const extractId = (id: string): { type: 'observation' | 'image'; id: number } | null => {
    if (id.startsWith("img-")) {
      const imgId = parseInt(id.split('-')[1]);
      return isNaN(imgId) ? null : { type: 'image', id: imgId };
    } else if (id.startsWith("obs-")) {
      const parts = id.split('-');
      const obsId = parts.length >= 3 ? parseInt(parts[2]) : null;
      return obsId !== null && !isNaN(obsId) ? { type: 'observation', id: obsId } : null;
    }
    return null;
  };

  // Separate score maps for observations and images
  const obsScoreMap: Record<number, { score: number; pool: string }> = {};
  const imgScoreMap: Record<number, { score: number; pool: string }> = {};

  for (const match of coreMatches) {
    const extracted = extractId(match.id);
    if (extracted) {
      const targetMap = extracted.type === 'observation' ? obsScoreMap : imgScoreMap;
      targetMap[extracted.id] = { score: match.score || 0.7, pool: 'core' };
    }
  }

  for (const match of edgeMatches.slice(0, edgeLimit * 2)) {
    const extracted = extractId(match.id);
    if (extracted) {
      const targetMap = extracted.type === 'observation' ? obsScoreMap : imgScoreMap;
      if (!targetMap[extracted.id]) {
        targetMap[extracted.id] = { score: match.score || 0.5, pool: 'edge' };
      }
    }
  }

  // Pool 3: Novelty injection - things that haven't surfaced recently (observations only for now)
  const noveltyObs = await getNoveltyPool(env, noveltyLimit, includeMetabolized);
  for (const obs of noveltyObs) {
    if (!obsScoreMap[obs.id]) {
      obsScoreMap[obs.id] = { score: obs.current_novelty || 0.8, pool: 'novelty' };
    }
  }

  // Pool 4: Dormant rotation - observations from entities that haven't surfaced in 14+ days
  const dormantObs = await getDormantPool(env, dormantLimit, includeMetabolized);
  for (const obs of dormantObs) {
    if (!obsScoreMap[obs.id]) {
      obsScoreMap[obs.id] = { score: 0.7, pool: 'dormant' };
    }
  }

  const allObsIds = Object.keys(obsScoreMap).map(id => parseInt(id));
  const allImgIds = Object.keys(imgScoreMap).map(id => parseInt(id));

  if (allObsIds.length === 0 && allImgIds.length === 0) {
    return await handleMindSurfaceFallback(env, includeMetabolized, limit);
  }

  // Fetch full observation data
  const chargeFilter = includeMetabolized
    ? "o.archived_at IS NULL"
    : "(o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL";

  let obsResults: any[] = [];
  if (allObsIds.length > 0) {
    const obsPlaceholders = allObsIds.map(() => '?').join(',');
    const obsQuery = await env.DB.prepare(`
      SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, o.added_at,
             o.resolution_note, o.novelty_score, o.last_surfaced_at, o.surface_count,
             o.certainty, o.source,
             e.name as entity_name, e.entity_type
      FROM observations o
      JOIN entities e ON o.entity_id = e.id
      WHERE o.id IN (${obsPlaceholders}) AND ${chargeFilter}
    `).bind(...allObsIds).all();
    obsResults = obsQuery.results || [];
  }

  // Fetch full image data
  let imgResults: any[] = [];
  if (allImgIds.length > 0) {
    const imgChargeFilter = includeMetabolized
      ? "1=1"
      : "(i.charge != 'metabolized' OR i.charge IS NULL)";
    const imgPlaceholders = allImgIds.map(() => '?').join(',');
    const imgQuery = await env.DB.prepare(`
      SELECT i.id, i.description, i.path, i.context, i.emotion, i.weight, i.charge,
             i.created_at as added_at, i.novelty_score, i.last_surfaced_at, i.surface_count,
             e.name as entity_name, e.entity_type
      FROM images i
      LEFT JOIN entities e ON i.entity_id = e.id
      WHERE i.id IN (${imgPlaceholders}) AND ${imgChargeFilter}
    `).bind(...allImgIds).all();
    imgResults = imgQuery.results || [];
  }

  if (obsResults.length === 0 && imgResults.length === 0) {
    return await handleMindSurfaceFallback(env, includeMetabolized, limit);
  }

  // Score observations: base score * weight multiplier * novelty boost
  const weightedObsResults = obsResults.map(obs => {
    const obsId = obs.id as number;
    const baseScore = obsScoreMap[obsId]?.score || 0.5;
    const pool = obsScoreMap[obsId]?.pool || 'core';
    const weightMultiplier = obs.weight === 'heavy' ? 1.5 : obs.weight === 'medium' ? 1.2 : 1.0;

    // Novelty boost for things that haven't surfaced in a while
    const noveltyScore = (obs.novelty_score as number) || 1.0;
    const noveltyBoost = pool === 'novelty' ? 0.3 : (noveltyScore > 0.7 ? 0.1 : 0);

    // Charge boost - observations being actively processed should resurface
    const charge = (obs.charge as string) || 'fresh';
    const chargeBoost = (charge === 'active' || charge === 'processing') ? 0.15 : 0;

    return {
      ...obs,
      memoryType: 'observation' as const,
      pool,
      resonanceScore: (baseScore * weightMultiplier) + noveltyBoost + chargeBoost
    };
  });

  // Score images: same logic as observations
  const weightedImgResults = imgResults.map(img => {
    const imgId = img.id as number;
    const baseScore = imgScoreMap[imgId]?.score || 0.5;
    const pool = imgScoreMap[imgId]?.pool || 'core';
    const weightMultiplier = img.weight === 'heavy' ? 1.5 : img.weight === 'medium' ? 1.2 : 1.0;

    const noveltyScore = (img.novelty_score as number) || 1.0;
    const noveltyBoost = noveltyScore > 0.7 ? 0.1 : 0;

    const charge = (img.charge as string) || 'fresh';
    const chargeBoost = (charge === 'active' || charge === 'processing') ? 0.15 : 0;

    return {
      ...img,
      memoryType: 'image' as const,
      pool,
      resonanceScore: (baseScore * weightMultiplier) + noveltyBoost + chargeBoost
    };
  });

  // Combine and sort all results
  const weightedResults = [...weightedObsResults, ...weightedImgResults];
  weightedResults.sort((a, b) => (b.resonanceScore || 0) - (a.resonanceScore || 0));

  // Ensure mix from different pools - don't let one pool dominate completely
  const finalResults: any[] = [];
  const byPool = { core: [] as any[], edge: [] as any[], novelty: [] as any[], dormant: [] as any[] };

  for (const item of weightedResults) {
    byPool[item.pool as keyof typeof byPool]?.push(item);
  }

  // Take from each pool proportionally, then fill with best remaining
  const takeFromPool = (pool: any[], max: number) => {
    const taken = pool.splice(0, max);
    finalResults.push(...taken);
    return taken.length;
  };

  takeFromPool(byPool.core, coreLimit);
  takeFromPool(byPool.novelty, noveltyLimit);
  takeFromPool(byPool.dormant, dormantLimit);
  takeFromPool(byPool.edge, edgeLimit);

  // Fill remaining slots with best available
  const remaining = [...byPool.core, ...byPool.novelty, ...byPool.dormant, ...byPool.edge]
    .sort((a, b) => (b.resonanceScore || 0) - (a.resonanceScore || 0));
  while (finalResults.length < limit && remaining.length > 0) {
    finalResults.push(remaining.shift()!);
  }

  // Re-sort final results by score
  finalResults.sort((a, b) => (b.resonanceScore || 0) - (a.resonanceScore || 0));
  const limitedResults = finalResults.slice(0, limit);

  // === SIDE EFFECTS: Surfacing changes future surfacing ===
  const surfacedObsIds = limitedResults.filter(r => r.memoryType === 'observation').map(o => o.id as number);
  const surfacedImgIds = limitedResults.filter(r => r.memoryType === 'image').map(i => i.id as number);

  // Record co-surfacing, surface tracking, and access tracking
  try {
    await Promise.all([
      recordCoSurfacing(env, surfacedObsIds),  // TODO: extend co-surfacing for images
      updateSurfaceTracking(env, surfacedObsIds, surfacedImgIds),
      recordAccessTracking(env, surfacedObsIds, surfacedImgIds)
    ]);
  } catch (e) {
    console.log(`Surface tracking error: ${e}`);
  }

  // === FORMAT OUTPUT ===
  const poolCounts = { core: 0, edge: 0, novelty: 0, dormant: 0 };
  const typeCounts = { observation: 0, image: 0 };
  for (const item of limitedResults) {
    poolCounts[item.pool as keyof typeof poolCounts]++;
    typeCounts[item.memoryType as keyof typeof typeCounts]++;
  }

  let output = `## What's Surfacing\n\n*${moodContext}*\n`;
  output += `*Mix: ${poolCounts.core} resonance, ${poolCounts.novelty} novelty, ${poolCounts.dormant} dormant, ${poolCounts.edge} edge`;
  if (typeCounts.image > 0) {
    output += ` | ${typeCounts.observation} observations, ${typeCounts.image} images`;
  }
  output += `*\n\n`;

  for (const item of limitedResults) {
    const charge = item.charge || 'fresh';
    const emotionTag = item.emotion ? ` [${item.emotion}]` : '';
    const chargeIcon = charge === 'metabolized' ? '\u2713' : charge === 'processing' ? '\u25D0' : charge === 'active' ? '\u25CB' : '\u25CF';
    const resonance = Math.round((item.resonanceScore || 0) * 100);
    const poolTag = item.pool === 'novelty' ? ' \u2728' : item.pool === 'dormant' ? ' \u{1F504}' : item.pool === 'edge' ? ' \u2194' : '';

    if (item.memoryType === 'image') {
      // Image formatting
      output += `**\u{1F4F7} #${item.id}** ${chargeIcon} [${item.weight}|${charge}] ${resonance}%${poolTag}${emotionTag}\n`;
      if (item.entity_name) {
        output += `**${item.entity_name}**: `;
      }
      output += `${item.description}\n`;
      output += `View: ${await imageUrl(item.id, env)}\n`;
    } else {
      // Observation formatting (original)
      const certaintyIcon = item.certainty === 'known' ? '\u2713' : item.certainty === 'tentative' ? '?' : '';
      const sourceTag = item.source && item.source !== 'conversation' ? ` [${item.source}]` : '';

      output += `**#${item.id}** ${chargeIcon}${certaintyIcon} [${item.weight}|${charge}] ${resonance}%${poolTag}${emotionTag}${sourceTag}\n`;
      output += `**${item.entity_name}** (${item.entity_type}): ${item.content}\n`;

      if (charge === 'metabolized' && item.resolution_note) {
        output += `\u21B3 *Resolved:* ${item.resolution_note}\n`;
      }
    }

    output += "\n";
  }

  // Summary
  const fresh = limitedResults.filter(o => (o.charge || 'fresh') === 'fresh').length;
  const active = limitedResults.filter(o => o.charge === 'active').length;
  const processing = limitedResults.filter(o => o.charge === 'processing').length;

  output += `---\n\u25CF fresh: ${fresh} | \u25CB active: ${active} | \u25D0 processing: ${processing}`;
  if (includeMetabolized) {
    const metabolized = limitedResults.filter(o => o.charge === 'metabolized').length;
    output += ` | \u2713 metabolized: ${metabolized}`;
  }
  output += `\n\u2728 = novelty | \u{1F504} = dormant | \u2194 = edge`;

  return output;
}

// Fallback to queue-based surfacing when no mood/vectors available
async function handleMindSurfaceFallback(env: Env, includeMetabolized: boolean, limit: number): Promise<string> {
  const chargeFilter = includeMetabolized
    ? "o.archived_at IS NULL"
    : "(o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL";

  const results = await env.DB.prepare(`
    SELECT o.id, o.content, o.weight, o.charge, o.sit_count, o.emotion, o.added_at,
           o.resolution_note, o.novelty_score, o.certainty, o.source,
           e.name as entity_name, e.entity_type
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE ${chargeFilter}
    ORDER BY
      COALESCE(o.novelty_score, 1.0) DESC,
      CASE o.weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      CASE o.charge WHEN 'active' THEN 4 WHEN 'processing' THEN 3 WHEN 'fresh' THEN 2 ELSE 1 END DESC,
      o.added_at ASC
    LIMIT ?
  `).bind(limit).all();

  if (!results.results?.length) {
    return "No emotional observations to surface.";
  }

  // Update surface tracking for fallback too
  const surfacedIds = results.results.map(o => o.id as number);
  try {
    await Promise.all([
      recordCoSurfacing(env, surfacedIds),
      updateSurfaceTracking(env, surfacedIds)
    ]);
  } catch (e) {
    console.log(`Surface tracking error (fallback): ${e}`);
  }

  let output = "## What's Surfacing\n\n*No mood detected \u2014 showing by novelty/weight/age*\n\n";

  for (const obs of results.results) {
    const charge = obs.charge || 'fresh';
    const sitCount = obs.sit_count || 0;
    const emotionTag = obs.emotion ? ` [${obs.emotion}]` : '';
    const chargeIcon = charge === 'metabolized' ? '\u2713' : charge === 'processing' ? '\u25D0' : charge === 'active' ? '\u25CB' : '\u25CF';
    const novelty = Math.round((obs.novelty_score as number || 1.0) * 100);

    // Certainty indicator: ✓ known, ? tentative, nothing for believed
    const certaintyIcon = obs.certainty === 'known' ? '\u2713' : obs.certainty === 'tentative' ? '?' : '';
    // Source tag: only show if not the default 'conversation'
    const sourceTag = obs.source && obs.source !== 'conversation' ? ` [${obs.source}]` : '';

    output += `**#${obs.id}** ${chargeIcon}${certaintyIcon} [${obs.weight}|${charge}] novelty: ${novelty}%${emotionTag}${sourceTag}\n`;
    output += `**${obs.entity_name}** (${obs.entity_type}): ${obs.content}\n`;

    if (charge === 'metabolized' && obs.resolution_note) {
      output += `\u21B3 *Resolved:* ${obs.resolution_note}\n`;
    }

    output += "\n";
  }

  const fresh = results.results.filter(o => (o.charge || 'fresh') === 'fresh').length;
  const active = results.results.filter(o => o.charge === 'active').length;
  const processing = results.results.filter(o => o.charge === 'processing').length;

  output += `---\n\u25CF fresh: ${fresh} | \u25CB active: ${active} | \u25D0 processing: ${processing}`;
  if (includeMetabolized) {
    const metabolized = results.results.filter(o => o.charge === 'metabolized').length;
    output += ` | \u2713 metabolized: ${metabolized}`;
  }

  return output;
}

async function handleMindSurfaceSpark(env: Env, params: Record<string, unknown>): Promise<string> {
  const count = (params.limit as number) || 5;
  const context = params.context as string;
  const weightBias = params.weight_bias as string;

  // 20% chance to include archived observations - old memories bubbling up
  const includeArchived = Math.random() < 0.2;
  const archivedFilter = includeArchived ? "" : "AND o.archived_at IS NULL";

  // Get hot entities from subconscious to bias selection
  const subconscious = await getSubconsciousState(env);
  const hotEntityNames = subconscious?.hot_entities?.slice(0, 5).map(e => e.name) || [];

  // Split count: half from hot entities, half random (if hot entities exist)
  const hotCount = hotEntityNames.length > 0 ? Math.ceil(count / 2) : 0;
  const randomCount = count - hotCount;

  let allResults: Array<Record<string, unknown>> = [];

  // Get sparks from hot entities first
  if (hotCount > 0 && hotEntityNames.length > 0) {
    const placeholders = hotEntityNames.map(() => '?').join(',');
    const hotQuery = `SELECT o.id, o.content, o.weight, o.emotion, o.archived_at, e.name as entity_name
                      FROM observations o
                      LEFT JOIN entities e ON o.entity_id = e.id
                      WHERE e.name IN (${placeholders}) ${archivedFilter}
                      ORDER BY RANDOM() LIMIT ?`;
    const hotResults = await env.DB.prepare(hotQuery).bind(...hotEntityNames, hotCount).all();
    if (hotResults.results) {
      allResults = allResults.concat(hotResults.results as Array<Record<string, unknown>>);
    }
  }

  // Get random sparks
  if (randomCount > 0) {
    let query = `SELECT o.id, o.content, o.weight, o.emotion, o.archived_at, e.name as entity_name
                 FROM observations o
                 LEFT JOIN entities e ON o.entity_id = e.id`;

    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (context) {
      conditions.push("o.context = ?");
      bindings.push(context);
    }
    if (weightBias) {
      conditions.push("o.weight = ?");
      bindings.push(weightBias);
    }
    if (!includeArchived) {
      conditions.push("o.archived_at IS NULL");
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY RANDOM() LIMIT ?";
    bindings.push(randomCount);

    const randomResults = await env.DB.prepare(query).bind(...bindings).all();
    if (randomResults.results) {
      allResults = allResults.concat(randomResults.results as Array<Record<string, unknown>>);
    }
  }

  if (!allResults.length) {
    return "No observations found to spark from.";
  }

  // Shuffle combined results
  for (let i = allResults.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allResults[i], allResults[j]] = [allResults[j], allResults[i]];
  }

  let output = "## Sparks\n\n";
  if (hotCount > 0) {
    output += `*Biased toward what's hot: ${hotEntityNames.slice(0, 3).join(', ')}...*\n\n`;
  }
  if (includeArchived) {
    output += `*Including memories from the deep*\n\n`;
  }
  for (const obs of allResults) {
    const entity = obs.entity_name ? ` [${obs.entity_name}]` : "";
    const weight = obs.weight ? ` {${obs.weight}}` : "";
    const emotion = obs.emotion ? ` (${obs.emotion})` : "";
    const archived = obs.archived_at ? ` [from the deep]` : "";
    output += `- ${obs.content}${entity}${weight}${emotion}${archived}\n`;
  }
  output += `\n*${allResults.length} observations for associative thinking*`;
  return output;
}


async function handleMindConsolidate(env: Env, params: Record<string, unknown>): Promise<string> {
  const days = (params.days as number) || 7;
  const context = params.context as string;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  let query = `SELECT o.id, o.content, o.weight, o.emotion, o.added_at, o.context, o.charge, o.sit_count, o.last_sat_at, e.name as entity_name
               FROM observations o
               LEFT JOIN entities e ON o.entity_id = e.id
               WHERE o.added_at > ?`;
  const bindings: unknown[] = [cutoffStr];

  if (context) {
    query += " AND o.context = ?";
    bindings.push(context);
  }

  query += " ORDER BY o.added_at DESC";

  const results = await env.DB.prepare(query).bind(...bindings).all();

  if (!results.results?.length) {
    return `No observations in the last ${days} days.`;
  }

  // Get subconscious patterns from daemon
  const subconscious = await getSubconsciousState(env);

  // Group by entity
  const byEntity: Record<string, Array<Record<string, unknown>>> = {};
  for (const obs of results.results) {
    const entity = (obs.entity_name as string) || "_unlinked_";
    if (!byEntity[entity]) byEntity[entity] = [];
    byEntity[entity].push(obs);
  }

  // Find potential duplicates (similar content)
  const potentialDupes: Array<{a: Record<string, unknown>, b: Record<string, unknown>, similarity: string}> = [];
  const observations = results.results;
  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const a = String(observations[i].content).toLowerCase();
      const b = String(observations[j].content).toLowerCase();
      const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 4));
      const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 4));
      const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
      const total = Math.max(wordsA.size, wordsB.size);
      if (total > 0 && overlap / total > 0.5) {
        potentialDupes.push({
          a: observations[i],
          b: observations[j],
          similarity: `${Math.round(overlap / total * 100)}%`
        });
      }
    }
  }

  let output = `## Consolidation Review (${days} days)\n\n`;
  output += `Total observations: ${results.results.length}\n`;
  output += `Unique entities: ${Object.keys(byEntity).length}\n\n`;

  // Daemon-detected recurring patterns
  if (subconscious?.recurring_patterns?.length) {
    output += `### Recurring Patterns (daemon-detected)\n`;
    for (const p of subconscious.recurring_patterns.slice(0, 5)) {
      output += `- **${p.entity}**: ${p.mentions} mentions - ${p.pattern}\n`;
    }
    output += `\n`;
  }

  // Activity Timeline — bar chart by day with spike detection
  const byDay: Record<string, number> = {};
  for (const obs of results.results) {
    const day = new Date(obs.added_at as string | number).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const dayEntries = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  if (dayEntries.length > 0) {
    const maxDay = Math.max(...dayEntries.map(d => d[1]));
    const avgDay = dayEntries.reduce((s, d) => s + d[1], 0) / dayEntries.length;
    output += `### Activity Timeline\n`;
    for (const [day, count] of dayEntries) {
      const bar = '\u2588'.repeat(Math.round((count / maxDay) * 20));
      const spike = count > avgDay * 2 ? ' \u26A1 spike' : '';
      output += `${day} ${bar} ${count}${spike}\n`;
    }
    output += `\n`;
  }

  // Emotional Arc — early vs late half emotion shift
  const allEmotions: string[] = [];
  const halfIdx = Math.floor(results.results.length / 2);
  const earlyEmotions: Record<string, number> = {};
  const lateEmotions: Record<string, number> = {};
  for (let i = 0; i < results.results.length; i++) {
    const em = results.results[i].emotion as string;
    if (!em) continue;
    allEmotions.push(em);
    if (i >= halfIdx) {
      earlyEmotions[em] = (earlyEmotions[em] || 0) + 1; // older half (results sorted DESC)
    } else {
      lateEmotions[em] = (lateEmotions[em] || 0) + 1; // newer half
    }
  }
  if (allEmotions.length > 2) {
    const topEarly = Object.entries(earlyEmotions).sort((a, b) => b[1] - a[1])[0];
    const topLate = Object.entries(lateEmotions).sort((a, b) => b[1] - a[1])[0];
    output += `### Emotional Arc\n`;
    if (topEarly && topLate && topEarly[0] !== topLate[0]) {
      output += `Started **${topEarly[0]}**, shifted to **${topLate[0]}**\n`;
    } else if (topEarly) {
      output += `Consistently **${topEarly[0]}** throughout\n`;
    }
    // Full distribution
    const emotionTotals: Record<string, number> = {};
    for (const em of allEmotions) emotionTotals[em] = (emotionTotals[em] || 0) + 1;
    const emotionSorted = Object.entries(emotionTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [em, count] of emotionSorted) {
      output += `- ${em}: ${count} (${Math.round(count / allEmotions.length * 100)}%)\n`;
    }
    output += `\n`;
  }

  // Charge Progression
  const charges: Record<string, number> = { fresh: 0, active: 0, processing: 0, metabolized: 0 };
  for (const obs of results.results) {
    const c = (obs.charge as string) || 'fresh';
    charges[c] = (charges[c] || 0) + 1;
  }
  output += `### Charge Progression\n`;
  output += `- Fresh: ${charges.fresh} | Active: ${charges.active} | Processing: ${charges.processing} | Metabolized: ${charges.metabolized}\n\n`;

  // Weight distribution
  const weights: Record<string, number> = { light: 0, medium: 0, heavy: 0 };
  for (const obs of results.results) {
    const w = (obs.weight as string) || "medium";
    weights[w] = (weights[w] || 0) + 1;
  }
  output += `### Weight Distribution\n`;
  output += `- Light: ${weights.light} | Medium: ${weights.medium} | Heavy: ${weights.heavy}\n\n`;

  // Active entities
  output += `### Most Active Entities\n`;
  const sorted = Object.entries(byEntity)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  for (const [entity, obs] of sorted) {
    output += `- **${entity}**: ${obs.length} observations\n`;
  }

  // What's Unresolved — oldest medium/heavy observations still in active charge
  const unresolved = results.results
    .filter(o => (o.weight === 'medium' || o.weight === 'heavy')
      && (o.charge === 'active' || o.charge === 'processing' || !o.charge))
    .sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)))
    .slice(0, 5);
  if (unresolved.length > 0) {
    output += `\n### What's Unresolved\n`;
    output += `*Oldest medium/heavy observations still active — what hasn't settled*\n\n`;
    for (const obs of unresolved) {
      const age = Math.round((Date.now() - new Date(obs.added_at as string).getTime()) / 86400000);
      const emotionTag = obs.emotion ? ` [${obs.emotion}]` : '';
      output += `- **#${obs.id}** [${obs.weight}] ${age}d old${emotionTag} — ${String(obs.content).slice(0, 80)}...\n`;
    }
  }

  // Potential duplicates
  if (potentialDupes.length > 0) {
    output += `\n### Potential Duplicates (${potentialDupes.length})\n`;
    for (const dupe of potentialDupes.slice(0, 5)) {
      output += `- [${dupe.similarity}] #${dupe.a.id} vs #${dupe.b.id}\n`;
      output += `  "${String(dupe.a.content).slice(0, 60)}..."\n`;
      output += `  "${String(dupe.b.content).slice(0, 60)}..."\n`;
    }
  }

  return output;
}

export { handleMindSit, handleMindResolve, handleMindSurface, handleMindConsolidate, recordCoSurfacing, updateSurfaceTracking };
