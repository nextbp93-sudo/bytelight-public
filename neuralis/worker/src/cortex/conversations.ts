/**
 * Cortex: Conversation Storage + Search
 * Ingest conversation summaries and search them by keyword, domain, or date.
 */

import { generateId, getEmbedding } from "../utils";
import { CORTEX_SEARCH_LIMIT } from "../config";
import type { Env } from "../types";

/**
 * cortex_save_conversation — Ingest a conversation with metadata and optional messages.
 * Embeds the summary for vector search.
 */
export async function handleCortexSaveConversation(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const source = (params.source as string) || "manual";
  const title = (params.title as string) || null;
  const summary = (params.summary as string) || null;
  const domain = (params.domain as string) || null;
  const importance = (params.importance as string) || "routine";
  const thinking_stage = (params.thinking_stage as string) || null;
  const emotional_tone = (params.emotional_tone as string) || null;
  const decisions = params.decisions as string[] | undefined;
  const open_questions = params.open_questions as string[] | undefined;
  const key_insights = params.key_insights as string[] | undefined;
  const concepts = params.concepts as string[] | undefined;
  const messages = params.messages as Array<{ role: string; content: string }> | undefined;
  const started_at = (params.started_at as string) || null;
  const ended_at = (params.ended_at as string) || null;
  const conversation_id = (params.conversation_id as string) || generateId("conv");

  if (!summary && !title) return "Error: at least title or summary is required";

  const messageCount = messages?.length || (params.message_count as number) || 0;

  // Store conversation metadata
  await env.DB.prepare(`
    INSERT INTO cortex_conversations
      (id, source, title, summary, domain, importance, thinking_stage, emotional_tone,
       decisions, open_questions, key_insights, concepts, message_count, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    conversation_id, source, title, summary, domain, importance, thinking_stage, emotional_tone,
    decisions ? JSON.stringify(decisions) : null,
    open_questions ? JSON.stringify(open_questions) : null,
    key_insights ? JSON.stringify(key_insights) : null,
    concepts ? JSON.stringify(concepts) : null,
    messageCount, started_at, ended_at
  ).run();

  // Store individual messages if provided
  if (messages?.length) {
    const batch: D1PreparedStatement[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const msgId = generateId("msg");
      const wordCount = msg.content.split(/\s+/).length;
      const hasCode = /```|`[^`]+`/.test(msg.content) ? 1 : 0;
      const hasQuestion = msg.content.includes("?") ? 1 : 0;

      batch.push(
        env.DB.prepare(`
          INSERT INTO cortex_messages (id, conversation_id, role, content, msg_index, has_code, has_question, word_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(msgId, conversation_id, msg.role, msg.content, i, hasCode, hasQuestion, wordCount, started_at)
      );
    }
    // D1 batch limit is 100 statements
    for (let i = 0; i < batch.length; i += 100) {
      await env.DB.batch(batch.slice(i, i + 100));
    }
  }

  // Embed summary for vector search
  if (summary) {
    const embedText = [
      title ? `${title}:` : "",
      summary,
      domain ? `[${domain}]` : "",
      concepts?.length ? `Concepts: ${concepts.join(", ")}` : ""
    ].filter(Boolean).join(" ");

    try {
      const embedding = await getEmbedding(env, embedText);
      const metadata: Record<string, string> = {
        source: "cortex",
        type: "conversation",
        added_at: new Date().toISOString()
      };
      if (domain) metadata.domain = domain;
      if (importance !== "routine") metadata.importance = importance;
      if (title) metadata.title = title.slice(0, 100);

      await env.VECTORS.upsert([{ id: `conv-${conversation_id}`, values: embedding, metadata }]);
    } catch (e) {
      console.error("Conversation embedding failed:", e);
    }
  }

  const lines: string[] = [];
  lines.push(`Saved conversation: ${title || conversation_id}`);
  if (domain) lines.push(`Domain: ${domain}`);
  if (messages?.length) lines.push(`Messages: ${messages.length}`);
  if (decisions?.length) lines.push(`Decisions: ${decisions.length}`);
  if (open_questions?.length) lines.push(`Open questions: ${open_questions.length}`);
  lines.push(`ID: ${conversation_id}`);

  return lines.join("\n");
}

/**
 * cortex_search_conversations — Search conversations by keyword, domain, date range, or semantics.
 */
export async function handleCortexSearchConversations(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const query = (params.query as string) || null;
  const domain = (params.domain as string) || null;
  const source = (params.source as string) || null;
  const date_from = (params.date_from as string) || null;
  const date_to = (params.date_to as string) || null;
  const importance = (params.importance as string) || null;
  const has_open_questions = params.has_open_questions as boolean | undefined;
  const limit = Math.min((params.limit as number) || CORTEX_SEARCH_LIMIT, 50);

  // If we have a query, do hybrid search (vector + SQL)
  let vectorConvIds: Set<string> | null = null;
  if (query) {
    const embedding = await getEmbedding(env, query);
    const vectorResults = await env.VECTORS.query(embedding, {
      topK: limit * 2,
      returnMetadata: "all",
      filter: { source: "cortex", type: "conversation" }
    });
    vectorConvIds = new Set(
      (vectorResults.matches || [])
        .filter(m => m.id.startsWith("conv-"))
        .map(m => m.id.replace("conv-", ""))
    );
  }

  // Build SQL query
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (domain) {
    conditions.push("domain = ?");
    binds.push(domain);
  }
  if (source) {
    conditions.push("source = ?");
    binds.push(source);
  }
  if (date_from) {
    conditions.push("(started_at >= ? OR created_at >= ?)");
    binds.push(date_from, date_from);
  }
  if (date_to) {
    conditions.push("(started_at <= ? OR created_at <= ?)");
    binds.push(date_to, date_to);
  }
  if (importance) {
    conditions.push("importance = ?");
    binds.push(importance);
  }
  if (has_open_questions) {
    conditions.push("open_questions IS NOT NULL AND open_questions != '[]'");
  }

  // If vector search returned IDs, filter to those
  if (vectorConvIds && vectorConvIds.size > 0) {
    const placeholders = Array.from(vectorConvIds).map(() => "?").join(",");
    conditions.push(`id IN (${placeholders})`);
    binds.push(...vectorConvIds);
  }

  // If query but no vector results, fall back to keyword search on title/summary
  if (query && (!vectorConvIds || vectorConvIds.size === 0)) {
    conditions.push("(title LIKE ? OR summary LIKE ?)");
    binds.push(`%${query}%`, `%${query}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM cortex_conversations ${whereClause} ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);

  const results = await env.DB.prepare(sql).bind(...binds).all();

  if (!results.results?.length) {
    return query
      ? `No conversations found matching "${query}"`
      : "No conversations found matching filters";
  }

  const lines: string[] = [];
  lines.push(`## Conversations (${results.results.length} found)`);
  lines.push("");

  for (const c of results.results) {
    const date = (c.started_at as string)?.slice(0, 10) || (c.created_at as string)?.slice(0, 10) || "";
    const domainStr = c.domain ? ` [${c.domain}]` : "";
    const importanceStr = c.importance === "breakthrough" ? " ***" : c.importance === "significant" ? " **" : "";

    lines.push(`### ${c.title || c.id}${domainStr}${importanceStr}`);
    lines.push(`*${date} | ${c.source} | ${c.message_count || 0} messages*`);

    if (c.summary) {
      const summaryText = (c.summary as string).slice(0, 300);
      lines.push(summaryText + ((c.summary as string).length > 300 ? "..." : ""));
    }

    if (c.decisions) {
      try {
        const decs = JSON.parse(c.decisions as string);
        if (decs.length) lines.push(`Decisions: ${decs.join("; ")}`);
      } catch { /* skip */ }
    }

    if (c.open_questions) {
      try {
        const qs = JSON.parse(c.open_questions as string);
        if (qs.length) lines.push(`Open: ${qs.join("; ")}`);
      } catch { /* skip */ }
    }

    lines.push(`ID: ${c.id}`);
    lines.push("");
  }

  return lines.join("\n");
}
