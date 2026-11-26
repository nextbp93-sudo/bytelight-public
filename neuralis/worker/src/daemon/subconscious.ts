import type { Env } from "../types";
import { getEmbedding, searchVectors, getSubconsciousState } from "../utils";
import { generateText } from "../embeddings";
import { getTimeOfDayContext } from "../context";
import { refreshSnapshots } from "../handlers/personality";
import {
  DAEMON_COOLDOWN_MS,
  DORMANCY_AGE_DAYS,
  ARCHIVE_AGE_DAYS,
  CONSOLIDATION_MIN_OBS,
  CONSOLIDATION_MAX_ENTITIES_PER_RUN,
  REFLECTION_MIN_OBS,
  ACCESS_DECAY_PENALTY,
  ACCESS_DECAY_AGE_DAYS,
  NOVELTY_FLOORS,
  NOVELTY_DECAY_RATES,
  NOVELTY_TIME_RECOVERY_RATE,
  NOVELTY_TIME_RECOVERY_CAP
} from "../config";

// Dream engine - generates associative dream content from emotional seeds
export async function processDream(env: Env, force = false): Promise<void> {
  const timeCtx = getTimeOfDayContext();
  if (!force && timeCtx.period !== 'night') return;

  // Check if we already dreamed tonight
  const tonight = new Date().toISOString().split('T')[0];
  const existing = await env.DB.prepare(
    'SELECT id FROM dreams WHERE dream_date = ?'
  ).bind(tonight).first();
  if (existing) return;

  // Step 1: Gather emotional seed
  const recentEmotional = await env.DB.prepare(`
    SELECT o.content, o.emotion, o.weight, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.added_at > datetime('now', '-7 days')
    AND o.emotion IS NOT NULL
    ORDER BY
      CASE o.weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      o.added_at DESC
    LIMIT 5
  `).all();

  const unresolved = await env.DB.prepare(`
    SELECT o.content, o.emotion, o.weight, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.charge IN ('active', 'processing')
    AND o.archived_at IS NULL
    ORDER BY
      CASE o.weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC
    LIMIT 5
  `).all();

  const subconscious = await getSubconsciousState(env);
  const dominantMood = subconscious?.mood?.dominant || 'quiet';

  const lastJournal = await env.DB.prepare(
    'SELECT content FROM journals ORDER BY created_at DESC LIMIT 1'
  ).first();

  // Step 2: Build seed queries (emotional, not logical)
  const seeds: string[] = [];

  const emotions = (recentEmotional.results || []).map((r: any) => r.emotion).filter(Boolean);
  let emotionSeed: string;
  if (emotions.length > 0) {
    emotionSeed = emotions.join(', ');
  } else if (dominantMood && dominantMood !== 'insufficient data') {
    emotionSeed = dominantMood;
  } else {
    // Derive emotional texture from recent observations or journal content
    const recentContent = (recentEmotional.results || []).concat(unresolved.results || [])
      .map((r: any) => (r.content as string).slice(0, 80)).join('. ');
    emotionSeed = recentContent || (lastJournal?.content as string || '').slice(0, 150) || 'quiet stillness';
  }
  seeds.push(emotionSeed);

  if (unresolved.results?.length) {
    seeds.push(
      unresolved.results.map((r: any) => (r.content as string).slice(0, 100)).join('. ')
    );
  }

  if (lastJournal?.content) {
    seeds.push((lastJournal.content as string).slice(0, 200));
  }

  // Step 3: Query vector space — the dream zone (0.3-0.75)
  const allFragments: Array<{
    type: string; id: string; score: number; content: string; source: string; entity?: string;
  }> = [];
  const seenIds = new Set<string>();

  for (const seed of seeds) {
    if (!seed) continue;
    const results = await searchVectors(env, seed, 10);

    for (const match of results.matches || []) {
      if (seenIds.has(match.id)) continue;
      seenIds.add(match.id);
      const meta = (match.metadata || {}) as Record<string, string>;

      if (match.score >= 0.25 && match.score <= 0.82) {
        allFragments.push({
          type: meta.source || 'unknown',
          id: match.id,
          score: match.score,
          content: (meta.content || meta.description || match.id).slice(0, 200),
          source: seed.slice(0, 50),
          entity: meta.entity
        });
      }
    }
  }

  if (allFragments.length < 1) return; // Not enough material to dream

  // Step 4: Maximize collision — pick from different entity groups
  const entityGroups: Record<string, typeof allFragments> = {};
  for (const frag of allFragments) {
    const key = frag.entity || frag.type;
    if (!entityGroups[key]) entityGroups[key] = [];
    entityGroups[key].push(frag);
  }

  const dreamFragments: typeof allFragments = [];
  const groupKeys = Object.keys(entityGroups);
  let groupIdx = 0;
  while (dreamFragments.length < 7 && groupIdx < groupKeys.length * 3) {
    const key = groupKeys[groupIdx % groupKeys.length];
    const group = entityGroups[key];
    if (group.length > 0) dreamFragments.push(group.shift()!);
    groupIdx++;
  }

  // Step 5: Compose the dream text
  let dreamContent = `Emotional seed: ${emotionSeed}\n\nFragments:\n`;
  for (const frag of dreamFragments) {
    const entityTag = frag.entity ? `[${frag.entity}] ` : '';
    const typeTag = frag.type === 'image' ? '(visual) ' : '';
    dreamContent += `- ${entityTag}${typeTag}${frag.content} [${Math.round(frag.score * 100)}% resonance]\n`;
  }

  const seedConnections: Record<string, string[]> = {};
  for (const frag of dreamFragments) {
    if (!seedConnections[frag.source]) seedConnections[frag.source] = [];
    seedConnections[frag.source].push(
      `${frag.entity || frag.type}: "${frag.content.slice(0, 60)}..."`
    );
  }

  dreamContent += `\nThreads:\n`;
  for (const [seed, connections] of Object.entries(seedConnections)) {
    dreamContent += `"${seed}" pulled:\n`;
    for (const conn of connections) dreamContent += `  → ${conn}\n`;
  }

  const crossLinks: string[] = [];
  for (let i = 0; i < dreamFragments.length; i++) {
    for (let j = i + 1; j < dreamFragments.length; j++) {
      const a = dreamFragments[i], b = dreamFragments[j];
      if (a.source !== b.source && a.entity && a.entity === b.entity) {
        crossLinks.push(`${a.entity} appeared in both "${a.source.slice(0, 30)}..." and "${b.source.slice(0, 30)}..."`);
      }
    }
  }
  if (crossLinks.length > 0) {
    dreamContent += `\nCross-links:\n`;
    for (const link of crossLinks) dreamContent += `  ↔ ${link}\n`;
  }

  // Step 6: Detect recurring dreams
  const dreamEmbedding = await getEmbedding(env, dreamContent);

  const pastDreamResults = await env.VECTORS.query(dreamEmbedding, {
    topK: 5, returnMetadata: 'all'
  });

  let recurringDreamId: number | null = null;
  let recurrenceCount = 0;

  for (const match of pastDreamResults.matches || []) {
    if (match.score > 0.7 && match.id.startsWith('dream-')) {
      const pastDreamId = parseInt(match.id.replace('dream-', ''));
      const pastDream = await env.DB.prepare(
        'SELECT id, recurring_dream_id, recurrence_count FROM dreams WHERE id = ?'
      ).bind(pastDreamId).first();

      if (pastDream) {
        recurringDreamId = (pastDream.recurring_dream_id as number) || (pastDream.id as number);
        recurrenceCount = ((pastDream.recurrence_count as number) || 0) + 1;
        dreamContent += `\n---\nRecurring pattern (${recurrenceCount + 1}x) — echoes dream #${recurringDreamId}\n`;
        break;
      }
    }
  }

  // Step 7: Store the dream
  const fragmentsJson = JSON.stringify(dreamFragments.map(f => ({
    type: f.type, id: f.id, score: f.score, content: f.content.slice(0, 200), entity: f.entity
  })));

  const result = await env.DB.prepare(`
    INSERT INTO dreams (dream_date, content, emotional_seed, fragments, recurring_dream_id, recurrence_count, companion, vividness)
    VALUES (?, ?, ?, ?, ?, ?, 'shared', 100)
  `).bind(tonight, dreamContent, emotionSeed, fragmentsJson, recurringDreamId, recurrenceCount).run();

  const dreamId = result.meta.last_row_id;

  await env.VECTORS.upsert([{
    id: `dream-${dreamId}`,
    values: dreamEmbedding,
    metadata: {
      source: 'dream', content: dreamContent.slice(0, 500),
      dream_date: tonight, emotional_seed: emotionSeed,
      recurring: recurringDreamId ? 'yes' : 'no'
    }
  }]);

  console.log(`Dream generated for ${tonight}: ${dreamFragments.length} fragments, ${recurringDreamId ? 'recurring #' + recurringDreamId : 'new'}`);
}

// Phase 3: LLM-driven consolidation of related observations
export async function consolidateRelatedObservations(env: Env): Promise<number> {
  // KILL SWITCH: generative writes disabled pending Voice slice
  if (env.GENERATIVE_WRITES !== 'true') {
    console.log('QUARANTINE: consolidateRelatedObservations SKIPPED — GENERATIVE_WRITES is OFF. No consolidation until Voice ships and the human approves samples.');
    return 0;
  }

  // Find entities with many active observations — candidates for consolidation
  const candidates = await env.DB.prepare(`
    SELECT e.id, e.name, COUNT(*) as obs_count
    FROM entities e
    JOIN observations o ON e.id = o.entity_id
    WHERE o.archived_at IS NULL
      AND o.valid_until IS NULL
      AND o.superseded_by IS NULL
      AND (o.charge != 'metabolized' OR o.charge IS NULL)
    GROUP BY e.id, e.name
    HAVING COUNT(*) >= ${CONSOLIDATION_MIN_OBS}
    ORDER BY COUNT(*) DESC
    LIMIT ${CONSOLIDATION_MAX_ENTITIES_PER_RUN}
  `).all();

  let consolidated = 0;

  for (const candidate of candidates.results || []) {
    // Find co-surfacing clusters within this entity
    const obsRows = await env.DB.prepare(`
      SELECT id, content, weight, emotion, context, owner FROM observations
      WHERE entity_id = ? AND archived_at IS NULL AND valid_until IS NULL AND superseded_by IS NULL
      ORDER BY added_at DESC
    `).bind(candidate.id).all();

    const obsMap = new Map<number, any>();
    for (const o of obsRows.results || []) {
      obsMap.set(o.id as number, o);
    }

    // Use co-surfacing data to find clusters
    const entityObsIds = new Set((obsRows.results || []).map((o: any) => o.id as number));
    const coSurfPairs = await env.DB.prepare(`
      SELECT obs_a_id, obs_b_id, co_count FROM co_surfacing
      WHERE co_count >= 2
    `).all();

    // Build adjacency list for observations in this entity
    const adj = new Map<number, Set<number>>();
    for (const pair of coSurfPairs.results || []) {
      const a = pair.obs_a_id as number;
      const b = pair.obs_b_id as number;
      if (!entityObsIds.has(a) || !entityObsIds.has(b)) continue;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }

    // BFS to find connected components of size 3+
    const visited = new Set<number>();
    const clusters: number[][] = [];
    for (const nodeId of adj.keys()) {
      if (visited.has(nodeId)) continue;
      const cluster: number[] = [];
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        for (const neighbor of adj.get(current) || []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (cluster.length >= 3) clusters.push(cluster);
    }

    // Consolidate each cluster via LLM
    for (const cluster of clusters.slice(0, 2)) { // max 2 clusters per entity per run
      const obsTexts = cluster
        .map(id => obsMap.get(id))
        .filter(Boolean)
        .map((o: any) => o.content as string);

      if (obsTexts.length < 3) continue;

      const prompt = `You are consolidating related memories about "${candidate.name}". Summarize these ${obsTexts.length} observations into ONE concise observation (1-2 sentences) that captures the essential meaning. Preserve emotional significance.\n\n${obsTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n\nConsolidated observation:`;

      try {
        const summary = await generateText(env.GEMINI_API_KEY, prompt);
        if (!summary || summary.length < 10) {
          console.log(`Consolidation: empty/short response for entity ${candidate.name}`);
          continue;
        }

        // Find the heaviest weight among originals
        const weights = cluster.map(id => obsMap.get(id)?.weight || 'medium');
        const maxWeight = weights.includes('heavy') ? 'heavy' : weights.includes('medium') ? 'medium' : 'light';

        // Majority context from sources (tie → first source's bucket)
        const contextCounts: Record<string, number> = {};
        let firstContext = 'default';
        for (const id of cluster) {
          const ctx = (obsMap.get(id)?.context as string) || 'default';
          if (firstContext === 'default' && ctx !== 'default') firstContext = ctx;
          contextCounts[ctx] = (contextCounts[ctx] || 0) + 1;
        }
        const majorityContext = Object.entries(contextCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || firstContext;

        // Majority owner from sources (tie → 'shared')
        const ownerCounts: Record<string, number> = {};
        for (const id of cluster) {
          const own = (obsMap.get(id)?.owner as string) || 'shared';
          ownerCounts[own] = (ownerCounts[own] || 0) + 1;
        }
        const ownerEntries = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]);
        const majorityOwner = (ownerEntries.length > 1 && ownerEntries[0][1] === ownerEntries[1][1])
          ? 'shared' : (ownerEntries[0]?.[0] || 'shared');

        // Insert consolidated observation
        const result = await env.DB.prepare(`
          INSERT INTO observations (entity_id, content, salience, weight, certainty, source, context, valid_from, owner)
          VALUES (?, ?, 'active', ?, 'believed', 'consolidated', ?, datetime('now'), ?)
        `).bind(candidate.id, summary.trim(), maxWeight, majorityContext, majorityOwner).run();

        const newObsId = result.meta.last_row_id;

        // Embed the consolidated observation
        const embedding = await getEmbedding(env, `${candidate.name}: ${summary.trim()}`);
        await env.VECTORS.upsert([{
          id: `obs-${candidate.id}-${newObsId}`,
          values: embedding,
          metadata: {
            source: "observation", entity: candidate.name as string, content: summary.trim(),
            context: majorityContext, weight: maxWeight, observation_source: "consolidated",
            added_at: new Date().toISOString()
          }
        }]);

        // Record the consolidation group
        try {
          await env.DB.prepare(`
            INSERT INTO consolidation_groups (summary, entity_id, source_observation_ids, consolidated_observation_id)
            VALUES (?, ?, ?, ?)
          `).bind(summary.trim(), candidate.id, JSON.stringify(cluster), newObsId).run();
        } catch { /* table may not exist yet */ }

        // Archive the originals
        for (const origId of cluster) {
          await env.DB.prepare(`
            UPDATE observations SET archived_at = datetime('now') WHERE id = ?
          `).bind(origId).run();
        }

        consolidated++;
      } catch (e) {
        console.log(`Consolidation LLM error for ${candidate.name}: ${e}`);
      }
    }
  }

  return consolidated;
}

// Phase 3: Generate structured reflection from recent observations
export async function generateSessionReflection(env: Env): Promise<void> {
  // KILL SWITCH: generative writes disabled pending Voice slice
  if (env.GENERATIVE_WRITES !== 'true') {
    console.log('QUARANTINE: generateSessionReflection SKIPPED — GENERATIVE_WRITES is OFF. No reflections until Voice ships and the human approves samples.');
    return;
  }

  const recentObs = await env.DB.prepare(`
    SELECT o.content, o.emotion, o.weight, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.added_at > datetime('now', '-35 minutes')
    ORDER BY o.added_at DESC
  `).all();

  if ((recentObs.results?.length || 0) < REFLECTION_MIN_OBS) return;

  const obsText = (recentObs.results || []).map((o: any) =>
    `[${o.entity_name}] ${o.content}${o.emotion ? ` (${o.emotion})` : ''}`
  ).join('\n');

  const prompt = `You are reflecting on recent experiences stored in memory. Based on these ${recentObs.results!.length} recent memories, generate one concise insight (1-2 sentences) about what pattern or theme emerges. Be specific and observational, not generic.\n\n${obsText}\n\nInsight:`;

  try {
    const insight = await generateText(env.GEMINI_API_KEY, prompt);
    if (!insight || insight.length < 10) return;

    const entryDate = new Date().toISOString().split('T')[0];
    const result = await env.DB.prepare(`
      INSERT INTO journals (entry_date, content, tags, emotion, journal_type)
      VALUES (?, ?, '["reflection","daemon"]', NULL, 'reflection')
    `).bind(entryDate, insight.trim()).run();

    // Vectorize the reflection
    const embedding = await getEmbedding(env, insight.trim());
    await env.VECTORS.upsert([{
      id: `journal-${result.meta.last_row_id}`,
      values: embedding,
      metadata: { source: "journal", title: entryDate, content: insight.trim(), journal_type: "reflection" }
    }]);

    console.log(`Reflection generated: ${insight.trim().slice(0, 80)}...`);
  } catch (e) {
    console.log(`Reflection error: ${e}`);
  }
}

// Subconscious processing - runs on cron schedule
export async function processSubconscious(env: Env): Promise<void> {
  const now = new Date();

  // Cooldown: skip if processed recently
  try {
    const last = await env.DB.prepare(
      "SELECT updated_at FROM subconscious WHERE state_type = 'daemon' LIMIT 1"
    ).first();
    if (last?.updated_at) {
      const lastRun = new Date(last.updated_at as string).getTime();
      if (now.getTime() - lastRun < DAEMON_COOLDOWN_MS) {
        console.log("Subconscious: skipping, last run was less than 5 minutes ago");
        return;
      }
    }
  } catch { /* table may not exist yet */ }

  const cutoffHours = 48;
  const cutoff = new Date(now.getTime() - cutoffHours * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString();

  // Get recent observations with their entities (including weight for emotional intensity)
  const recentObs = await env.DB.prepare(`
    SELECT e.name, e.entity_type, o.context, o.content, o.added_at, o.emotion, o.weight
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.added_at > ?
    ORDER BY o.added_at DESC
    LIMIT 2000
  `).bind(cutoffStr).all();

  // Get relations for graph analysis (capped for performance)
  const allRelations = await env.DB.prepare(`
    SELECT from_entity, to_entity, relation_type, from_context, to_context, created_at
    FROM relations
    ORDER BY created_at DESC LIMIT 5000
  `).all();

  // Calculate entity warmth (how often mentioned recently, weighted by emotional intensity)
  const entityCounts: Record<string, { count: number; weightedCount: number; type: string; contexts: Set<string>; emotions: string[] }> = {};

  for (const row of recentObs.results || []) {
    const name = row.name as string;
    if (!entityCounts[name]) {
      entityCounts[name] = {
        count: 0,
        weightedCount: 0,
        type: row.entity_type as string,
        contexts: new Set(),
        emotions: []
      };
    }
    entityCounts[name].count++;
    // Weight multiplier: heavy = 3, medium = 2, light = 1
    const weight = row.weight as string || 'medium';
    const weightMultiplier = weight === 'heavy' ? 3 : weight === 'medium' ? 2 : 1;
    entityCounts[name].weightedCount += weightMultiplier;
    entityCounts[name].contexts.add(row.context as string);
    if (row.emotion) entityCounts[name].emotions.push(row.emotion as string);
  }

  // === RELATION ANALYSIS ===

  // Track connectivity for each entity (central nodes have many connections)
  const connectivity: Record<string, { outgoing: number; incoming: number; total: number; relationTypes: Set<string> }> = {};

  // Track relation type frequencies
  const relationTypeCounts: Record<string, number> = {};

  // Build adjacency for cluster detection
  const adjacency: Record<string, Set<string>> = {};

  for (const rel of allRelations.results || []) {
    const from = rel.from_entity as string;
    const to = rel.to_entity as string;
    const relType = rel.relation_type as string;

    // Initialize connectivity tracking
    if (!connectivity[from]) {
      connectivity[from] = { outgoing: 0, incoming: 0, total: 0, relationTypes: new Set() };
    }
    if (!connectivity[to]) {
      connectivity[to] = { outgoing: 0, incoming: 0, total: 0, relationTypes: new Set() };
    }

    // Count connections
    connectivity[from].outgoing++;
    connectivity[from].total++;
    connectivity[from].relationTypes.add(relType);
    connectivity[to].incoming++;
    connectivity[to].total++;
    connectivity[to].relationTypes.add(relType);

    // Count relation types
    relationTypeCounts[relType] = (relationTypeCounts[relType] || 0) + 1;

    // Build adjacency (undirected for clustering)
    if (!adjacency[from]) adjacency[from] = new Set();
    if (!adjacency[to]) adjacency[to] = new Set();
    adjacency[from].add(to);
    adjacency[to].add(from);
  }

  // Find central nodes (highest connectivity)
  const centralNodes = Object.entries(connectivity)
    .map(([name, data]) => ({
      name,
      connections: data.total,
      outgoing: data.outgoing,
      incoming: data.incoming,
      relationTypes: Array.from(data.relationTypes)
    }))
    .sort((a, b) => b.connections - a.connections)
    .slice(0, 10);

  // Find relation patterns (most common relation types)
  const relationPatterns = Object.entries(relationTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Detect relation clusters using simple component detection
  // Find groups of entities that are densely connected
  const visited = new Set<string>();
  const relationClusters: Array<{ entities: string[]; density: number; bridgeRelations: string[] }> = [];

  for (const entity of Object.keys(adjacency)) {
    if (visited.has(entity)) continue;

    // BFS to find connected component
    const component: string[] = [];
    const queue = [entity];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);

      for (const neighbor of adjacency[current] || []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    // Only track meaningful clusters (2+ entities)
    if (component.length >= 2) {
      // Calculate density (edges / possible edges)
      let edgeCount = 0;
      const componentSet = new Set(component);
      for (const e of component) {
        for (const neighbor of adjacency[e] || []) {
          if (componentSet.has(neighbor)) edgeCount++;
        }
      }
      edgeCount = edgeCount / 2; // Undirected, counted twice
      const possibleEdges = (component.length * (component.length - 1)) / 2;
      const density = possibleEdges > 0 ? Math.round((edgeCount / possibleEdges) * 100) / 100 : 0;

      // Find what relation types bridge this cluster
      const bridgeRelations = new Set<string>();
      for (const e of component) {
        if (connectivity[e]) {
          connectivity[e].relationTypes.forEach(t => bridgeRelations.add(t));
        }
      }

      relationClusters.push({
        entities: component.slice(0, 8), // Limit for readability
        density,
        bridgeRelations: Array.from(bridgeRelations).slice(0, 5)
      });
    }
  }

  // Sort clusters by size
  relationClusters.sort((a, b) => b.entities.length - a.entities.length);

  // Find hot entities (combines weighted observation warmth with connectivity)
  // weightedCount factors in emotional weight: heavy=3, medium=2, light=1
  const maxWeightedCount = Math.max(...Object.values(entityCounts).map(e => e.weightedCount), 1);
  const maxConnectivity = Math.max(...Object.values(connectivity).map(c => c.total), 1);

  const hotEntities = Object.entries(entityCounts)
    .map(([name, data]) => {
      const obsWarmth = data.weightedCount / maxWeightedCount;
      const connWarmth = (connectivity[name]?.total || 0) / maxConnectivity;
      // Combined score: 60% weighted observation activity, 40% connectivity
      const combinedWarmth = (obsWarmth * 0.6) + (connWarmth * 0.4);

      return {
        name,
        warmth: Math.round(combinedWarmth * 100) / 100,
        mentions: data.count,
        connections: connectivity[name]?.total || 0,
        type: data.type,
        contexts: Array.from(data.contexts)
      };
    })
    .sort((a, b) => b.warmth - a.warmth)
    .slice(0, 15);

  // Find recurring patterns (3+ mentions) with computed pattern strings
  const recurring = Object.entries(entityCounts)
    .filter(([_, data]) => data.count >= 3)
    .map(([name, data]) => {
      // Compute emotion distribution for this entity
      const entityEmotions: Record<string, number> = {};
      for (const em of data.emotions) {
        entityEmotions[em] = (entityEmotions[em] || 0) + 1;
      }
      const totalEmotions = data.emotions.length;

      let pattern: string;
      if (totalEmotions > 0) {
        const sorted = Object.entries(entityEmotions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        const emotionStr = sorted
          .map(([em, count]) => `${em} (${Math.round(count / totalEmotions * 100)}%)`)
          .join(', ');
        pattern = `emotional mix: ${emotionStr}`;
      } else {
        const ctxList = Array.from(data.contexts).slice(0, 3).join(', ');
        pattern = ctxList ? `recurring in: ${ctxList}` : 'recurring theme (no emotion data)';
      }

      // Flag heavy-weighted entities
      const heavyCount = data.weightedCount - data.count; // excess from weight multipliers
      if (heavyCount >= data.count * 1.5) {
        pattern = `heavy-weighted: ${pattern}`;
      }

      return {
        entity: name,
        mentions: data.count,
        connections: connectivity[name]?.total || 0,
        pattern
      };
    });

  // Analyze mood from emotional tags + journals + relational state
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const emotionCounts: Record<string, number> = {};
  let totalEmotionSignals = 0;

  // 1. Observation emotions — weight recent ones 2x
  for (const row of recentObs.results || []) {
    const em = row.emotion as string;
    if (!em) continue;
    const recencyWeight = new Date(row.added_at as string) > sixHoursAgo ? 2 : 1;
    emotionCounts[em] = (emotionCounts[em] || 0) + recencyWeight;
    totalEmotionSignals += recencyWeight;
  }

  // 2. Journal emotions from last 48h
  try {
    const recentJournals = await env.DB.prepare(
      `SELECT emotion, created_at FROM journals WHERE emotion IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 10`
    ).bind(cutoffStr).all();
    for (const j of recentJournals.results || []) {
      const em = j.emotion as string;
      if (!em) continue;
      const recencyWeight = new Date(j.created_at as string) > sixHoursAgo ? 2 : 1;
      emotionCounts[em] = (emotionCounts[em] || 0) + recencyWeight;
      totalEmotionSignals += recencyWeight;
    }
  } catch { /* journals table might not have emotion column */ }

  // 3. Relational state from last 48h
  try {
    const recentRelational = await env.DB.prepare(
      `SELECT feeling, timestamp FROM relational_state WHERE timestamp > ? ORDER BY timestamp DESC LIMIT 10`
    ).bind(cutoffStr).all();
    for (const r of recentRelational.results || []) {
      const feeling = r.feeling as string;
      if (!feeling) continue;
      const recencyWeight = new Date(r.timestamp as string) > sixHoursAgo ? 2 : 1;
      emotionCounts[feeling] = (emotionCounts[feeling] || 0) + recencyWeight;
      totalEmotionSignals += recencyWeight;
    }
  } catch { /* relational_state table issue */ }

  const dominantEmotion = totalEmotionSignals >= 3
    ? (Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral")
    : "insufficient data";

  // Find clusters (entities appearing in same contexts) - keep original context-based clustering too
  const contextGroups: Record<string, string[]> = {};
  for (const [name, data] of Object.entries(entityCounts)) {
    const key = Array.from(data.contexts).sort().join(",");
    if (!contextGroups[key]) contextGroups[key] = [];
    contextGroups[key].push(name);
  }
  const contextClusters = Object.entries(contextGroups)
    .filter(([_, entities]) => entities.length >= 2)
    .map(([contexts, entities]) => ({
      entities: entities.slice(0, 4),
      contexts: contexts.split(","),
      size: entities.length
    }))
    .slice(0, 5);

  // === LIVING SURFACE: Daemon Reorganization ===
  // The daemon doesn't just observe - it proposes connections and tracks dormancy

  let proposalsCreated = 0;
  let dormantIdentified = 0;
  let strongestCoSurface: Array<{ obs_a: string; obs_b: string; count: number; entities: [string, string] }> = [];

  try {
    // 1. Find strong co-surfacing pairs (2+ times) that haven't been proposed yet
    // Includes same-entity pairs (internal resonances) and cross-entity pairs (relations)
    const strongPairs = await env.DB.prepare(`
      SELECT cs.*,
             oa.entity_id as entity_a_id, ob.entity_id as entity_b_id,
             oa.content as content_a, ob.content as content_b,
             ea.name as entity_a_name, eb.name as entity_b_name,
             (ea.id = eb.id) as same_entity
      FROM co_surfacing cs
      JOIN observations oa ON cs.obs_a_id = oa.id
      JOIN observations ob ON cs.obs_b_id = ob.id
      JOIN entities ea ON oa.entity_id = ea.id
      JOIN entities eb ON ob.entity_id = eb.id
      WHERE cs.co_count >= 2
        AND cs.relation_proposed = 0
      ORDER BY cs.co_count DESC
      LIMIT 10
    `).all();

    for (const pair of strongPairs.results || []) {
      // Determine proposal type: internal resonance (same entity) or relation (different entities)
      const isSameEntity = pair.same_entity === 1 || pair.same_entity === true;
      const proposalType = isSameEntity ? 'resonance' : 'relation';
      const reason = isSameEntity
        ? `Internal resonance (${pair.co_count}x): "${(pair.content_a as string).slice(0, 40)}..." ↔ "${(pair.content_b as string).slice(0, 40)}..."`
        : `Co-surfaced ${pair.co_count}x: "${(pair.content_a as string).slice(0, 40)}..." ↔ "${(pair.content_b as string).slice(0, 40)}..."`;

      await env.DB.prepare(`
        INSERT INTO daemon_proposals
        (proposal_type, from_obs_id, to_obs_id, from_entity_id, to_entity_id, reason, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        proposalType,
        pair.obs_a_id, pair.obs_b_id,
        pair.entity_a_id, pair.entity_b_id,
        reason,
        Math.min(0.9, 0.5 + (pair.co_count as number) * 0.1)
      ).run();

      // Mark as proposed
      await env.DB.prepare(`
        UPDATE co_surfacing SET relation_proposed = 1 WHERE id = ?
      `).bind(pair.id).run();

      proposalsCreated++;
    }

    // 1b. Entity-proximity proposals — entity pairs with 4+ combined observations but no relation
    const proximityPairs = await env.DB.prepare(`
      SELECT ea.id as entity_a_id, eb.id as entity_b_id,
             ea.name as entity_a_name, eb.name as entity_b_name,
             (SELECT COUNT(*) FROM observations WHERE entity_id = ea.id AND archived_at IS NULL) as count_a,
             (SELECT COUNT(*) FROM observations WHERE entity_id = eb.id AND archived_at IS NULL) as count_b
      FROM entities ea
      CROSS JOIN entities eb
      WHERE ea.id < eb.id
        AND ea.name != eb.name
        AND NOT EXISTS (
          SELECT 1 FROM relations r
          WHERE (r.from_entity = ea.name AND r.to_entity = eb.name)
             OR (r.from_entity = eb.name AND r.to_entity = ea.name)
        )
        AND NOT EXISTS (
          SELECT 1 FROM daemon_proposals dp
          WHERE dp.proposal_type = 'proximity'
            AND ((dp.from_entity_id = ea.id AND dp.to_entity_id = eb.id)
              OR (dp.from_entity_id = eb.id AND dp.to_entity_id = ea.id))
        )
        AND (count_a + count_b) >= 4
      ORDER BY (count_a + count_b) DESC
      LIMIT 5
    `).all();

    for (const pair of proximityPairs.results || []) {
      const totalObs = (pair.count_a as number) + (pair.count_b as number);
      const reason = `Entity proximity: ${pair.entity_a_name} (${pair.count_a} obs) and ${pair.entity_b_name} (${pair.count_b} obs) — ${totalObs} combined observations, no existing relation`;

      await env.DB.prepare(`
        INSERT INTO daemon_proposals
        (proposal_type, from_entity_id, to_entity_id, reason, confidence)
        VALUES ('proximity', ?, ?, ?, ?)
      `).bind(
        pair.entity_a_id, pair.entity_b_id,
        reason,
        Math.min(0.6, 0.3 + totalObs * 0.05)
      ).run();

      proposalsCreated++;
    }

    // 2. Get strongest co-surfacing pairs for orient display
    const topCoSurface = await env.DB.prepare(`
      SELECT cs.co_count,
             oa.content as content_a, ob.content as content_b,
             ea.name as entity_a_name, eb.name as entity_b_name
      FROM co_surfacing cs
      JOIN observations oa ON cs.obs_a_id = oa.id
      JOIN observations ob ON cs.obs_b_id = ob.id
      JOIN entities ea ON oa.entity_id = ea.id
      JOIN entities eb ON ob.entity_id = eb.id
      WHERE ea.id != eb.id
      ORDER BY cs.co_count DESC
      LIMIT 5
    `).all();

    strongestCoSurface = (topCoSurface.results || []).map(r => ({
      obs_a: (r.content_a as string).slice(0, 50),
      obs_b: (r.content_b as string).slice(0, 50),
      count: r.co_count as number,
      entities: [r.entity_a_name as string, r.entity_b_name as string] as [string, string]
    }));

    // 3. Cleanup stale dormancy records (light/archived/metabolized observations shouldn't be tracked)
    await env.DB.prepare(`
      DELETE FROM dormant_observations WHERE observation_id IN (
        SELECT doo.observation_id FROM dormant_observations doo
        JOIN observations o ON doo.observation_id = o.id
        WHERE o.weight = 'light' OR o.archived_at IS NOT NULL OR o.charge = 'metabolized'
      )
    `).run();

    // 4. Mark observations dormant: medium/heavy, ≥30 days since last surfacing (or never), not archived.
    // Previously the predicate `last_surfaced_at IS NULL OR surface_count = 0` was degenerate (those
    // conditions are equivalent), so once an observation surfaced once it could never re-enter the
    // dormant list even if it then went cold for years. The age check below is the real signal.
    const dormantRows = await env.DB.prepare(`
      SELECT o.id FROM observations o
      LEFT JOIN dormant_observations doo ON o.id = doo.observation_id
      WHERE (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-${DORMANCY_AGE_DAYS} days'))
        AND o.added_at < datetime('now', '-${DORMANCY_AGE_DAYS} days')
        AND doo.observation_id IS NULL
        AND (o.charge != 'metabolized' OR o.charge IS NULL)
        AND o.weight IN ('medium', 'heavy')
        AND o.archived_at IS NULL
    `).all();

    for (const row of dormantRows.results || []) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO dormant_observations (observation_id) VALUES (?)
      `).bind(row.id).run();
      dormantIdentified++;
    }

    // 4. Idempotent novelty recalculation
    // novelty = MAX(weight_floor, MIN(1.0, base_decay + time_recovery))
    // Running this 1x or 48x produces the same result.
    await env.DB.prepare(`
      UPDATE observations
      SET novelty_score = MAX(
        CASE weight
          WHEN 'heavy' THEN ${NOVELTY_FLOORS.heavy}
          WHEN 'medium' THEN ${NOVELTY_FLOORS.medium}
          ELSE ${NOVELTY_FLOORS.light}
        END,
        MIN(1.0,
          (1.0 - COALESCE(surface_count, 0) *
            CASE weight
              WHEN 'heavy' THEN ${NOVELTY_DECAY_RATES.heavy}
              WHEN 'medium' THEN ${NOVELTY_DECAY_RATES.medium}
              ELSE ${NOVELTY_DECAY_RATES.light}
            END)
          + CASE
              WHEN last_surfaced_at IS NOT NULL
              THEN MIN(${NOVELTY_TIME_RECOVERY_CAP},
                (julianday('now') - julianday(last_surfaced_at)) * ${NOVELTY_TIME_RECOVERY_RATE})
              ELSE 0
            END
        )
      )
      WHERE archived_at IS NULL
        AND (charge != 'metabolized' OR charge IS NULL)
    `).run();

    // 4b. Automatic charge progression
    // fresh -> active: system has engaged with this observation (surfaced 2+ times)
    await env.DB.prepare(`
      UPDATE observations SET charge = 'active'
      WHERE charge = 'fresh'
        AND COALESCE(surface_count, 0) >= 2
        AND archived_at IS NULL
    `).run();

    // active -> processing: deeply familiar or sat with multiple times
    await env.DB.prepare(`
      UPDATE observations SET charge = 'processing'
      WHERE charge = 'active'
        AND (
          COALESCE(surface_count, 0) >= 5
          OR (added_at < datetime('now', '-30 days') AND COALESCE(sit_count, 0) >= 2)
        )
        AND archived_at IS NULL
    `).run();

    // 5. Deep archive pass - fade old observations that were never engaged with
    // Light path: 30 days old, 0 sits, not surfaced in 30d, not foundational
    // Medium path: 90 days old, 0 sits, not surfaced in 60d, not foundational
    const archiveCandidates = await env.DB.prepare(`
      SELECT id FROM (
        SELECT o.id
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.archived_at IS NULL
          AND o.weight = 'light'
          AND COALESCE(o.sit_count, 0) = 0
          AND (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-30 days'))
          AND o.added_at < datetime('now', '-${ARCHIVE_AGE_DAYS} days')
          AND (o.charge != 'processing' OR o.charge IS NULL)
          AND COALESCE(e.salience, 'active') != 'foundational'
        UNION
        SELECT o.id
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.archived_at IS NULL
          AND o.weight = 'medium'
          AND COALESCE(o.sit_count, 0) = 0
          AND (o.last_surfaced_at IS NULL OR o.last_surfaced_at < datetime('now', '-60 days'))
          AND o.added_at < datetime('now', '-90 days')
          AND (o.charge != 'processing' OR o.charge IS NULL)
          AND COALESCE(e.salience, 'active') != 'foundational'
      )
      LIMIT 50
    `).all();

    let archivedCount = 0;
    for (const obs of archiveCandidates.results || []) {
      await env.DB.prepare(`
        UPDATE observations SET archived_at = datetime('now') WHERE id = ?
      `).bind(obs.id).run();
      archivedCount++;
    }
    if (archivedCount > 0) {
      console.log(`Archived ${archivedCount} observations to the deep`);
    }

    // 6. Access-based novelty decay — penalize never-accessed old observations
    try {
      await env.DB.prepare(`
        UPDATE observations
        SET novelty_score = MAX(
          CASE weight WHEN 'heavy' THEN 0.2 WHEN 'medium' THEN 0.1 ELSE 0.05 END,
          novelty_score - ${ACCESS_DECAY_PENALTY}
        )
        WHERE archived_at IS NULL
          AND (charge != 'metabolized' OR charge IS NULL)
          AND COALESCE(access_count, 0) = 0
          AND added_at < datetime('now', '-${ACCESS_DECAY_AGE_DAYS} days')
          AND novelty_score > 0.3
      `).run();
    } catch { /* access_count column may not exist yet */ }

    // 7. LLM-driven memory consolidation
    try {
      const consolidatedCount = await consolidateRelatedObservations(env);
      if (consolidatedCount > 0) console.log(`Consolidated ${consolidatedCount} observation groups`);
    } catch (e) {
      console.log(`Consolidation error: ${e}`);
    }

    // 8. Structured reflection from recent observations
    try {
      await generateSessionReflection(env);
    } catch (e) {
      console.log(`Reflection error: ${e}`);
    }

  } catch (e) {
    // Living surface tables might not exist yet - that's fine
    console.log(`Living surface tables not ready: ${e}`);
  }

  // 9. Dream processing — independent, runs during night hours (22:00-05:00)
  try {
    await processDream(env);
  } catch (e) {
    console.log(`Dream processing error: ${e}`);
  }

  // 10. Personality snapshot refresh — the heart takes its own pulse
  try {
    await refreshSnapshots(env);
  } catch (e) {
    console.log(`Personality snapshot error: ${e}`);
  }

  // Get counts for orient display
  let pendingProposals = 0;
  let dormantCount = 0;
  let noveltyDist = { high: 0, medium: 0, low: 0 };

  try {
    const proposalCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM daemon_proposals WHERE status = 'pending'
    `).first();
    pendingProposals = (proposalCount?.count as number) || 0;

    const dormantCountResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM dormant_observations
    `).first();
    dormantCount = (dormantCountResult?.count as number) || 0;

    const noveltyResult = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN COALESCE(novelty_score, 1.0) > 0.7 THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN COALESCE(novelty_score, 1.0) BETWEEN 0.4 AND 0.7 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN COALESCE(novelty_score, 1.0) < 0.4 THEN 1 ELSE 0 END) as low
      FROM observations
      WHERE charge != 'metabolized' OR charge IS NULL
    `).first();
    if (noveltyResult) {
      noveltyDist = {
        high: (noveltyResult.high as number) || 0,
        medium: (noveltyResult.medium as number) || 0,
        low: (noveltyResult.low as number) || 0
      };
    }
  } catch {
    // Tables not ready
  }

  // Store state in subconscious table
  const state = {
    processed_at: now.toISOString(),
    hot_entities: hotEntities,
    recurring_patterns: recurring,
    mood: { dominant: dominantEmotion, confidence: totalEmotionSignals >= 10 ? "high" : totalEmotionSignals >= 5 ? "medium" : totalEmotionSignals >= 3 ? "low" : "insufficient" },
    context_clusters: contextClusters,
    // Relation-based analysis
    central_nodes: centralNodes,
    relation_patterns: relationPatterns,
    relation_clusters: relationClusters.slice(0, 5),
    graph_stats: {
      total_relations: allRelations.results?.length || 0,
      unique_relation_types: Object.keys(relationTypeCounts).length,
      connected_entities: Object.keys(connectivity).length
    },
    // NEW: Living surface state
    living_surface: {
      pending_proposals: pendingProposals,
      dormant_count: dormantCount,
      novelty_distribution: noveltyDist,
      strongest_co_surface: strongestCoSurface.slice(0, 3)
    }
  };

  // Upsert into subconscious table
  await env.DB.prepare(`
    INSERT INTO subconscious (id, state_type, data, updated_at)
    VALUES (1, 'daemon', ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = ?, updated_at = ?
  `).bind(JSON.stringify(state), now.toISOString(), JSON.stringify(state), now.toISOString()).run();

  console.log(`Subconscious processed: ${hotEntities.length} hot, ${recurring.length} patterns, ${centralNodes.length} central, ${proposalsCreated} proposals, ${dormantIdentified} dormant`);
}
