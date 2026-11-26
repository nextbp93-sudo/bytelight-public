import type { Env } from "../types";
import { getEmbedding, imageUrl, searchVectors, getRelativeTime, normalizeText, r2Prefix } from "../utils";
import { recordAccessTracking } from "./search";

export async function handleMindListEntities(env: Env, params: Record<string, unknown>): Promise<string> {
  const entityType = params.entity_type as string;
  const context = params.context as string;
  const limit = (params.limit as number) || 50;

  // If context is specified, find entities that have observations in that context
  if (context) {
    const results = await env.DB.prepare(`
      SELECT DISTINCT e.name, e.entity_type, e.primary_context, e.created_at
      FROM entities e
      JOIN observations o ON o.entity_id = e.id
      WHERE o.context = ?
      ${entityType ? 'AND e.entity_type = ?' : ''}
      ORDER BY e.created_at DESC
      LIMIT ?
    `).bind(...(entityType ? [context, entityType, limit] : [context, limit])).all();

    if (!results.results?.length) {
      return `No entities found with observations in context '${context}'.`;
    }

    let output = `## Entities (with observations in '${context}')\n\n`;
    for (const e of results.results as any[]) {
      output += '- **' + e.name + '** [' + e.entity_type + ']\n';
    }
    output += '\nTotal: ' + results.results.length + ' entities';
    return output;
  }

  // Otherwise list all entities
  let query = 'SELECT name, entity_type, primary_context, created_at FROM entities';
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (entityType) {
    conditions.push('entity_type = ?');
    bindings.push(entityType);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  bindings.push(limit);

  const stmt = env.DB.prepare(query);
  const results = await stmt.bind(...bindings).all();

  if (!results.results?.length) {
    return 'No entities found.';
  }

  let output = '## Entities\n\n';
  for (const e of results.results as any[]) {
    output += '- **' + e.name + '** [' + e.entity_type + '] primary: ' + e.primary_context + '\n';
  }
  output += '\nTotal: ' + results.results.length + ' entities';
  return output;
}

export async function handleMindReadEntity(env: Env, params: Record<string, unknown>): Promise<string> {
  const name = params.name as string;
  const context = params.context as string;

  // Find the entity (globally unique by name now)
  const entity = await env.DB.prepare(
    `SELECT id, name, entity_type, primary_context, salience, created_at FROM entities WHERE name = ?`
  ).bind(name).first() as any;

  if (!entity) {
    return `Entity '${name}' not found.`;
  }

  // Get observations, optionally filtered by context
  let observations;
  if (context) {
    observations = await env.DB.prepare(
      `SELECT id, content, salience, emotion, weight, context, added_at FROM observations WHERE entity_id = ? AND context = ? AND (valid_until IS NULL AND superseded_by IS NULL) ORDER BY added_at DESC`
    ).bind(entity.id, context).all();
  } else {
    observations = await env.DB.prepare(
      `SELECT id, content, salience, emotion, weight, context, added_at FROM observations WHERE entity_id = ? AND (valid_until IS NULL AND superseded_by IS NULL) ORDER BY added_at DESC`
    ).bind(entity.id).all();
  }

  // Track access for read entity observations
  const readObsIds = (observations.results || []).map((o: any) => o.id as number).filter(Boolean);
  recordAccessTracking(env, readObsIds).catch(() => {});

  // Get relations where this entity is the source
  const relationsFrom = await env.DB.prepare(
    `SELECT to_entity, relation_type, to_context FROM relations WHERE from_entity = ?`
  ).bind(name).all();

  // Get relations where this entity is the target
  const relationsTo = await env.DB.prepare(
    `SELECT from_entity, relation_type, from_context FROM relations WHERE to_entity = ?`
  ).bind(name).all();

  // Build output
  let output = `## ${entity.name}\n`;
  output += `**Type:** ${entity.entity_type} | **Context:** ${entity.primary_context}\n\n`;

  output += `### Observations (${observations.results?.length || 0})\n`;
  if (observations.results?.length) {
    for (const obs of observations.results) {
      const emotion = obs.emotion ? ` [${obs.emotion}]` : '';
      output += `- ${obs.content}${emotion}\n`;
    }
  } else {
    output += '_No observations_\n';
  }

  output += `\n### Relations\n`;
  const totalRelations = (relationsFrom.results?.length || 0) + (relationsTo.results?.length || 0);
  if (totalRelations === 0) {
    output += '_No relations_\n';
  } else {
    if (relationsFrom.results?.length) {
      output += '**Outgoing:**\n';
      for (const rel of relationsFrom.results) {
        output += `- --[${rel.relation_type}]--> ${rel.to_entity}\n`;
      }
    }
    if (relationsTo.results?.length) {
      output += '**Incoming:**\n';
      for (const rel of relationsTo.results) {
        output += `- <--[${rel.relation_type}]-- ${rel.from_entity}\n`;
      }
    }
  }

  return output;
}

export async function handleMindEntity(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;
  const entityId = params.entity_id as number;
  const entityName = params.entity_name as string;
  const context = (params.context as string) || "default";

  // Helper to find entity (globally unique by name now)
  async function findEntity(): Promise<{ id: number; name: string; entity_type: string; primary_context: string; salience: string } | null> {
    if (entityId) {
      return await env.DB.prepare(
        `SELECT id, name, entity_type, primary_context, salience FROM entities WHERE id = ?`
      ).bind(entityId).first() as any;
    } else if (entityName) {
      return await env.DB.prepare(
        `SELECT id, name, entity_type, primary_context, salience FROM entities WHERE name = ?`
      ).bind(entityName).first() as any;
    }
    return null;
  }

  switch (action) {
    case "set_salience": {
      const salience = params.salience as string;
      if (!salience || !["foundational", "active", "background", "archive"].includes(salience)) {
        return "Must provide valid salience: foundational, active, background, or archive";
      }

      const entity = await findEntity();
      if (!entity) return "Entity not found";

      await env.DB.prepare(
        `UPDATE entities SET salience = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(salience, entity.id).run();

      return `Set ${entity.name} salience to '${salience}' (was '${entity.salience || 'active'}')`;
    }

    case "edit": {
      const entity = await findEntity();
      if (!entity) return "Entity not found";

      const newName = params.new_name as string;
      const newType = params.new_type as string;
      const newContext = params.new_context as string;

      const updates: string[] = [];
      const values: unknown[] = [];
      const changes: string[] = [];

      if (newName && newName !== entity.name) {
        updates.push("name = ?");
        values.push(newName);
        changes.push(`name: ${entity.name} → ${newName}`);

        // Update relations that reference this entity by name
        await env.DB.prepare(
          `UPDATE relations SET from_entity = ? WHERE from_entity = ?`
        ).bind(newName, entity.name).run();
        await env.DB.prepare(
          `UPDATE relations SET to_entity = ? WHERE to_entity = ?`
        ).bind(newName, entity.name).run();
      }
      if (newType && newType !== entity.entity_type) {
        updates.push("entity_type = ?");
        values.push(newType);
        changes.push(`type: ${entity.entity_type} → ${newType}`);
      }
      if (newContext && newContext !== entity.primary_context) {
        updates.push("primary_context = ?");
        values.push(newContext);
        changes.push(`primary_context: ${entity.primary_context} → ${newContext}`);
      }

      if (updates.length === 0) {
        return "No changes provided";
      }

      updates.push("updated_at = datetime('now')");
      values.push(entity.id);

      await env.DB.prepare(
        `UPDATE entities SET ${updates.join(", ")} WHERE id = ?`
      ).bind(...values).run();

      // Re-vectorize the entity with updated info
      try {
        const finalName = newName || entity.name;
        const finalType = newType || entity.entity_type;
        const finalContext = newContext || entity.primary_context;
        const entityText = `${finalName} is a ${finalType}. Primary context: ${finalContext}`;
        const entityEmbedding = await getEmbedding(env, entityText);
        await env.VECTORS.upsert([{
          id: `entity-${entity.id}`,
          values: entityEmbedding,
          metadata: {
            source: "entity",
            name: finalName,
            entity_type: finalType,
            context: finalContext,
            updated_at: new Date().toISOString()
          }
        }]);
      } catch (e) {
        console.log(`Failed to re-vectorize entity ${entity.id}: ${e}`);
      }

      return `Updated entity #${entity.id}:\n${changes.join("\n")}`;
    }

    case "merge": {
      const mergeFromId = params.merge_from_id as number;
      const mergeIntoId = params.merge_into_id as number;

      if (!mergeFromId || !mergeIntoId) {
        return "Must provide merge_from_id and merge_into_id";
      }

      const fromEntity = await env.DB.prepare(
        `SELECT id, name, entity_type, primary_context FROM entities WHERE id = ?`
      ).bind(mergeFromId).first() as any;
      const intoEntity = await env.DB.prepare(
        `SELECT id, name, entity_type, primary_context FROM entities WHERE id = ?`
      ).bind(mergeIntoId).first() as any;

      if (!fromEntity) return `Source entity #${mergeFromId} not found`;
      if (!intoEntity) return `Target entity #${mergeIntoId} not found`;

      // Move observations from source to target
      const obsResult = await env.DB.prepare(
        `UPDATE observations SET entity_id = ? WHERE entity_id = ?`
      ).bind(mergeIntoId, mergeFromId).run();

      // Update relations that reference the old entity name
      await env.DB.prepare(
        `UPDATE relations SET from_entity = ? WHERE from_entity = ?`
      ).bind(intoEntity.name, fromEntity.name).run();
      await env.DB.prepare(
        `UPDATE relations SET to_entity = ? WHERE to_entity = ?`
      ).bind(intoEntity.name, fromEntity.name).run();

      // Delete the source entity
      await env.DB.prepare(`DELETE FROM entities WHERE id = ?`).bind(mergeFromId).run();

      return `Merged '${fromEntity.name}' (#${mergeFromId}) into '${intoEntity.name}' (#${mergeIntoId})\nMoved ${obsResult.meta.changes} observations`;
    }

    case "archive_old": {
      const olderThanDays = (params.older_than_days as number) || 30;
      const typeFilter = params.entity_type_filter as string;

      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

      let query = `UPDATE entities SET salience = 'archive', updated_at = datetime('now')
                   WHERE salience != 'foundational' AND salience != 'archive'
                   AND updated_at < ?`;
      const bindings: unknown[] = [cutoff];

      if (typeFilter) {
        query += ` AND entity_type = ?`;
        bindings.push(typeFilter);
      }

      const result = await env.DB.prepare(query).bind(...bindings).run();

      const typeDesc = typeFilter ? ` of type '${typeFilter}'` : "";
      return `Archived ${result.meta.changes} entities${typeDesc} older than ${olderThanDays} days`;
    }

    default:
      return `Unknown action: ${action}. Valid actions: set_salience, edit, merge, archive_old`;
  }
}

export async function handleMindEdit(env: Env, params: Record<string, unknown>): Promise<string> {
  const observationId = params.observation_id as number;
  const imageId = params.image_id as number;
  const journalId = params.journal_id as number;
  const textMatch = params.text_match as string;
  const descriptionMatch = params.description_match as string;
  const newContent = params.new_content as string;
  const newWeight = params.new_weight as string;
  const newEmotion = params.new_emotion as string;
  const newContext = params.new_context as string;
  const newPath = params.new_path as string;

  // === EDIT JOURNAL ===
  if (journalId) {
    const journal = await env.DB.prepare(`SELECT id, content, entry_date, emotion FROM journals WHERE id = ?`).bind(journalId).first();
    if (!journal) return `Journal #${journalId} not found`;
    if (!newContent) return "new_content is required for journal editing";

    await env.DB.prepare(`UPDATE journals SET content = ?, emotion = ? WHERE id = ?`)
      .bind(newContent, newEmotion || journal.emotion || null, journalId).run();

    // Re-embed
    try {
      const embedding = await getEmbedding(env, newContent);
      await env.VECTORS.upsert([{
        id: `journal-${journalId}`,
        values: embedding,
        metadata: { source: "journal", title: String(journal.entry_date || ""), content: newContent, emotion: String(newEmotion || journal.emotion || "") }
      }]);
    } catch (e) { console.error("Journal re-embed failed:", e); }

    return `Journal #${journalId} updated [re-embedded]\nOld: "${String(journal.content).slice(0, 50)}..."\nNew: "${newContent.slice(0, 50)}..."`;
  }

  // Determine if editing an image or observation
  const editingImage = imageId || descriptionMatch;

  if (editingImage) {
    // === EDIT IMAGE ===
    let img;
    if (imageId) {
      img = await env.DB.prepare(
        `SELECT i.id, i.description, i.path, i.context, i.emotion, i.weight, e.name as entity_name
         FROM images i LEFT JOIN entities e ON i.entity_id = e.id WHERE i.id = ?`
      ).bind(imageId).first();
    } else if (descriptionMatch) {
      img = await env.DB.prepare(
        `SELECT i.id, i.description, i.path, i.context, i.emotion, i.weight, e.name as entity_name
         FROM images i LEFT JOIN entities e ON i.entity_id = e.id
         WHERE i.description LIKE ? ORDER BY i.created_at DESC LIMIT 1`
      ).bind(`%${descriptionMatch}%`).first();
    }

    if (!img) {
      return "Image not found";
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let descriptionChanged = false;
    let contextChanged = false;
    let emotionChanged = false;

    if (newContent) {
      updates.push("description = ?");
      values.push(newContent);
      descriptionChanged = true;
    }
    if (newWeight) {
      updates.push("weight = ?");
      values.push(newWeight);
    }
    if (newEmotion) {
      updates.push("emotion = ?");
      values.push(normalizeText(newEmotion));
      emotionChanged = true;
    }
    if (newContext) {
      updates.push("context = ?");
      values.push(newContext);
      contextChanged = true;
    }
    if (newPath) {
      updates.push("path = ?");
      values.push(newPath);
    }

    if (updates.length === 0) {
      return "No updates provided";
    }

    values.push(img.id);

    await env.DB.prepare(
      `UPDATE images SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values).run();

    // Update vector embedding if semantic content changed
    if (descriptionChanged || contextChanged || emotionChanged) {
      const finalDescription = newContent || String(img.description);
      const finalContext = newContext || (img.context ? String(img.context) : "");
      const finalEmotion = newEmotion ? normalizeText(newEmotion) : (img.emotion ? String(img.emotion) : "");
      const entityName = img.entity_name ? String(img.entity_name) : "";
      const imgWeight = newWeight || String(img.weight || "medium");
      const imgPath = newPath || (img.path ? String(img.path) : "");

      const semanticText = [
        entityName ? `${entityName}:` : "",
        finalDescription,
        finalContext ? `(${finalContext})` : "",
        finalEmotion ? `[${finalEmotion}]` : ""
      ].filter(Boolean).join(" ");

      const imgVectorId = `img-${img.id}`;
      const embedding = await getEmbedding(env, semanticText);
      const editMetadata: Record<string, string> = {
        source: "image",
        description: finalDescription,
        weight: imgWeight,
        added_at: new Date().toISOString()
      };
      if (entityName) editMetadata.entity = entityName;
      if (finalContext) editMetadata.context = finalContext;
      if (finalEmotion) editMetadata.emotion = finalEmotion;
      if (imgPath) editMetadata.path = imgPath;

      await env.VECTORS.upsert([{
        id: imgVectorId,
        values: embedding,
        metadata: editMetadata
      }]);
    }

    const oldPreview = String(img.description).slice(0, 50);
    const newPreview = newContent ? newContent.slice(0, 50) : oldPreview;
    return `Image #${img.id} updated\nOld: "${oldPreview}..."\nNew: "${newPreview}..."`;

  } else {
    // === EDIT OBSERVATION (original logic) ===
    let obs;
    if (observationId) {
      obs = await env.DB.prepare(
        `SELECT id, content, entity_id, weight, emotion FROM observations WHERE id = ?`
      ).bind(observationId).first();
    } else if (textMatch) {
      obs = await env.DB.prepare(
        `SELECT id, content, entity_id, weight, emotion FROM observations WHERE content LIKE ? ORDER BY added_at DESC LIMIT 1`
      ).bind(`%${textMatch}%`).first();
    } else {
      return "Must provide observation_id, image_id, text_match, or description_match";
    }

    if (!obs) {
      return "Observation not found";
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (newContent) {
      updates.push("content = ?");
      values.push(newContent);
    }
    if (newWeight) {
      updates.push("weight = ?");
      values.push(newWeight);
    }
    if (newEmotion) {
      updates.push("emotion = ?");
      values.push(newEmotion);
    }

    if (updates.length === 0) {
      return "No updates provided";
    }

    // Preserve previous version before updating
    let versionNum = 1;
    try {
      const versionResult = await env.DB.prepare(`
        SELECT COALESCE(MAX(version_num), 0) as max_version
        FROM observation_versions
        WHERE observation_id = ?
      `).bind(obs.id).first();
      versionNum = ((versionResult?.max_version as number) || 0) + 1;

      await env.DB.prepare(`
        INSERT INTO observation_versions (observation_id, version_num, content, weight, emotion)
        VALUES (?, ?, ?, ?, ?)
      `).bind(obs.id, versionNum, obs.content, obs.weight, obs.emotion).run();
    } catch (e) {
      console.log(`Version tracking skipped: ${e}`);
    }

    values.push(obs.id);

    await env.DB.prepare(
      `UPDATE observations SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values).run();

    // Re-embed if content changed
    if (newContent) {
      try {
        const entity = await env.DB.prepare(
          `SELECT e.name FROM entities e JOIN observations o ON o.entity_id = e.id WHERE o.id = ?`
        ).bind(obs.id).first();
        const entityName = entity?.name ? String(entity.name) : "";
        const text = `${entityName}: ${newContent}`;
        const embedding = await getEmbedding(env, text);
        await env.VECTORS.upsert([{
          id: `obs-${obs.entity_id}-${obs.id}`,
          values: embedding,
          metadata: {
            source: "observation",
            entity: entityName,
            content: newContent,
            weight: newWeight || String(obs.weight || "medium"),
          }
        }]);
      } catch (e) {
        console.error("Re-embed after edit failed:", e);
      }
    }

    const oldPreview = String(obs.content).slice(0, 50);
    const newPreview = newContent ? newContent.slice(0, 50) : oldPreview;
    return `Observation #${obs.id} updated (v${versionNum + 1}) ${newContent ? '[re-embedded]' : ''}\nOld: "${oldPreview}..."\nNew: "${newPreview}..."`;
  }
}

export async function handleMindDelete(env: Env, params: Record<string, unknown>): Promise<string> {
  const observationId = params.observation_id as number;
  const entityName = params.entity_name as string;
  const context = (params.context as string) || "default";
  const textMatch = params.text_match as string;

  if (observationId) {
    // Delete specific observation
    const obs = await env.DB.prepare(
      `SELECT content FROM observations WHERE id = ?`
    ).bind(observationId).first();

    if (!obs) return `Observation #${observationId} not found`;

    // Get entity_id for vector cleanup
    const obsDetail = await env.DB.prepare(
      `SELECT entity_id FROM observations WHERE id = ?`
    ).bind(observationId).first();
    await env.DB.prepare(`DELETE FROM observations WHERE id = ?`).bind(observationId).run();
    // Clean up embedding
    try {
      await env.DB.prepare(`DELETE FROM embeddings WHERE id = ?`).bind(`obs-${obsDetail?.entity_id}-${observationId}`).run();
    } catch { /* embedding may not exist */ }
    return `Deleted observation #${observationId}: "${String(obs.content).slice(0, 50)}..." [embedding cleaned]`;
  }

  if (textMatch) {
    // Find and delete by text match
    const obs = await env.DB.prepare(
      `SELECT id, content, entity_id FROM observations WHERE content LIKE ? ORDER BY added_at DESC LIMIT 1`
    ).bind(`%${textMatch}%`).first();

    if (!obs) return `No observation found matching "${textMatch}"`;

    await env.DB.prepare(`DELETE FROM observations WHERE id = ?`).bind(obs.id).run();
    // Clean up embedding
    try {
      await env.DB.prepare(`DELETE FROM embeddings WHERE id = ?`).bind(`obs-${obs.entity_id}-${obs.id}`).run();
    } catch { /* embedding may not exist */ }
    return `Deleted observation #${obs.id}: "${String(obs.content).slice(0, 50)}..."`;
  }

  if (entityName) {
    // Delete entity and all its observations (globally unique now)
    const entity = await env.DB.prepare(
      `SELECT id FROM entities WHERE name = ?`
    ).bind(entityName).first();

    if (!entity) return `Entity '${entityName}' not found`;

    // Count observations that will be deleted
    const obsCount = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM observations WHERE entity_id = ?`
    ).bind(entity.id).first();

    // Clean up all embeddings for this entity's observations + the entity itself
    try {
      await env.DB.prepare(`DELETE FROM embeddings WHERE source_type = 'observation' AND source_id IN (SELECT id FROM observations WHERE entity_id = ?)`).bind(entity.id).run();
      await env.DB.prepare(`DELETE FROM embeddings WHERE id = ?`).bind(`entity-${entity.id}`).run();
    } catch { /* embeddings may not exist */ }

    // Delete observations first
    await env.DB.prepare(`DELETE FROM observations WHERE entity_id = ?`).bind(entity.id).run();

    // Delete relations
    await env.DB.prepare(`DELETE FROM relations WHERE from_entity = ? OR to_entity = ?`).bind(entityName, entityName).run();

    // Delete entity
    await env.DB.prepare(`DELETE FROM entities WHERE id = ?`).bind(entity.id).run();

    return `Deleted entity '${entityName}' with ${obsCount?.c || 0} observations [embeddings cleaned]`;
  }

  // Delete journal
  const journalId = params.journal_id as number;
  if (journalId) {
    const journal = await env.DB.prepare(`SELECT content FROM journals WHERE id = ?`).bind(journalId).first();
    if (!journal) return `Journal #${journalId} not found`;
    await env.DB.prepare(`DELETE FROM journals WHERE id = ?`).bind(journalId).run();
    try { await env.DB.prepare(`DELETE FROM embeddings WHERE id = ?`).bind(`journal-${journalId}`).run(); } catch {}
    return `Deleted journal #${journalId}: "${String(journal.content).slice(0, 50)}..." [embedding cleaned]`;
  }

  // Delete relation
  const relationId = params.relation_id as number;
  if (relationId) {
    const rel = await env.DB.prepare(`SELECT from_entity, to_entity, relation_type FROM relations WHERE id = ?`).bind(relationId).first();
    if (!rel) return `Relation #${relationId} not found`;
    await env.DB.prepare(`DELETE FROM relations WHERE id = ?`).bind(relationId).run();
    return `Deleted relation #${relationId}: ${rel.from_entity} -> ${rel.to_entity} (${rel.relation_type})`;
  }

  // Delete image
  const imageId = params.image_id as number;
  if (imageId) {
    const img = await env.DB.prepare(`SELECT path, description FROM images WHERE id = ?`).bind(imageId).first();
    if (!img) return `Image #${imageId} not found`;
    await env.DB.prepare(`DELETE FROM images WHERE id = ?`).bind(imageId).run();
    try { await env.DB.prepare(`DELETE FROM embeddings WHERE id = ?`).bind(`img-${imageId}`).run(); } catch {}
    // Delete from R2 if stored there
    const prefix = r2Prefix(env);
    if (img.path && String(img.path).startsWith(`r2://${prefix}/`)) {
      const r2Key = String(img.path).replace(`r2://${prefix}/`, "");
      try { await env.R2_IMAGES.delete(r2Key); } catch {}
    }
    return `Deleted image #${imageId}: "${String(img.description).slice(0, 50)}..." [embedding + R2 cleaned]`;
  }

  // Delete thread
  const threadId = params.thread_id as string;
  if (threadId) {
    const thread = await env.DB.prepare(`SELECT content FROM threads WHERE id = ?`).bind(threadId).first();
    if (!thread) return `Thread '${threadId}' not found`;
    await env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(threadId).run();
    return `Deleted thread '${threadId}': "${String(thread.content).slice(0, 50)}..."`;
  }

  // Delete tension
  const tensionId = params.tension_id as string;
  if (tensionId) {
    const tension = await env.DB.prepare(`SELECT pole_a, pole_b FROM tensions WHERE id = ?`).bind(tensionId).first();
    if (!tension) return `Tension '${tensionId}' not found`;
    await env.DB.prepare(`DELETE FROM tensions WHERE id = ?`).bind(tensionId).run();
    return `Deleted tension '${tensionId}': ${tension.pole_a} <-> ${tension.pole_b}`;
  }

  return "Must provide observation_id, text_match, entity_name, journal_id, relation_id, image_id, thread_id, or tension_id";
}
