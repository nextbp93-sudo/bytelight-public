/**
 * Cortex: Remember + Recall
 * Store thoughts (decisions, principles, insights) and recall them via vector search.
 */

import { generateId, getEmbedding } from "../utils";
import { rankRecall, renderConversation, scoreMap, splitMatchIds } from "./recall-merge";
import { CORTEX_RECALL_TOP_K } from "../config";
import type { Env } from "../types";

/**
 * cortex_remember — Save a thought, decision, principle, or insight.
 * Embeds the content and stores in both D1 and Vectorize.
 */
export async function handleCortexRemember(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const type = (params.type as string) || "observation";
  const content = params.content as string;
  const domain = (params.domain as string) || null;
  const context = (params.context as string) || null;
  const importance = (params.importance as string) || "routine";
  const thinking_stage = (params.thinking_stage as string) || null;
  const open_questions = params.open_questions as string[] | undefined;
  const related_thoughts = params.related_thoughts as string[] | undefined;

  if (!content) return "Error: content is required";

  const validTypes = ["decision", "principle", "insight", "observation", "question"];
  if (!validTypes.includes(type)) {
    return `Error: type must be one of: ${validTypes.join(", ")}`;
  }

  const id = generateId("ctx");

  // Store in D1
  await env.DB.prepare(`
    INSERT INTO cortex_thoughts (id, type, domain, content, context, importance, thinking_stage, open_questions, related_thoughts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, type, domain, content, context, importance, thinking_stage,
    open_questions ? JSON.stringify(open_questions) : null,
    related_thoughts ? JSON.stringify(related_thoughts) : null
  ).run();

  // Generate embedding and store in Vectorize
  const embedText = [
    domain ? `[${domain}]` : "",
    `(${type})`,
    content,
    context ? `Context: ${context}` : ""
  ].filter(Boolean).join(" ");

  try {
    const embedding = await getEmbedding(env, embedText);
    const metadata: Record<string, string> = {
      source: "cortex",
      type: "thought",
      thought_type: type,
      added_at: new Date().toISOString()
    };
    if (domain) metadata.domain = domain;
    if (importance !== "routine") metadata.importance = importance;

    await env.VECTORS.upsert([{ id: `ctx-${id}`, values: embedding, metadata }]);
  } catch (e) {
    console.error("Cortex embedding failed:", e);
  }

  const lines: string[] = [];
  lines.push(`Stored ${type}${domain ? ` in ${domain}` : ""}`);
  lines.push(`> ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
  if (importance !== "routine") lines.push(`Importance: ${importance}`);
  if (thinking_stage) lines.push(`Stage: ${thinking_stage}`);
  if (open_questions?.length) lines.push(`Open questions: ${open_questions.length}`);
  lines.push(`ID: ${id}`);

  return lines.join("\n");
}

/**
 * cortex_recall — Vector search over stored thoughts.
 * Returns semantically similar thoughts with metadata.
 */
export async function handleCortexRecall(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const query = params.query as string;
  const limit = Math.min((params.limit as number) || CORTEX_RECALL_TOP_K, 30);
  const type = (params.type as string) || null;
  const domain = (params.domain as string) || null;

  if (!query) return "Error: query is required";

  // Vector search with cortex source filter
  const embedding = await getEmbedding(env, query);
  const vectorResults = await env.VECTORS.query(embedding, {
    topK: limit * 2,  // over-fetch to allow post-filtering
    returnMetadata: "all",
    filter: { source: "cortex" }
  });

  if (!vectorResults.matches?.length) {
    return `No cortex memories found for "${query}"`;
  }

  // Thoughts AND conversations (cortex/recall-merge.ts). A type filter asks
  // for one kind of thought, so it leaves conversations out.
  const { thoughtIds, conversationIds } = splitMatchIds(vectorResults.matches);
  const wantConversations = !type;

  let thoughts: Record<string, unknown>[] = [];
  if (thoughtIds.length) {
    const placeholders = thoughtIds.map(() => "?").join(",");
    let sql = `SELECT * FROM cortex_thoughts WHERE id IN (${placeholders})`;
    const bindValues: unknown[] = [...thoughtIds];
    if (type) {
      sql += " AND type = ?";
      bindValues.push(type);
    }
    if (domain) {
      sql += " AND domain = ?";
      bindValues.push(domain);
    }
    thoughts = (await env.DB.prepare(sql).bind(...bindValues).all()).results ?? [];
  }

  let conversations: Record<string, unknown>[] = [];
  if (wantConversations && conversationIds.length) {
    const placeholders = conversationIds.map(() => "?").join(",");
    let sql = `SELECT * FROM cortex_conversations WHERE id IN (${placeholders})`;
    const bindValues: unknown[] = [...conversationIds];
    if (domain) {
      sql += " AND domain = ?";
      bindValues.push(domain);
    }
    conversations = (await env.DB.prepare(sql).bind(...bindValues).all()).results ?? [];
  }

  if (!thoughts.length && !conversations.length) {
    return `No matching thoughts found for "${query}"`;
  }

  const sorted = rankRecall(thoughts, conversations, scoreMap(vectorResults.matches), limit);

  // Update access tracking, for the thoughts that were actually returned
  const now = new Date().toISOString();
  for (const hit of sorted) {
    if (hit.kind !== "thought") continue;
    await env.DB.prepare("UPDATE cortex_thoughts SET accessed_at = ? WHERE id = ?")
      .bind(now, hit.row.id).run();
  }

  const lines: string[] = [];
  lines.push(`## Cortex Recall: "${query}" (${sorted.length} found)`);
  lines.push("");

  for (const hit of sorted) {
    if (hit.kind === "conversation") {
      lines.push(...renderConversation(hit.row, hit.score));
      lines.push("");
      continue;
    }
    const t = hit.row;
    const score = hit.score;
    const scoreStr = score ? ` (${(score * 100).toFixed(0)}%)` : "";
    const domainStr = t.domain ? ` [${t.domain}]` : "";
    const date = (t.created_at as string)?.slice(0, 10) || "unknown";

    lines.push(`### ${t.type}${domainStr}${scoreStr} — ${date}`);
    lines.push(t.content as string);

    if (t.importance && t.importance !== "routine") {
      lines.push(`*Importance: ${t.importance}*`);
    }
    if (t.thinking_stage) {
      lines.push(`*Stage: ${t.thinking_stage}*`);
    }
    if (t.open_questions) {
      try {
        const qs = JSON.parse(t.open_questions as string);
        if (qs.length) lines.push(`Open questions: ${qs.join("; ")}`);
      } catch { /* skip */ }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_save_principle — Dedicated tool to save a principle.
 * Shortcut for cortex_remember with type="principle", with additional fields.
 */
export async function handleCortexSavePrinciple(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const content = params.content as string;
  const domain = (params.domain as string) || null;
  const context = (params.context as string) || null;
  const importance = (params.importance as string) || "significant";

  if (!content) return "Error: content is required — what's the principle?";

  return handleCortexRemember(env, {
    type: "principle",
    content,
    domain,
    context,
    importance
  });
}

/**
 * cortex_list_principles — List all stored principles, optionally filtered by domain.
 */
export async function handleCortexListPrinciples(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const domain = (params.domain as string) || null;

  let sql = "SELECT * FROM cortex_thoughts WHERE type = 'principle'";
  const binds: unknown[] = [];

  if (domain) {
    sql += " AND (domain = ? OR domain IS NULL)";
    binds.push(domain);
  }

  sql += " ORDER BY CASE importance WHEN 'breakthrough' THEN 0 WHEN 'significant' THEN 1 ELSE 2 END, created_at DESC";

  const results = await env.DB.prepare(sql).bind(...binds).all();

  if (!results.results?.length) {
    return domain
      ? `No principles stored for domain "${domain}". Use cortex_save_principle to add some.`
      : "No principles stored yet. Use cortex_save_principle to add some.";
  }

  const lines: string[] = [];
  lines.push(`## Principles${domain ? ` (${domain})` : ""} — ${results.results.length} stored`);
  lines.push("");

  for (const p of results.results) {
    const icon = p.importance === "breakthrough" ? "💎" : p.importance === "significant" ? "⭐" : "📝";
    const domainStr = p.domain ? ` [${p.domain}]` : "";
    const date = (p.created_at as string)?.slice(0, 10) || "";

    lines.push(`${icon} **${(p.content as string).slice(0, 200)}**${domainStr}`);
    if (p.context) lines.push(`  *Context: ${(p.context as string).slice(0, 150)}*`);
    lines.push(`  Added: ${date} | ID: ${p.id}`);
    lines.push("");
  }

  return lines.join("\n");
}
