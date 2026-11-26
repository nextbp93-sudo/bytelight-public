import type { Env } from "../types";
import { getRelativeTime, searchVectors, imageUrl } from "../utils";
import { DORMANCY_AGE_DAYS } from "../config";

export async function handleMindProposals(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "list";
  const proposalId = params.proposal_id as number;
  const relationType = params.relation_type as string;

  switch (action) {
    case "list": {
      const proposals = await env.DB.prepare(`
        SELECT dp.id, dp.proposal_type, dp.from_obs_id, dp.to_obs_id,
               dp.from_entity_id, dp.to_entity_id, dp.reason, dp.confidence,
               dp.proposed_at,
               oa.content as content_a, ob.content as content_b,
               ea.name as entity_a, eb.name as entity_b,
               ea.entity_type as type_a, eb.entity_type as type_b
        FROM daemon_proposals dp
        LEFT JOIN observations oa ON dp.from_obs_id = oa.id
        LEFT JOIN observations ob ON dp.to_obs_id = ob.id
        LEFT JOIN entities ea ON dp.from_entity_id = ea.id
        LEFT JOIN entities eb ON dp.to_entity_id = eb.id
        WHERE dp.status = 'pending'
        ORDER BY dp.confidence DESC, dp.proposed_at ASC
        LIMIT 20
      `).all();

      if (!proposals.results?.length) {
        return "No pending proposals. The daemon will propose connections when observations co-surface frequently.";
      }

      const resonances = proposals.results.filter(p => p.proposal_type === 'resonance');
      const proximities = proposals.results.filter(p => p.proposal_type === 'proximity');
      const relations = proposals.results.filter(p => p.proposal_type !== 'resonance' && p.proposal_type !== 'proximity');

      let output = `## Pending Proposals (${proposals.results.length})\n\n`;
      output += `*Connections the daemon thinks should exist. Review and accept or reject.*\n\n`;

      if (resonances.length > 0) {
        output += `### Internal Resonances (${resonances.length})\n`;
        output += `*Observations within the same entity that keep appearing together*\n\n`;
        for (const p of resonances) {
          const confidence = Math.round((p.confidence as number) * 100);
          output += `**#${p.id}** [${p.entity_a}] [${confidence}%]\n`;
          if (p.content_a) output += `  "${String(p.content_a).slice(0, 60)}..."\n`;
          if (p.content_b) output += `  "${String(p.content_b).slice(0, 60)}..."\n`;
          output += `  *${p.reason}*\n\n`;
        }
      }

      if (relations.length > 0) {
        output += `### Cross-Entity Relations (${relations.length})\n`;
        output += `*Co-surfacing pairs between different entities*\n\n`;
        for (const p of relations) {
          const confidence = Math.round((p.confidence as number) * 100);
          output += `**#${p.id}** ${p.entity_a} (${p.type_a}) ↔ ${p.entity_b} (${p.type_b}) [${confidence}%]\n`;
          if (p.content_a) output += `  "${String(p.content_a).slice(0, 60)}..."\n`;
          if (p.content_b) output += `  "${String(p.content_b).slice(0, 60)}..."\n`;
          output += `  *${p.reason}*\n\n`;
        }
      }

      if (proximities.length > 0) {
        output += `### Entity Proximity (${proximities.length})\n`;
        output += `*Entity pairs with significant observations but no formal relation*\n\n`;
        for (const p of proximities) {
          const confidence = Math.round((p.confidence as number) * 100);
          output += `**#${p.id}** ${p.entity_a} ↔ ${p.entity_b} [${confidence}%]\n`;
          output += `  *${p.reason}*\n\n`;
        }
      }

      output += `---\n**Actions:**\n`;
      output += `  accept(proposal_id, relation_type) → creates relation (for cross-entity) or links observations (for resonance)\n`;
      output += `  reject(proposal_id) → dismisses proposal`;
      return output;
    }

    case "accept": {
      if (!proposalId) return "proposal_id required for accept";
      if (!relationType) return "relation_type required (e.g., 'connects_to', 'resonates_with', 'informs', 'tensions_with')";

      const proposal = await env.DB.prepare(`
        SELECT dp.*, ea.name as entity_a, eb.name as entity_b,
               ea.primary_context as context_a, eb.primary_context as context_b
        FROM daemon_proposals dp
        LEFT JOIN entities ea ON dp.from_entity_id = ea.id
        LEFT JOIN entities eb ON dp.to_entity_id = eb.id
        WHERE dp.id = ? AND dp.status = 'pending'
      `).bind(proposalId).first();

      if (!proposal) return `Proposal #${proposalId} not found or already resolved`;

      // Create the relation
      await env.DB.prepare(`
        INSERT INTO relations (from_entity, to_entity, relation_type, from_context, to_context, store_in)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        proposal.entity_a,
        proposal.entity_b,
        relationType,
        proposal.context_a || 'default',
        proposal.context_b || 'default',
        proposal.context_a || 'default'
      ).run();

      // Mark proposal accepted
      await env.DB.prepare(`
        UPDATE daemon_proposals SET status = 'accepted', resolved_at = datetime('now')
        WHERE id = ?
      `).bind(proposalId).run();

      // Mark co-surfacing as relation_created
      if (proposal.from_obs_id && proposal.to_obs_id) {
        const [smaller, larger] = (proposal.from_obs_id as number) < (proposal.to_obs_id as number)
          ? [proposal.from_obs_id, proposal.to_obs_id]
          : [proposal.to_obs_id, proposal.from_obs_id];
        await env.DB.prepare(`
          UPDATE co_surfacing SET relation_created = 1 WHERE obs_a_id = ? AND obs_b_id = ?
        `).bind(smaller, larger).run();
      }

      return `Created relation: **${proposal.entity_a}** --[${relationType}]--> **${proposal.entity_b}**\nProposal #${proposalId} accepted.`;
    }

    case "reject": {
      if (!proposalId) return "proposal_id required for reject";

      const result = await env.DB.prepare(`
        UPDATE daemon_proposals SET status = 'rejected', resolved_at = datetime('now')
        WHERE id = ? AND status = 'pending'
      `).bind(proposalId).run();

      if (result.meta.changes === 0) {
        return `Proposal #${proposalId} not found or already resolved`;
      }

      return `Proposal #${proposalId} rejected.`;
    }

    default:
      return `Unknown action: ${action}. Use list, accept, or reject.`;
  }
}

export async function handleMindDormant(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "list";
  const observationId = params.observation_id as number;

  switch (action) {
    case "list": {
      const totalCount = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM dormant_observations doo
        JOIN observations o ON doo.observation_id = o.id
        WHERE (o.charge != 'metabolized' OR o.charge IS NULL)
          AND o.archived_at IS NULL
      `).first();
      const total = (totalCount?.count as number) || 0;

      const dormant = await env.DB.prepare(`
        SELECT doo.id, doo.observation_id, doo.first_marked, doo.rescue_attempts,
               o.content, o.weight, o.charge, o.emotion, o.added_at,
               e.name as entity_name, e.entity_type,
               CAST((julianday('now') - julianday(doo.first_marked)) AS INTEGER) as days_dormant
        FROM dormant_observations doo
        JOIN observations o ON doo.observation_id = o.id
        JOIN entities e ON o.entity_id = e.id
        WHERE (o.charge != 'metabolized' OR o.charge IS NULL)
          AND o.archived_at IS NULL
        ORDER BY CASE o.weight WHEN 'heavy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 o.added_at DESC
        LIMIT 20
      `).all();

      if (!dormant.results?.length) {
        return "No dormant observations. Everything is surfacing within the rotation window.";
      }

      let output = `## Dormant Observations (${total} total, showing ${dormant.results.length})\n\n`;
      output += `*Medium/heavy observations that haven't surfaced in 30+ days. Worth revisiting?*\n\n`;

      for (const o of dormant.results) {
        const weightIcon = o.weight === 'heavy' ? '⬛' : o.weight === 'medium' ? '◼' : '▪';
        const emotionTag = o.emotion ? ` [${o.emotion}]` : '';
        output += `**#${o.observation_id}** ${weightIcon} [${o.weight}] ${o.days_dormant}d dormant${emotionTag}\n`;
        output += `**${o.entity_name}** (${o.entity_type}): ${String(o.content).slice(0, 100)}...\n`;
        if ((o.rescue_attempts as number) > 0) {
          output += `  ↳ ${o.rescue_attempts} rescue attempt(s)\n`;
        }
        output += "\n";
      }
      output += `---\n**Actions:**\n`;
      output += `  surface(observation_id) → forces it to surface, removes from dormant list\n`;
      output += `  archive(observation_id) → removes from dormant tracking`;
      return output;
    }

    case "surface": {
      if (!observationId) return "observation_id required for surface";

      const dormant = await env.DB.prepare(`
        SELECT doo.id, o.content, e.name as entity_name
        FROM dormant_observations doo
        JOIN observations o ON doo.observation_id = o.id
        JOIN entities e ON o.entity_id = e.id
        WHERE doo.observation_id = ?
      `).bind(observationId).first();

      if (!dormant) return `Observation #${observationId} not in dormant list`;

      await env.DB.prepare(`
        UPDATE dormant_observations
        SET rescue_attempts = rescue_attempts + 1, last_rescue_attempt = datetime('now')
        WHERE observation_id = ?
      `).bind(observationId).run();

      await env.DB.prepare(`
        UPDATE observations
        SET last_surfaced_at = datetime('now'), surface_count = COALESCE(surface_count, 0) + 1
        WHERE id = ?
      `).bind(observationId).run();

      await env.DB.prepare(`
        DELETE FROM dormant_observations WHERE observation_id = ?
      `).bind(observationId).run();

      return `Rescued observation #${observationId} from **${dormant.entity_name}**:\n"${String(dormant.content).slice(0, 100)}..."\n\nIt will now appear in normal surfacing.`;
    }

    case "archive": {
      if (!observationId) return "observation_id required for archive";

      const result = await env.DB.prepare(`
        DELETE FROM dormant_observations WHERE observation_id = ?
      `).bind(observationId).run();

      if (result.meta.changes === 0) {
        return `Observation #${observationId} not in dormant list`;
      }

      return `Observation #${observationId} removed from dormant tracking. It's okay to let some things fade.`;
    }

    default:
      return `Unknown action: ${action}. Use list, surface, or archive.`;
  }
}

export async function handleMindIsolated(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "list";
  const entity = params.entity as string;
  const toEntity = params.to_entity as string;
  const relationType = (params.relation_type as string) || "relates_to";

  switch (action) {
    case "list": {
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
        LIMIT 30
      `).all();

      const underConnected = await env.DB.prepare(`
        SELECT e.id, e.name, e.entity_type, COUNT(o.id) as obs_count,
               (SELECT COUNT(*) FROM relations r WHERE r.from_entity = e.name OR r.to_entity = e.name) as rel_count
        FROM entities e
        LEFT JOIN observations o ON o.entity_id = e.id AND o.archived_at IS NULL
        WHERE COALESCE(e.intentionally_isolated, 0) = 0
          AND (e.salience IS NULL OR e.salience NOT IN ('archive'))
        GROUP BY e.id, e.name, e.entity_type
        HAVING rel_count = 1 AND obs_count >= 3
        ORDER BY obs_count DESC
        LIMIT 15
      `).all();

      const isolatedCount = (isolated.results || []).length;
      const underCount = (underConnected.results || []).length;

      if (isolatedCount === 0 && underCount === 0) {
        return "Graph is well connected. No isolated or under-connected entities found.";
      }

      let output = `## Graph Isolation Report\n\n`;

      if (isolatedCount > 0) {
        output += `### Isolated entities (${isolatedCount}, no relations at all)\n\n`;
        for (const e of isolated.results!) {
          const obsTag = (e.obs_count as number) > 0 ? ` — ${e.obs_count} obs` : ` — no obs`;
          output += `- **${e.name}** (${e.entity_type})${obsTag}\n`;
        }
        output += "\n";
      }

      if (underCount > 0) {
        output += `### Under-connected (${underCount}, single relation + 3+ observations)\n\n`;
        for (const e of underConnected.results!) {
          output += `- **${e.name}** (${e.entity_type}) — ${e.obs_count} obs, ${e.rel_count} relation\n`;
        }
        output += "\n";
      }

      output += `---\n**Actions:**\n`;
      output += `  connect(entity, to_entity, relation_type) → create a relation\n`;
      output += `  ignore(entity) → mark as intentionally standalone (hides from this list)`;
      return output;
    }

    case "connect": {
      if (!entity || !toEntity) {
        return "connect requires both `entity` and `to_entity`";
      }

      const from = await env.DB.prepare(`SELECT name FROM entities WHERE name = ? LIMIT 1`).bind(entity).first();
      if (!from) return `Entity "${entity}" not found`;

      const to = await env.DB.prepare(`SELECT name FROM entities WHERE name = ? LIMIT 1`).bind(toEntity).first();
      if (!to) return `Entity "${toEntity}" not found`;

      if (entity === toEntity) return "Cannot relate an entity to itself";

      const existing = await env.DB.prepare(`
        SELECT id FROM relations
        WHERE (from_entity = ? AND to_entity = ?) OR (from_entity = ? AND to_entity = ?)
        LIMIT 1
      `).bind(entity, toEntity, toEntity, entity).first();

      if (existing) {
        return `Relation already exists between **${entity}** and **${toEntity}**`;
      }

      await env.DB.prepare(`
        INSERT INTO relations (from_entity, to_entity, relation_type)
        VALUES (?, ?, ?)
      `).bind(entity, toEntity, relationType).run();

      return `Connected: **${entity}** → **${toEntity}** (${relationType})`;
    }

    case "ignore": {
      if (!entity) return "ignore requires `entity`";

      const result = await env.DB.prepare(`
        UPDATE entities SET intentionally_isolated = 1 WHERE name = ?
      `).bind(entity).run();

      if (result.meta.changes === 0) {
        return `Entity "${entity}" not found`;
      }

      return `**${entity}** marked as intentionally standalone. It won't appear in isolation lists.`;
    }

    default:
      return `Unknown action: ${action}. Use list, connect, or ignore.`;
  }
}

export async function handleMindArchive(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "list";
  const observationId = params.observation_id as number;
  const query = params.query as string;

  switch (action) {
    case "list": {
      const archived = await env.DB.prepare(`
        SELECT o.id, o.content, o.weight, o.emotion, o.added_at, o.archived_at,
               e.name as entity_name, e.entity_type
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.archived_at IS NOT NULL
        ORDER BY o.archived_at DESC
        LIMIT 20
      `).all();

      if (!archived.results?.length) {
        return "The deep archive is empty. Nothing has faded yet.";
      }

      let output = `## Deep Archive (${archived.results.length} shown)\n\n`;
      output += `*Memories that have faded — light (30d+) and medium (90d+) with no engagement*\n\n`;

      for (const obs of archived.results) {
        const emotionTag = obs.emotion ? ` [${obs.emotion}]` : '';
        const archivedDate = obs.archived_at ? new Date(obs.archived_at as string).toLocaleDateString() : '';
        output += `**#${obs.id}** [${obs.weight}] archived ${archivedDate}${emotionTag}\n`;
        output += `**${obs.entity_name}** (${obs.entity_type}): ${String(obs.content).slice(0, 100)}...\n\n`;
      }
      output += `---\n**Actions:**\n`;
      output += `  rescue(observation_id) → bring back to active memory\n`;
      output += `  explore(query) → search within the deep`;
      return output;
    }

    case "rescue": {
      if (!observationId) return "observation_id required for rescue";

      const obs = await env.DB.prepare(`
        SELECT o.id, o.content, e.name as entity_name
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.id = ? AND o.archived_at IS NOT NULL
      `).bind(observationId).first();

      if (!obs) return `Observation #${observationId} not found in archive`;

      // Un-archive: set archived_at to NULL
      await env.DB.prepare(`
        UPDATE observations SET archived_at = NULL WHERE id = ?
      `).bind(observationId).run();

      return `Rescued from the deep: observation #${observationId} from **${obs.entity_name}**\n"${String(obs.content).slice(0, 100)}..."\n\nNow back in active memory.`;
    }

    case "explore": {
      if (!query) return "query required for explore - what are you looking for in the deep?";

      // Semantic search within archived observations
      const vectorResults = await searchVectors(env, query, 20);

      if (!vectorResults.matches?.length) {
        return `No archived memories resonating with "${query}"`;
      }

      // Get observation IDs from vector results
      const obsIds: number[] = [];
      for (const match of vectorResults.matches) {
        if (match.id.startsWith('obs-')) {
          const parts = match.id.split('-');
          if (parts.length >= 3) {
            obsIds.push(parseInt(parts[2]));
          }
        }
      }

      if (!obsIds.length) {
        return `No archived memories resonating with "${query}"`;
      }

      // Fetch only archived observations from those IDs
      const placeholders = obsIds.map(() => '?').join(',');
      const archived = await env.DB.prepare(`
        SELECT o.id, o.content, o.weight, o.emotion, o.archived_at,
               e.name as entity_name, e.entity_type
        FROM observations o
        JOIN entities e ON o.entity_id = e.id
        WHERE o.id IN (${placeholders}) AND o.archived_at IS NOT NULL
        ORDER BY o.archived_at DESC
        LIMIT 10
      `).bind(...obsIds).all();

      if (!archived.results?.length) {
        return `No archived memories resonating with "${query}" - the matches are all still active`;
      }

      let output = `## Deep Exploration: "${query}"\n\n`;
      output += `*Memories surfacing from the deep*\n\n`;

      for (const obs of archived.results) {
        const emotionTag = obs.emotion ? ` [${obs.emotion}]` : '';
        output += `**#${obs.id}** [${obs.weight}]${emotionTag}\n`;
        output += `**${obs.entity_name}** (${obs.entity_type}): ${String(obs.content).slice(0, 150)}...\n\n`;
      }
      output += `---\nUse rescue(observation_id) to bring any of these back to active memory`;
      return output;
    }

    default:
      return `Unknown action: ${action}. Use list, rescue, or explore.`;
  }
}
