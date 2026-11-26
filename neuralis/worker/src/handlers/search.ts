import type { Env } from "../types";
import { searchVectors, getEmbedding, getSubconsciousState, imageUrl, getRelativeTime } from "../utils";
import { SEARCH_SCORING, RECENCY_DECAY_RATE, ACCESS_GROWTH_RATE } from "../config";

// Record access tracking - tracks retrieval via search, timeline, read_entity (separate from surfacing)
export async function recordAccessTracking(env: Env, obsIds: number[], imgIds: number[] = []): Promise<void> {
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

export async function handleMindSearch(env: Env, params: Record<string, unknown>): Promise<string> {
  const query = params.query as string;
  const n_results = Number(params.n_results) || 10;

  // Filter parameters
  const filterKeyword = params.keyword as string | undefined;
  const filterSource = params.source as string | undefined;
  const filterEntity = params.entity as string | undefined;
  const filterWeight = params.weight as string | undefined;
  const filterDateFrom = params.date_from as string | undefined;
  const filterDateTo = params.date_to as string | undefined;
  const filterType = params.type as string | undefined;
  const hasFilters = filterKeyword || filterSource || filterEntity || filterWeight || filterDateFrom || filterDateTo || filterType;

  // Get subconscious mood for tinting
  const subconscious = await getSubconsciousState(env);
  const mood = subconscious?.mood?.dominant;

  // Mood tinting - augment query with emotional context
  let tintedQuery = query;
  let moodNote = "";
  if (mood && subconscious?.mood?.confidence !== "low") {
    const moodTints: Record<string, string> = {
      "tender": "warm, gentle, caring, soft",
      "pride": "accomplishment, growth, achievement, recognition",
      "joy": "happiness, delight, pleasure, celebration",
      "curiosity": "wondering, exploring, investigating, discovering",
      "melancholy": "reflective, wistful, quiet, contemplative",
      "intensity": "passionate, urgent, fierce, powerful",
      "gratitude": "thankful, appreciative, blessed, fortunate",
      "longing": "yearning, missing, wanting, desire"
    };
    const tint = moodTints[mood] || mood;
    tintedQuery = `${query} (context: ${tint})`;
    moodNote = `*Search tinted by current mood: ${mood}*

`;
  }

  // Search with tinted query — fetch more when filtering by type
  const searchLimit = filterType ? n_results * 10 : n_results;
  const vectorResults = await searchVectors(env, tintedQuery, searchLimit);

  if (!vectorResults.matches?.length) {
    // Fall back to text search
    const textResults = await env.DB.prepare(
      `SELECT 'entity' as source, name as title, content
       FROM entities e JOIN observations o ON e.id = o.entity_id
       WHERE o.content LIKE ?
       UNION ALL
       SELECT 'journal' as source, entry_date as title, content
       FROM journals WHERE content LIKE ?
       LIMIT ?`
    ).bind(`%${query}%`, `%${query}%`, n_results).all();

    if (!textResults.results?.length) {
      return "No results found.";
    }

    let output = `## Search Results (text match)\n\n` + moodNote;
    for (const r of textResults.results) {
      output += `**[${r.source}] ${r.title}**
${String(r.content).slice(0, 300)}...

`;
    }
    return output;
  }

  // Separate entities, observations, and images for display
  const entityMatches: typeof vectorResults.matches = [];
  const obsMatches: typeof vectorResults.matches = [];
  const imageMatches: typeof vectorResults.matches = [];

  for (const match of vectorResults.matches) {
    const meta = match.metadata as Record<string, string>;
    const matchType = meta?.source === 'entity' ? 'entity'
      : (meta?.source === 'image' || match.id.startsWith('img-')) ? 'image'
      : match.id.startsWith('journal-') ? 'journal'
      : 'observation';

    // Apply type filter if set
    if (filterType && matchType !== filterType) continue;

    if (matchType === 'entity') {
      entityMatches.push(match);
    } else if (matchType === 'image') {
      imageMatches.push(match);
    } else {
      obsMatches.push(match);
    }
  }

  let output = `## Search Results\n\n` + moodNote;

  // Show highly relevant entities first
  const relevantEntities = entityMatches.filter(m => m.score > 0.7);
  if (relevantEntities.length > 0) {
    output += `**Entities:**\n`;
    for (const match of relevantEntities.slice(0, 5)) {
      const meta = match.metadata as Record<string, string>;
      output += `- **${meta?.name}** (${meta?.entity_type}) [${(match.score * 100).toFixed(0)}%]\n`;
    }
    output += "\n";
  }

  // Show observations - check archive status from database
  if (obsMatches.length > 0) {
    // Extract observation IDs to check archive status
    const obsIds: number[] = [];
    for (const match of obsMatches) {
      if (match.id.startsWith('obs-')) {
        const parts = match.id.split('-');
        if (parts.length >= 3) {
          obsIds.push(parseInt(parts[2]));
        }
      }
    }

    // Get observation details from D1 for filtering and display
    let obsDetails = new Map<number, {
      source: string | null;
      entity_name: string;
      weight: string | null;
      source_date: string | null;
      archived_at: string | null;
      content: string;
      access_count: number;
      added_at: string | null;
      emotion: string | null;
      valid_until: string | null;
      superseded_by: number | null;
    }>();

    if (obsIds.length > 0) {
      try {
        const placeholders = obsIds.map(() => '?').join(',');
        const obsData = await env.DB.prepare(`
          SELECT o.id, o.source, o.weight, o.source_date, o.archived_at, o.content, e.name as entity_name,
                 COALESCE(o.access_count, 0) as access_count, o.added_at, o.emotion,
                 o.valid_until, o.superseded_by
          FROM observations o
          JOIN entities e ON o.entity_id = e.id
          WHERE o.id IN (${placeholders})
        `).bind(...obsIds).all();

        for (const o of (obsData.results || [])) {
          obsDetails.set(o.id as number, {
            source: o.source as string | null,
            entity_name: o.entity_name as string,
            weight: o.weight as string | null,
            source_date: o.source_date as string | null,
            archived_at: o.archived_at as string | null,
            content: o.content as string,
            access_count: (o.access_count as number) || 0,
            added_at: o.added_at as string | null,
            emotion: o.emotion as string | null,
            valid_until: o.valid_until as string | null,
            superseded_by: o.superseded_by as number | null,
          });
        }
      } catch (e) {
        // Fallback if query fails
      }
    }

    // Apply filters if any
    let filteredMatches = obsMatches;
    if (hasFilters && obsDetails.size > 0) {
      filteredMatches = obsMatches.filter(match => {
        if (!match.id.startsWith('obs-')) return true;
        const parts = match.id.split('-');
        if (parts.length < 3) return true;
        const obsId = parseInt(parts[2]);
        const details = obsDetails.get(obsId);
        if (!details) return true;

        // Apply filters
        if (filterKeyword && !details.content.toLowerCase().includes(filterKeyword.toLowerCase())) return false;
        if (filterSource && details.source !== filterSource) return false;
        if (filterEntity && details.entity_name.toLowerCase() !== filterEntity.toLowerCase()) return false;
        if (filterWeight && details.weight !== filterWeight) return false;
        if (filterDateFrom && (!details.source_date || details.source_date < filterDateFrom)) return false;
        if (filterDateTo && (!details.source_date || details.source_date > filterDateTo)) return false;

        return true;
      });
    }

    // Phase 2: Filter out superseded/expired observations by default
    const includeExpired = params.include_expired as boolean;
    if (!includeExpired && obsDetails.size > 0) {
      filteredMatches = filteredMatches.filter(match => {
        if (!match.id.startsWith('obs-')) return true;
        const parts = match.id.split('-');
        if (parts.length < 3) return true;
        const obsId = parseInt(parts[2]);
        const details = obsDetails.get(obsId);
        if (!details) return true;
        if (details.valid_until && new Date(details.valid_until) < new Date()) return false;
        if (details.superseded_by) return false;
        return true;
      });
    }

    // Phase 1: Multi-factor composite scoring
    const now = Date.now();
    const importanceMap: Record<string, number> = { heavy: 1.0, medium: 0.6, light: 0.3 };

    const scoredMatches = filteredMatches.map(match => {
      const similarity = match.score;
      let compositeScore = similarity; // fallback if no details

      if (match.id.startsWith('obs-')) {
        const parts = match.id.split('-');
        if (parts.length >= 3) {
          const obsId = parseInt(parts[2]);
          const details = obsDetails.get(obsId);
          if (details) {
            const addedAt = details.added_at ? new Date(details.added_at).getTime() : now;
            const daysSince = Math.max(0, (now - addedAt) / 86400000);
            const recencyScore = Math.exp(-RECENCY_DECAY_RATE * daysSince);
            const importanceScore = importanceMap[details.weight || 'medium'] || 0.6;
            const accessScore = 1.0 - Math.exp(-ACCESS_GROWTH_RATE * (details.access_count || 0));
            const emotionBoost = (mood && details.emotion === mood) ? 0.1 : 0;

            compositeScore =
              SEARCH_SCORING.alpha * similarity +
              SEARCH_SCORING.beta * recencyScore +
              SEARCH_SCORING.gamma * importanceScore +
              SEARCH_SCORING.delta * accessScore +
              emotionBoost;
          }
        }
      }

      return { ...match, compositeScore };
    });

    scoredMatches.sort((a, b) => b.compositeScore - a.compositeScore);

    // Track access for returned observation IDs
    const accessedObsIds: number[] = [];
    const accessedImgIds: number[] = [];
    for (const match of scoredMatches.slice(0, n_results)) {
      if (match.id.startsWith('obs-')) {
        const parts = match.id.split('-');
        if (parts.length >= 3) accessedObsIds.push(parseInt(parts[2]));
      }
    }
    for (const match of imageMatches) {
      const imgId = parseInt(match.id.replace('img-', ''));
      if (!isNaN(imgId)) accessedImgIds.push(imgId);
    }
    recordAccessTracking(env, accessedObsIds, accessedImgIds).catch(() => {});

    // Build filter description
    let filterDesc = "";
    if (hasFilters) {
      const parts: string[] = [];
      if (filterKeyword) parts.push(`keyword="${filterKeyword}"`);
      if (filterSource) parts.push(`source=${filterSource}`);
      if (filterEntity) parts.push(`entity=${filterEntity}`);
      if (filterWeight) parts.push(`weight=${filterWeight}`);
      if (filterDateFrom) parts.push(`from=${filterDateFrom}`);
      if (filterDateTo) parts.push(`to=${filterDateTo}`);
      filterDesc = `\n*Filters: ${parts.join(', ')}*\n`;
    }

    output += `**Observations:**${filterDesc}\n`;
    for (const match of scoredMatches.slice(0, n_results)) {
      const meta = match.metadata as Record<string, string>;
      const label = meta?.entity || meta?.entity_name || meta?.title || match.id;
      const sourceType = meta?.source || 'unknown';
      const context = meta?.context ? ` [${meta.context}]` : '';

      // Get details from D1 if available
      let obsId: number | null = null;
      if (match.id.startsWith('obs-')) {
        const parts = match.id.split('-');
        if (parts.length >= 3) obsId = parseInt(parts[2]);
      }
      const details = obsId ? obsDetails.get(obsId) : null;
      const isArchived = details?.archived_at != null;
      const archivedTag = isArchived ? ' [archived]' : '';
      const supersededTag = details?.superseded_by ? ' [superseded]' : '';
      const sourceTag = details?.source ? ` (${details.source})` : '';
      const dateTag = details?.source_date ? ` [${details.source_date}]` : '';
      const displayScore = ((match as any).compositeScore * 100).toFixed(1);

      output += `**[${sourceType}]${context} ${label}**${archivedTag}${supersededTag}${sourceTag}${dateTag} (${displayScore}%)\n`;
      output += `${meta?.content?.slice(0, 300) || ''}...\n\n`;
    }
  }

  // Show image matches with viewable URLs
  if (imageMatches.length > 0) {
    output += `**Images:**\n`;
    for (const match of imageMatches) {
      const meta = match.metadata as Record<string, string>;
      const score = (match.score * 100).toFixed(1);
      const imgId = match.id.replace("img-", "");
      const entityTag = meta?.entity ? ` -> ${meta.entity}` : "";
      const emotionTag = meta?.emotion ? ` [${meta.emotion}]` : "";
      output += `**${match.id}** (${score}%)${entityTag}${emotionTag}\n`;
      output += `${meta?.description || "No description"}\n`;
      output += `View: ${await imageUrl(imgId, env)}\n\n`;
    }
  }

  // Show dream matches
  const dreamMatches = vectorResults.matches?.filter(m => m.id.startsWith('dream-')) || [];
  if (dreamMatches.length > 0) {
    output += `**Dreams:**\n`;
    for (const match of dreamMatches) {
      const meta = match.metadata as Record<string, string>;
      const score = (match.score * 100).toFixed(1);
      const dreamDate = meta?.dream_date || 'unknown';
      const recurring = meta?.recurring === 'yes' ? ' [recurring]' : '';
      output += `**dream ${dreamDate}**${recurring} (${score}%)\n`;
      output += `${meta?.content?.slice(0, 300) || ''}...\n\n`;
    }
  }

  return output;
}

export async function handleMindRead(env: Env, params: Record<string, unknown>): Promise<string> {
  const scope = (params.scope as string) || "all";
  const context = (params.context as string) || "default";
  const hours = (params.hours as number) || 24;

  try {
    if (scope === "all") {
      // Get observation contexts (context now lives on observations, not entities)
      const contexts = await env.DB.prepare(
        `SELECT DISTINCT context FROM observations ORDER BY context`
      ).all();

      const contextList = contexts.results?.map((r: any) => r.context) || ["default"];
      const allData: any = { timestamp: new Date().toISOString(), contexts: {} };

      // Total entities (now global, not per-context)
      const totalEntitiesResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM entities`).first();
      const totalRelationsResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM relations`).first();

      for (const ctx of contextList) {
        const obsCount = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM observations WHERE context = ?`
        ).bind(ctx).first();

        const entityCount = await env.DB.prepare(
          `SELECT COUNT(DISTINCT entity_id) as count FROM observations WHERE context = ?`
        ).bind(ctx).first();

        allData.contexts[ctx] = {
          observation_count: (obsCount?.count as number) || 0,
          entities_with_observations: (entityCount?.count as number) || 0
        };
      }

      allData.summary = {
        total_entities: (totalEntitiesResult?.count as number) || 0,
        total_relations: (totalRelationsResult?.count as number) || 0,
        contexts_with_content: Object.keys(allData.contexts).length
      };

      return JSON.stringify(allData, null, 2);
    }

    if (scope === "context") {
      // Find entities that have observations in this context
      const entitiesResult = await env.DB.prepare(`
        SELECT DISTINCT e.id, e.name, e.entity_type, e.primary_context, e.salience, e.created_at
        FROM entities e
        JOIN observations o ON o.entity_id = e.id
        WHERE o.context = ?
        ORDER BY e.created_at DESC
      `).bind(context).all();

      const relationsResult = await env.DB.prepare(
        `SELECT id, from_entity, to_entity, relation_type, from_context, to_context, store_in, created_at FROM relations WHERE store_in = ? ORDER BY created_at DESC LIMIT 500`
      ).bind(context).all();

      return JSON.stringify({
        context,
        entities: entitiesResult.results || [],
        relations: relationsResult.results || [],
        entity_count: entitiesResult.results?.length || 0,
        relation_count: relationsResult.results?.length || 0
      }, null, 2);
    }

    if (scope === "recent") {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      const recent = await env.DB.prepare(
        `SELECT e.name, e.entity_type, o.context, o.content, o.added_at
         FROM observations o
         JOIN entities e ON o.entity_id = e.id
         WHERE o.added_at > ?
         ORDER BY o.added_at DESC`
      ).bind(cutoff).all();

      return JSON.stringify({
        query: `Last ${hours} hours`,
        cutoff,
        observations: recent.results || [],
        observation_count: recent.results?.length || 0
      }, null, 2);
    }

    if (scope === "observation") {
      const obsId = params.observation_id as number;
      if (!obsId) return JSON.stringify({ error: "observation_id is required for scope='observation'" });

      const obs = await env.DB.prepare(`
        SELECT o.id, o.content, o.context, o.emotion, o.weight, o.certainty, o.source,
               o.charge, o.sit_count, o.last_sat_at, o.resolution_note, o.resolved_at,
               o.linked_observation_id, o.surface_count, o.last_surfaced_at, o.novelty_score,
               o.archived_at, o.added_at, o.source_date,
               COALESCE(o.access_count, 0) as access_count, o.last_accessed_at,
               o.valid_from, o.valid_until, o.superseded_by, o.supersedes,
               e.name as entity_name, e.entity_type, e.salience as entity_salience
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.id = ?
      `).bind(obsId).first();

      if (!obs) return JSON.stringify({ error: `Observation #${obsId} not found` });

      // Get sit history
      const sits = await env.DB.prepare(
        `SELECT sit_note, sat_at FROM observation_sits WHERE observation_id = ? ORDER BY sat_at DESC`
      ).bind(obsId).all();

      // Get version history
      const versions = await env.DB.prepare(
        `SELECT previous_content, previous_weight, previous_emotion, changed_at FROM observation_versions WHERE observation_id = ? ORDER BY changed_at DESC`
      ).bind(obsId).all();

      // Get supersession chain
      let supersededObs = null;
      if (obs.supersedes) {
        supersededObs = await env.DB.prepare(
          `SELECT id, content FROM observations WHERE id = ?`
        ).bind(obs.supersedes).first();
      }
      let supersededByObs = null;
      if (obs.superseded_by) {
        supersededByObs = await env.DB.prepare(
          `SELECT id, content FROM observations WHERE id = ?`
        ).bind(obs.superseded_by).first();
      }

      // Track this access
      recordAccessTracking(env, [obsId]).catch(() => {});

      const result: any = {
        id: obs.id,
        entity: { name: obs.entity_name, type: obs.entity_type, salience: obs.entity_salience },
        content: obs.content,
        context: obs.context,
        emotion: obs.emotion,
        weight: obs.weight,
        certainty: obs.certainty,
        source: obs.source,
        charge: obs.charge,
        sit_count: obs.sit_count,
        surface_count: obs.surface_count,
        access_count: obs.access_count,
        novelty_score: obs.novelty_score,
        dates: {
          added: obs.added_at,
          source_date: obs.source_date,
          last_surfaced: obs.last_surfaced_at,
          last_accessed: obs.last_accessed_at,
          last_sat: obs.last_sat_at,
          archived: obs.archived_at,
          resolved: obs.resolved_at,
          valid_from: obs.valid_from,
          valid_until: obs.valid_until,
        },
      };

      if (obs.resolution_note) result.resolution = obs.resolution_note;
      if (obs.linked_observation_id) result.linked_observation_id = obs.linked_observation_id;
      if (supersededObs) result.supersedes = { id: supersededObs.id, content: (supersededObs.content as string).slice(0, 200) };
      if (supersededByObs) result.superseded_by = { id: supersededByObs.id, content: (supersededByObs.content as string).slice(0, 200) };
      if (sits.results?.length) result.sit_history = sits.results;
      if (versions.results?.length) result.edit_history = versions.results;

      return JSON.stringify(result, null, 2);
    }

    return JSON.stringify({ error: `Invalid scope '${scope}'. Must be: all, context, recent, observation` });
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}

export async function handleMindTimeline(env: Env, params: Record<string, unknown>): Promise<string> {
  const query = params.query as string;
  const startDate = params.start_date as string;
  const endDate = params.end_date as string;
  const nResults = (params.n_results as number) || 50;

  try {
    const vectorResults = await searchVectors(env, query, nResults * 2);

    const dated: any[] = [];

    for (const match of vectorResults.matches || []) {
      const meta = match.metadata as any;
      const vectorId = match.id;

      // Try to get added_at from metadata first, fall back to DB lookup
      let addedAt = meta?.added_at;

      if (!addedAt && vectorId) {
        // Parse vector ID to look up date from database
        // Format: obs-{entity_id}-{row_id} or journal-{row_id}
        if (vectorId.startsWith('obs-')) {
          const parts = vectorId.split('-');
          const obsId = parts[parts.length - 1];
          const dbResult = await env.DB.prepare(
            `SELECT added_at FROM observations WHERE id = ?`
          ).bind(obsId).first();
          addedAt = dbResult?.added_at ? String(dbResult.added_at) : null as any;
        } else if (vectorId.startsWith('journal-')) {
          const journalId = vectorId.replace('journal-', '');
          const dbResult = await env.DB.prepare(
            `SELECT created_at FROM journals WHERE id = ?`
          ).bind(journalId).first();
          addedAt = dbResult?.created_at ? String(dbResult.created_at) : null as any;
        }
      }

      if (!addedAt) continue;

      try {
        const ts = new Date(addedAt);

        if (startDate && ts < new Date(startDate)) continue;
        if (endDate && ts > new Date(endDate)) continue;

        dated.push({
          date: ts.toISOString().split('T')[0],
          timestamp: ts,
          content: meta?.content || meta?.text,
          entity: meta?.entity || meta?.entity_name,
          database: meta?.context,
          score: match.score
        });
      } catch {
        continue;
      }
    }

    dated.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const byMonth: Record<string, any[]> = {};
    for (const item of dated) {
      const monthKey = item.timestamp.toISOString().substring(0, 7);
      if (!byMonth[monthKey]) byMonth[monthKey] = [];
      byMonth[monthKey].push({
        date: item.date,
        content: item.content,
        entity: item.entity,
        database: item.database
      });
    }

    const timeline = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, memories]) => ({
        period,
        count: memories.length,
        memories
      }));

    // Track access for timeline observations
    const timelineObsIds: number[] = [];
    for (const match of vectorResults.matches || []) {
      if (match.id.startsWith('obs-')) {
        const parts = match.id.split('-');
        if (parts.length >= 3) timelineObsIds.push(parseInt(parts[parts.length - 1]));
      }
    }
    recordAccessTracking(env, timelineObsIds).catch(() => {});

    return JSON.stringify({
      query,
      date_range: { from: startDate || "earliest", to: endDate || "latest" },
      total_memories: dated.length,
      timeline
    }, null, 2);
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}

export async function handleMindPatterns(env: Env, params: Record<string, unknown>): Promise<string> {
  const days = (params.days as number) || 7;
  const includeAllTime = (params.include_all_time as boolean) !== false;

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get subconscious state for mood and hot entities
    const subconscious = await getSubconsciousState(env);
    const hotEntities = subconscious?.hot_entities || [];
    const hotMap = new Map(hotEntities.map((e: any) => [e.name, e.warmth]));

    const activity = await env.DB.prepare(
      `SELECT e.name, COUNT(o.id) as obs_count
       FROM entities e
       LEFT JOIN observations o ON e.id = o.entity_id AND o.added_at > ?
       GROUP BY e.id, e.name
       HAVING COUNT(o.id) > 0
       ORDER BY COUNT(o.id) DESC
       LIMIT 15`
    ).bind(cutoff).all();

    // Blend activity with warmth
    const blendedFocus: Array<{entity: string; observations: number; warmth?: number}> = [];
    for (const item of activity.results || []) {
      const name = item.name as string;
      const warmth = hotMap.get(name);
      blendedFocus.push({
        entity: name,
        observations: item.obs_count as number,
        warmth: warmth as number | undefined
      });
    }
    // Sort by warmth first, then observations
    blendedFocus.sort((a, b) => {
      const warmthA = a.warmth || 0;
      const warmthB = b.warmth || 0;
      if (warmthA !== warmthB) return warmthB - warmthA;
      return b.observations - a.observations;
    });

    const salience = await env.DB.prepare(
      `SELECT salience, COUNT(*) as count FROM observations GROUP BY salience`
    ).all();

    const salienceMap: Record<string, number> = {};
    for (const row of salience.results || []) {
      salienceMap[row.salience as string || 'unset'] = row.count as number;
    }

    const weights = await env.DB.prepare(
      `SELECT weight, COUNT(*) as count FROM observations WHERE added_at > ? GROUP BY weight`
    ).bind(cutoff).all();

    // Get total observations for activity summary
    const totalObs = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM observations WHERE added_at > ?`
    ).bind(cutoff).first() as {count: number} | null;
    const totalRecent = totalObs?.count || 0;
    const dailyAvg = Math.round((totalRecent / days) * 10) / 10;

    const output: string[] = [];
    output.push("=".repeat(60));
    output.push(`PATTERNS — Last ${days} days`);
    output.push("=".repeat(60));

    // MOOD - from subconscious
    const mood = subconscious?.mood;
    if (mood && mood.dominant && mood.dominant !== "neutral") {
      output.push("");
      output.push("-".repeat(60));
      output.push("MOOD");
      output.push("-".repeat(60));
      output.push(`  Current: ${mood.dominant}`);
      if (mood.undercurrent) {
        output.push(`  Undercurrent: ${mood.undercurrent}`);
      }
    }

    // WHAT'S ALIVE - blended with warmth
    output.push("");
    output.push("-".repeat(60));
    output.push("WHAT'S ALIVE");
    output.push("-".repeat(60));

    if (blendedFocus.length) {
      for (const item of blendedFocus.slice(0, 10)) {
        if (item.warmth) {
          output.push(`  - ${item.entity} (${item.observations} obs, warmth: ${item.warmth.toFixed(1)})`);
        } else {
          output.push(`  - ${item.entity} (${item.observations} obs)`);
        }
      }
    } else {
      output.push("  (no recent activity)");
    }

    // EMOTIONAL WEIGHT
    output.push("");
    output.push("-".repeat(60));
    output.push("EMOTIONAL WEIGHT");
    output.push("-".repeat(60));
    for (const row of weights.results || []) {
      output.push(`  ${row.weight || 'unset'}: ${row.count}`);
    }

    // ACTIVITY SUMMARY
    output.push("");
    output.push("-".repeat(60));
    output.push("ACTIVITY");
    output.push("-".repeat(60));
    output.push(`  Total observations: ${totalRecent}`);
    output.push(`  Daily average: ${dailyAvg}`);

    // SALIENCE DISTRIBUTION
    output.push("");
    output.push("-".repeat(60));
    output.push("SALIENCE DISTRIBUTION");
    output.push("-".repeat(60));
    for (const [key, count] of Object.entries(salienceMap)) {
      output.push(`  ${key}: ${count}`);
    }

    // FOUNDATIONAL CORE
    if (includeAllTime) {
      const foundational = await env.DB.prepare(
        `SELECT name, entity_type, primary_context FROM entities WHERE salience = 'foundational'`
      ).all();

      if (foundational.results?.length) {
        output.push("");
        output.push("-".repeat(60));
        output.push("FOUNDATIONAL CORE");
        output.push("-".repeat(60));
        // Group by primary context
        const byContext: Record<string, string[]> = {};
        for (const entity of foundational.results) {
          const ctx = (entity.primary_context as string) || 'default';
          if (!byContext[ctx]) byContext[ctx] = [];
          byContext[ctx].push(entity.name as string);
        }
        for (const [ctx, names] of Object.entries(byContext)) {
          output.push(`  ${ctx}: ${names.slice(0, 5).join(', ')}`);
          if (names.length > 5) {
            output.push(`    ... and ${names.length - 5} more`);
          }
        }
      }
    }

    output.push("");
    output.push("=".repeat(60));

    return output.join("\n");
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}
