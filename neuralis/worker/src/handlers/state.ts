import type { Env } from "../types";
import { getSubconsciousState, generateId, getRelativeTime } from "../utils";
import { DORMANCY_AGE_DAYS } from "../config";
import { getCurrentWeather, getTimeOfDayContext, getLocation, WEATHER_MOODS } from "../context";

async function handleMindIdentity(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";

  if (action === "delete") {
    const section = params.section as string;
    if (!section) return "section required for delete";
    const existing = await env.DB.prepare(`SELECT COUNT(*) as c FROM identity WHERE section = ?`).bind(section).first();
    if (!existing?.c) return `No identity entries found for section '${section}'`;
    await env.DB.prepare(`DELETE FROM identity WHERE section = ?`).bind(section).run();
    return `Deleted ${existing.c} identity entries from section '${section}'`;
  }

  if (action === "write") {
    const section = params.section as string;
    const content = params.content as string;
    const weight = (params.weight as number) || 0.7;
    const connections = params.connections as string || "";

    await env.DB.prepare(
      `INSERT INTO identity (section, content, weight, connections) VALUES (?, ?, ?, ?)`
    ).bind(section, content, weight, connections).run();

    return `Identity entry added to ${section}`;
  } else {
    const section = params.section as string;

    const query = section
      ? `SELECT section, content, weight, connections FROM identity WHERE section LIKE ? ORDER BY weight DESC`
      : `SELECT section, content, weight, connections FROM identity ORDER BY weight DESC LIMIT 50`;

    const results = section
      ? await env.DB.prepare(query).bind(`${section}%`).all()
      : await env.DB.prepare(query).all();

    if (!results.results?.length) {
      return "No identity entries found.";
    }

    let output = "## Identity Graph\n\n";
    for (const r of results.results) {
      output += `**${r.section}** [${r.weight}]\n${r.content}\n`;
      if (r.connections) output += `Connections: ${r.connections}\n`;
      output += "\n";
    }
    return output;
  }
}

async function handleMindContext(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";

  switch (action) {
    case "read": {
      const scope = params.scope as string;
      const query = scope
        ? `SELECT * FROM context_entries WHERE scope = ? ORDER BY updated_at DESC LIMIT 200`
        : `SELECT * FROM context_entries ORDER BY updated_at DESC LIMIT 200`;
      const results = scope
        ? await env.DB.prepare(query).bind(scope).all()
        : await env.DB.prepare(query).all();

      if (!results.results?.length) {
        return "No context entries found.";
      }

      let output = "## Context Layer\n\n";
      for (const r of results.results) {
        output += `**[${r.scope}]** ${r.content}\n`;
        if (r.links && r.links !== '[]') output += `Links: ${r.links}\n`;
        output += "\n";
      }
      return output;
    }

    case "set": {
      const id = generateId("ctx");
      const scope = params.scope as string;
      const content = params.content as string;
      const links = params.links || "[]";

      await env.DB.prepare(
        `INSERT INTO context_entries (id, scope, content, links) VALUES (?, ?, ?, ?)`
      ).bind(id, scope, content, links).run();

      return `Context entry created: ${id}`;
    }

    case "update": {
      const id = params.id as string;
      const content = params.content as string;

      await env.DB.prepare(
        `UPDATE context_entries SET content = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(content, id).run();

      return `Context entry updated: ${id}`;
    }

    case "clear": {
      const id = params.id as string;
      const scope = params.scope as string;

      if (id) {
        await env.DB.prepare(`DELETE FROM context_entries WHERE id = ?`).bind(id).run();
        return `Context entry deleted: ${id}`;
      } else if (scope) {
        await env.DB.prepare(`DELETE FROM context_entries WHERE scope = ?`).bind(scope).run();
        return `All context entries in scope '${scope}' deleted`;
      } else {
        // Clear ALL context entries
        const count = await env.DB.prepare(`SELECT COUNT(*) as count FROM context_entries`).first();
        await env.DB.prepare(`DELETE FROM context_entries`).run();
        return `All context entries cleared (${count?.count || 0} deleted)`;
      }
    }

    default:
      return `Unknown action: ${action}`;
  }
}


async function handleMindHealth(env: Env): Promise<string> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Get subconscious state first
  const subconscious = await getSubconsciousState(env);

  const [
    entityCount, obsCount, relationsCount, activeThreads, staleThreads,
    resolvedRecent, journalCount, journalsRecent, identityCount, awaitingChargeCount,
    contextCount, relationalCount, entitiesByContext, recentObs,
    // v2.0.0 additions
    imageCount, proposalCount, dormantBroadCount, dormantTrackedCount, archivedObsCount,
    salienceFoundational, salienceActive, salienceBackground, salienceArchive,
    avgNovelty, surfacedRecent,
    // Graph health
    isolatedCount, underConnectedCount
  ] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM relations`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'active'`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'active' AND updated_at < ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM threads WHERE status = 'resolved' AND resolved_at > ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM journals`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM journals WHERE created_at > ?`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM identity`).first(),
    // Awaiting Charge: fresh observations older than a week — sat without being engaged.
    // (active/processing are already in flight, not awaiting; metabolized are done.)
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations WHERE charge = 'fresh' AND added_at < ? AND archived_at IS NULL`).bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM context_entries`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM relational_state`).first(),
    env.DB.prepare(`SELECT context, COUNT(*) as c FROM observations WHERE archived_at IS NULL GROUP BY context`).all(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations WHERE added_at > ?`).bind(sevenDaysAgo).first(),
    // v2.0.0 queries
    env.DB.prepare(`SELECT COUNT(*) as c FROM images`).first().catch(() => ({ c: 0 })),
    env.DB.prepare(`SELECT COUNT(*) as c FROM daemon_proposals WHERE status = 'pending'`).first().catch(() => ({ c: 0 })),
    // Dormant (broad): any observation that hasn't surfaced in 30d. The honest "wide" view.
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations WHERE (last_surfaced_at IS NULL OR last_surfaced_at < ?) AND (charge != 'metabolized' OR charge IS NULL) AND added_at < ? AND archived_at IS NULL`).bind(thirtyDaysAgo, thirtyDaysAgo).first().catch(() => ({ c: 0 })),
    // Dormant (tracked): explicitly marked by the dormancy cron — medium/heavy only.
    // Matches the filter used by `mind_dormant list` so the two views agree.
    env.DB.prepare(`SELECT COUNT(*) as c FROM dormant_observations doo JOIN observations o ON doo.observation_id = o.id WHERE (o.charge != 'metabolized' OR o.charge IS NULL) AND o.archived_at IS NULL`).first().catch(() => ({ c: 0 })),
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations WHERE archived_at IS NOT NULL`).first().catch(() => ({ c: 0 })),
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities WHERE salience = 'foundational'`).first().catch(() => ({ c: 0 })),
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities WHERE salience = 'active' OR salience IS NULL`).first().catch(() => ({ c: 0 })),
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities WHERE salience = 'background'`).first().catch(() => ({ c: 0 })),
    env.DB.prepare(`SELECT COUNT(*) as c FROM entities WHERE salience = 'archive'`).first().catch(() => ({ c: 0 })),
    // Avg Novelty excludes archived + metabolized — they're decayed and would drag the live average down.
    env.DB.prepare(`SELECT AVG(novelty_score) as avg FROM observations WHERE novelty_score IS NOT NULL AND archived_at IS NULL AND (charge != 'metabolized' OR charge IS NULL)`).first().catch(() => ({ avg: null })),
    // Surfaced (7d) excludes archived + metabolized — surfacing dead memory doesn't count as engagement.
    env.DB.prepare(`SELECT COUNT(*) as c FROM observations WHERE last_surfaced_at > ? AND archived_at IS NULL AND (charge != 'metabolized' OR charge IS NULL)`).bind(sevenDaysAgo).first().catch(() => ({ c: 0 })),
    // Graph health
    env.DB.prepare(`
      SELECT COUNT(*) as c FROM entities e
      WHERE COALESCE(e.intentionally_isolated, 0) = 0
        AND (e.salience IS NULL OR e.salience NOT IN ('archive'))
        AND NOT EXISTS (
          SELECT 1 FROM relations r WHERE r.from_entity = e.name OR r.to_entity = e.name
        )
    `).first().catch(() => ({ c: 0 })),
    // Under-connected mirrors `mind_isolated list` exactly — rel_count = 1 AND obs_count >= 3 —
    // so the count agrees with what the tool actually shows.
    env.DB.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT e.id FROM entities e
        LEFT JOIN observations o ON o.entity_id = e.id AND o.archived_at IS NULL
        WHERE COALESCE(e.intentionally_isolated, 0) = 0
          AND (e.salience IS NULL OR e.salience NOT IN ('archive'))
        GROUP BY e.id
        HAVING (SELECT COUNT(*) FROM relations r WHERE r.from_entity = e.name OR r.to_entity = e.name) = 1
           AND COUNT(o.id) >= 3
      )
    `).first().catch(() => ({ c: 0 }))
  ]);

  const entities = entityCount?.c as number || 0;
  const observations = obsCount?.c as number || 0;
  const relations = relationsCount?.c as number || 0;
  const active = activeThreads?.c as number || 0;
  const stale = staleThreads?.c as number || 0;
  const resolved7d = resolvedRecent?.c as number || 0;
  const journals = journalCount?.c as number || 0;
  const journals7d = journalsRecent?.c as number || 0;
  const identity = identityCount?.c as number || 0;
  const awaitingCharge = awaitingChargeCount?.c as number || 0;  // observations awaiting emotional processing
  const context = contextCount?.c as number || 0;
  const relational = relationalCount?.c as number || 0;
  const recentObsCount = recentObs?.c as number || 0;

  // v2.0.0 values
  const images = (imageCount as Record<string, unknown>)?.c as number || 0;
  const pendingProposals = (proposalCount as Record<string, unknown>)?.c as number || 0;
  const dormantBroad = (dormantBroadCount as Record<string, unknown>)?.c as number || 0;
  const dormantTracked = (dormantTrackedCount as Record<string, unknown>)?.c as number || 0;
  const archivedObs = (archivedObsCount as Record<string, unknown>)?.c as number || 0;
  const foundational = (salienceFoundational as Record<string, unknown>)?.c as number || 0;
  const activeEntities = (salienceActive as Record<string, unknown>)?.c as number || 0;
  const background = (salienceBackground as Record<string, unknown>)?.c as number || 0;
  const archived = (salienceArchive as Record<string, unknown>)?.c as number || 0;
  const noveltyAvg = (avgNovelty as Record<string, unknown>)?.avg as number || null;
  const surfaced7d = (surfacedRecent as Record<string, unknown>)?.c as number || 0;
  const isolated = (isolatedCount as Record<string, unknown>)?.c as number || 0;
  const underConnected = (underConnectedCount as Record<string, unknown>)?.c as number || 0;

  const contextBreakdown = (entitiesByContext?.results || [])
    .map((r: Record<string, unknown>) => `${r.context}: ${r.c}`)
    .join(", ");

  // Calculate subconscious health
  let subconsciousScore = 0;
  let subconsciousStatus = "never run";
  let subconsciousAge = "unknown";
  let subconsciousMood = "none detected";
  let subconsciousHotCount = 0;

  if (subconscious?.processed_at) {
    const processedTime = new Date(subconscious.processed_at).getTime();
    const ageMs = now.getTime() - processedTime;
    const ageHours = Math.round(ageMs / (1000 * 60 * 60));
    const ageMins = Math.round(ageMs / (1000 * 60));

    if (ageMins < 60) {
      subconsciousAge = `${ageMins}m ago`;
    } else {
      subconsciousAge = `${ageHours}h ago`;
    }

    // Score based on ageMs to avoid rounding mismatches between ageMins and ageHours
    const ONE_HOUR = 60 * 60 * 1000;
    if (ageMs < ONE_HOUR) {
      subconsciousScore = 100;
      subconsciousStatus = "fresh";
    } else if (ageMs < 2 * ONE_HOUR) {
      subconsciousScore = 70;
      subconsciousStatus = "recent";
    } else if (ageMs < 6 * ONE_HOUR) {
      subconsciousScore = 40;
      subconsciousStatus = "stale";
    } else {
      subconsciousScore = 10;
      subconsciousStatus = "VERY STALE";
    }

    if (subconscious.mood?.dominant) {
      subconsciousMood = subconscious.mood.dominant;
      if (subconscious.mood.confidence) {
        subconsciousMood += ` (${subconscious.mood.confidence})`;
      }
    }
    subconsciousHotCount = subconscious.hot_entities?.length || 0;
  }

  const dbScore = Math.min(100, Math.round((entities / 100) * 50 + (observations / 500) * 50));
  const threadScore = active > 0 ? (stale < 3 ? 100 : stale < 6 ? 60 : 30) : 50;
  const journalScore = journals7d >= 3 ? 100 : journals7d >= 1 ? 70 : journals > 0 ? 40 : 0;
  const identityScore = identity >= 50 ? 100 : Math.round((identity / 50) * 100);
  const activityScore = recentObsCount >= 20 ? 100 : Math.round((recentObsCount / 20) * 100);

  // Include subconscious in overall score
  const overallScore = Math.round((dbScore + threadScore + journalScore + identityScore + activityScore + subconsciousScore) / 6);

  const icon = (s: number) => s >= 70 ? "\u{1F7E2}" : s >= 40 ? "\u{1F7E1}" : "\u{1F534}";
  const bar = (s: number) => "\u{2588}".repeat(Math.floor(s / 10)) + "\u{2591}".repeat(10 - Math.floor(s / 10));

  const dateStr = now.toISOString().split('T')[0];

  return `============================================================
MIND HEALTH \u{2014} ${dateStr}
============================================================

Overall: ${bar(overallScore)} ${overallScore}%

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F9E0} SUBCONSCIOUS              ${icon(subconsciousScore)}
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Last Processed: ${subconsciousAge} (${subconsciousStatus})
  Current Mood:   ${subconsciousMood}
  Hot Entities:   ${subconsciousHotCount}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F4CA} DATABASE                 ${icon(dbScore)}
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Entities:        ${entities}
  Observations:    ${observations} (${observations - archivedObs} live, ${archivedObs} archived)
  Relations:       ${relations}
  Obs by Context:  ${contextBreakdown || "none"}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F9F5} THREADS                  ${icon(threadScore)}
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Active:        ${active}
  Stale (7d+):   ${stale}
  Resolved (7d): ${resolved7d}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F4D4} JOURNALS                 ${icon(journalScore)}
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Total:         ${journals}
  This Week:     ${journals7d}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1FA9E} IDENTITY                 ${icon(identityScore)}
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Identity:      ${identity} entries
  Context:       ${context} entries
  Relational:    ${relational} states

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F4DD} ACTIVITY (7d)            ${icon(activityScore)}
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  New Observations:   ${recentObsCount}
  Surfaced (7d):      ${surfaced7d}
  Awaiting Charge:    ${awaitingCharge} (need emotional processing)

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F578} GRAPH HEALTH
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Total Relations:        ${relations}
  Isolated Entities:      ${isolated} (no relations)
  Under-connected:        ${underConnected} (1 relation only)
  Pending Proposals:      ${pendingProposals}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F30A} SURFACING
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Avg Novelty:            ${noveltyAvg !== null ? noveltyAvg.toFixed(2) : 'n/a'}
  Dormant 30d+ (broad):   ${dormantBroad}
  Dormant tracked:        ${dormantTracked} (cron-marked, medium/heavy only)
  Archived Obs:           ${archivedObs}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F465} ENTITY SALIENCE
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Foundational:     ${foundational}
  Active:           ${activeEntities}
  Background:       ${background}
  Archive:          ${archived}

\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
\u{1F5BC} VISUAL MEMORY
\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
  Images:           ${images}

============================================================`;
}

async function handleMindInnerWeather(env: Env): Promise<string> {
  try {
    // Get actual weather
    const weather = await getCurrentWeather(env);
    const timeCtx = getTimeOfDayContext(getLocation(env).timezone);

    const atmosphere = weather.atmosphere;
    const weatherMood = WEATHER_MOODS[atmosphere] || WEATHER_MOODS["clear"];

    // The subconscious already computes a real mood from the corpus. Use it.
    // Weather is weather; it is not how anyone feels.
    const subconscious = await getSubconsciousState(env);
    const subconsciousMood = subconscious?.mood?.dominant || null;

    // Get threads for workload context
    const threads = await env.DB.prepare(
      `SELECT priority, COUNT(*) as count FROM threads
       WHERE status = 'active' GROUP BY priority`
    ).all();

    const highPriority = ((threads.results || []).find((r: any) => r.priority === 'high')?.count as number) || 0;
    const totalActive = (threads.results || []).reduce((sum: number, r: any) => sum + (r.count as number), 0);

    // Get high priority thread content
    const pressingThreads = await env.DB.prepare(
      `SELECT content, thread_type FROM threads
       WHERE status = 'active' AND priority = 'high' LIMIT 3`
    ).all();

    const pressing = (pressingThreads.results || []).map((t: any) => ({
      content: String(t.content).slice(0, 100),
      type: t.thread_type
    }));

    // Get recent emotional observations
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentEmotional = await env.DB.prepare(
      `SELECT o.content FROM observations o
       WHERE o.weight IN ('heavy','medium') AND o.added_at > ?
       ORDER BY o.added_at DESC LIMIT 3`
    ).bind(cutoff).all();

    const emotionalContent = (recentEmotional.results || []).map((r: any) =>
      String(r.content).slice(0, 80)
    );

    // Get heavy observations from last 24h
    const heavyObs = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM observations WHERE weight = 'heavy' AND added_at > ?`
    ).bind(cutoff).first() as {count: number} | null;

    // Build mood palette
    const palette = new Set<string>();
    weatherMood.textures.slice(0, 2).forEach(t => palette.add(t));
    timeCtx.textures.slice(0, 1).forEach(t => palette.add(t));

    if (highPriority > 0) palette.add("weighted");
    if (totalActive > 5) palette.add("full");
    if ((heavyObs?.count || 0) > 0) palette.add("heavy");

    const result: Record<string, any> = {
      timestamp: new Date().toISOString(),
      conditions: {
        weather: weather.temp_f ? `${atmosphere} (${weather.temp_f}F)` : atmosphere,
        location: weather.location,
        time: timeCtx.period,
        time_energy: timeCtx.energy,
        // Fields needed by dashboard
        active_threads: totalActive,
        high_priority: highPriority,
        heavy_observations_24h: heavyObs?.count || 0,
        dominant_emotion: subconsciousMood || "not yet processed"
      },
      mood_palette: Array.from(palette),
      weather_energy: weatherMood.energy,
      guidance: `Textures present: ${Array.from(palette).join(", ")}`
    };

    // Only include if there's data
    if (pressing.length > 0) {
      result.pressing = pressing;
    }
    if (emotionalContent.length > 0) {
      result.recent_emotional = emotionalContent.slice(0, 2);
    }

    // Debug: include raw weather data
    if (weather.error || weather.weather_code !== undefined) {
      result.weather_debug = {
        code: weather.weather_code,
        temp: weather.temp_f,
        error: weather.error
      };
    }

    return JSON.stringify(result, null, 2);
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}

async function handleMindTension(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;

  try {
    if (action === "list") {
      const tensions = await env.DB.prepare(
        `SELECT id, pole_a, pole_b, context, created_at, visits
         FROM tensions WHERE resolved_at IS NULL
         ORDER BY created_at DESC`
      ).all();

      const resolved = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM tensions WHERE resolved_at IS NOT NULL`
      ).first();

      const output: string[] = [];
      output.push("=".repeat(50));
      output.push("TENSION SPACE");
      output.push("=".repeat(50));

      if (tensions.results?.length) {
        for (const t of tensions.results) {
          const created = new Date(t.created_at as string);
          const now = new Date();
          const days = Math.floor((now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));

          output.push("");
          output.push(`[${String(t.id).slice(0, 12)}...] (${days}d)`);
          output.push(`   A: ${String(t.pole_a).slice(0, 60)}`);
          output.push(`   B: ${String(t.pole_b).slice(0, 60)}`);
          if (t.context) output.push(`   Why: ${String(t.context).slice(0, 50)}`);
          if (t.visits) output.push(`   Sat with ${t.visits} time(s)`);
        }
      } else {
        output.push("");
        output.push("No active tensions.");
      }

      output.push("");
      output.push(`Resolved: ${(resolved?.count as number) || 0}`);
      output.push("=".repeat(50));

      return output.join("\n");
    }

    if (action === "add") {
      const poleA = params.pole_a as string;
      const poleB = params.pole_b as string;

      if (!poleA || !poleB) {
        return JSON.stringify({ error: "pole_a and pole_b required for action='add'" });
      }

      const tensionId = generateId('tension');
      const tensionContext = params.context as string;

      await env.DB.prepare(
        `INSERT INTO tensions (id, pole_a, pole_b, context, visits, created_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))`
      ).bind(tensionId, poleA, poleB, tensionContext || null).run();

      return JSON.stringify({
        success: true,
        tension_id: tensionId,
        message: "Tension added. Let it simmer.",
        tension: { pole_a: poleA, pole_b: poleB, context: tensionContext }
      }, null, 2);
    }

    if (action === "sit") {
      const tensionId = params.tension_id as string;

      if (!tensionId) {
        return JSON.stringify({ error: "tension_id required for action='sit'" });
      }

      const tension = await env.DB.prepare(
        `SELECT * FROM tensions WHERE id LIKE ? OR id = ?`
      ).bind(`${tensionId}%`, tensionId).first();

      if (!tension) {
        return JSON.stringify({ error: `Tension '${tensionId}' not found` });
      }

      await env.DB.prepare(
        `UPDATE tensions SET visits = visits + 1, last_visited = datetime('now') WHERE id = ?`
      ).bind(tension.id as string).run();

      return JSON.stringify({
        success: true,
        tension_id: tension.id,
        pole_a: tension.pole_a,
        pole_b: tension.pole_b,
        context: tension.context,
        visits: (tension.visits as number) + 1,
        prompt: "Sit with this. What does holding both poles feel like?"
      }, null, 2);
    }

    if (action === "resolve") {
      const tensionId = params.tension_id as string;
      const resolution = params.resolution as string;

      if (!tensionId) {
        return JSON.stringify({ error: "tension_id required for action='resolve'" });
      }

      const tension = await env.DB.prepare(
        `SELECT * FROM tensions WHERE id LIKE ? OR id = ?`
      ).bind(`${tensionId}%`, tensionId).first();

      if (!tension) {
        return JSON.stringify({ error: `Tension '${tensionId}' not found` });
      }

      await env.DB.prepare(
        `UPDATE tensions SET resolved_at = datetime('now'), resolution = ? WHERE id = ?`
      ).bind(resolution || null, tension.id as string).run();

      return JSON.stringify({
        success: true,
        tension_id: tension.id,
        resolution,
        message: "Tension resolved. The poles collapsed into something new."
      }, null, 2);
    }

    if (action === "delete") {
      const tensionId = params.tension_id as string;
      if (!tensionId) return JSON.stringify({ error: "tension_id required for action='delete'" });
      const tension = await env.DB.prepare(`SELECT pole_a, pole_b FROM tensions WHERE id LIKE ? OR id = ?`).bind(`${tensionId}%`, tensionId).first();
      if (!tension) return JSON.stringify({ error: `Tension '${tensionId}' not found` });
      await env.DB.prepare(`DELETE FROM tensions WHERE id LIKE ? OR id = ?`).bind(`${tensionId}%`, tensionId).run();
      return JSON.stringify({ success: true, message: `Deleted tension: ${tension.pole_a} <-> ${tension.pole_b}` });
    }

    return JSON.stringify({ error: `Invalid action '${action}'. Must be: list, add, sit, resolve, delete` });
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}

export { handleMindIdentity, handleMindContext, handleMindHealth, handleMindInnerWeather, handleMindTension };
