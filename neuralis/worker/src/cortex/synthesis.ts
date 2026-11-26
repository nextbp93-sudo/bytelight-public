/**
 * Cortex: Synthesis Tools
 * LLM-powered analysis over stored thoughts and conversations.
 */

import { getEmbedding } from "../utils";
import { generateText } from "../embeddings";
import { CORTEX_SYNTHESIS_CONTEXT } from "../config";
import type { Env } from "../types";

/** Safely parse a JSON array field, returning empty array on failure */
function parseJsonField(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value as string);
    return Array.isArray(parsed) ? parsed.filter((v: string) => v && !v.toLowerCase().includes("none identified")) : [];
  } catch {
    return [];
  }
}

/** Deduplicate strings by first N characters */
function dedup(items: string[], prefixLen = 80): string[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.slice(0, prefixLen).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * cortex_what_do_i_think — Synthesize thinking on a topic.
 * Gathers relevant thoughts + conversations, sends to Gemini Flash for synthesis.
 */
export async function handleCortexWhatDoIThink(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const topic = params.topic as string;
  if (!topic) return "Error: topic is required";

  const limit = Math.min((params.limit as number) || CORTEX_SYNTHESIS_CONTEXT, 20);

  // Gather relevant data from both tables via vector search
  const embedding = await getEmbedding(env, topic);
  const vectorResults = await env.VECTORS.query(embedding, {
    topK: limit * 3,
    returnMetadata: "all",
    filter: { source: "cortex" }
  });

  const thoughtIds: string[] = [];
  const convIds: string[] = [];
  for (const m of vectorResults.matches || []) {
    if (m.id.startsWith("ctx-")) thoughtIds.push(m.id.replace("ctx-", ""));
    if (m.id.startsWith("conv-")) convIds.push(m.id.replace("conv-", ""));
  }

  // Fetch thoughts
  let thoughts: Record<string, unknown>[] = [];
  if (thoughtIds.length) {
    const ph = thoughtIds.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT * FROM cortex_thoughts WHERE id IN (${ph}) ORDER BY created_at DESC`
    ).bind(...thoughtIds).all();
    thoughts = result.results || [];
  }

  // Fetch conversations
  let conversations: Record<string, unknown>[] = [];
  if (convIds.length) {
    const ph = convIds.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT * FROM cortex_conversations WHERE id IN (${ph}) ORDER BY created_at DESC`
    ).bind(...convIds).all();
    conversations = result.results || [];
  }

  // Also do keyword search as fallback
  const keywordThoughts = await env.DB.prepare(
    `SELECT * FROM cortex_thoughts WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?`
  ).bind(`%${topic}%`, limit).all();

  const keywordConvs = await env.DB.prepare(
    `SELECT * FROM cortex_conversations WHERE (title LIKE ? OR summary LIKE ?) ORDER BY created_at DESC LIMIT ?`
  ).bind(`%${topic}%`, `%${topic}%`, limit).all();

  // Merge and deduplicate
  const allThoughtIds = new Set<string>();
  const allThoughts: Record<string, unknown>[] = [];
  for (const t of [...thoughts, ...(keywordThoughts.results || [])]) {
    if (!allThoughtIds.has(t.id as string)) {
      allThoughtIds.add(t.id as string);
      allThoughts.push(t);
    }
  }

  const allConvIds = new Set<string>();
  const allConvs: Record<string, unknown>[] = [];
  for (const c of [...conversations, ...(keywordConvs.results || [])]) {
    if (!allConvIds.has(c.id as string)) {
      allConvIds.add(c.id as string);
      allConvs.push(c);
    }
  }

  if (!allThoughts.length && !allConvs.length) {
    return `No data found about "${topic}" in the cortex. Try cortex_remember to store some thoughts first.`;
  }

  // Collect decisions, open questions, insights across all data
  const allDecisions: string[] = [];
  const allOpenQuestions: string[] = [];
  const allInsights: string[] = [];

  for (const t of allThoughts) {
    if (t.type === "decision") allDecisions.push(t.content as string);
    if (t.type === "question") allOpenQuestions.push(t.content as string);
    if (t.type === "insight") allInsights.push(t.content as string);
    allOpenQuestions.push(...parseJsonField(t.open_questions));
  }

  for (const c of allConvs) {
    allDecisions.push(...parseJsonField(c.decisions));
    allOpenQuestions.push(...parseJsonField(c.open_questions));
    allInsights.push(...parseJsonField(c.key_insights));
  }

  // Build synthesis with Gemini Flash
  const contextParts: string[] = [];
  for (const t of allThoughts.slice(0, limit)) {
    contextParts.push(`[${t.type}] ${t.content}${t.domain ? ` (${t.domain})` : ""}`);
  }
  for (const c of allConvs.slice(0, limit)) {
    if (c.summary) contextParts.push(`[conversation: ${c.title || "untitled"}] ${c.summary}`);
  }

  let synthesis = "";
  try {
    const prompt = `You are analyzing stored thoughts and conversations about "${topic}". Based on the following data, provide a concise synthesis of current thinking - what's been decided, what's still open, and what the trajectory looks like. Be direct and specific.\n\nData:\n${contextParts.join("\n\n")}`;
    synthesis = await generateText(env.GEMINI_API_KEY, prompt);
  } catch (e) {
    console.log(`Cortex synthesis (what_do_i_think) Gemini error: ${e}`);
    synthesis = "";
  }

  // Format output
  const lines: string[] = [];
  lines.push(`## What do I think about: ${topic}`);
  lines.push("");

  if (synthesis) {
    lines.push("### Synthesis");
    lines.push(synthesis);
    lines.push("");
  }

  lines.push(`*${allThoughts.length} thoughts + ${allConvs.length} conversations analyzed*`);
  lines.push("");

  const dedupedDecisions = dedup(allDecisions);
  if (dedupedDecisions.length) {
    lines.push("### Key Decisions");
    for (const d of dedupedDecisions.slice(0, 10)) {
      lines.push(`- ${d}`);
    }
    lines.push("");
  }

  const dedupedQuestions = dedup(allOpenQuestions);
  if (dedupedQuestions.length) {
    lines.push("### Still Open");
    for (const q of dedupedQuestions.slice(0, 10)) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  const dedupedInsights = dedup(allInsights);
  if (dedupedInsights.length) {
    lines.push("### Key Insights");
    for (const i of dedupedInsights.slice(0, 10)) {
      lines.push(`- ${i}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_alignment_check — Check a decision against stored principles.
 */
export async function handleCortexAlignmentCheck(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const decision = params.decision as string;
  const domain = (params.domain as string) || null;

  if (!decision) return "Error: decision is required";

  // Find principles
  let principleQuery = "SELECT * FROM cortex_thoughts WHERE type = 'principle'";
  const binds: unknown[] = [];
  if (domain) {
    principleQuery += " AND (domain = ? OR domain IS NULL)";
    binds.push(domain);
  }
  principleQuery += " ORDER BY importance DESC, created_at DESC LIMIT 20";

  const principles = await env.DB.prepare(principleQuery).bind(...binds).all();

  // Also do vector search for relevant past decisions
  const embedding = await getEmbedding(env, decision);
  const vectorResults = await env.VECTORS.query(embedding, {
    topK: 10,
    returnMetadata: "all",
    filter: { source: "cortex" }
  });

  const relatedIds = (vectorResults.matches || [])
    .filter(m => m.id.startsWith("ctx-"))
    .map(m => m.id.replace("ctx-", ""));

  let relatedThoughts: Record<string, unknown>[] = [];
  if (relatedIds.length) {
    const ph = relatedIds.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT * FROM cortex_thoughts WHERE id IN (${ph}) AND type = 'decision'`
    ).bind(...relatedIds).all();
    relatedThoughts = result.results || [];
  }

  const lines: string[] = [];
  lines.push(`## Alignment Check: ${decision}`);
  lines.push("");

  if (principles.results?.length) {
    // Use Gemini Flash to check alignment
    const principleTexts = principles.results.map(p =>
      `${p.content}${p.domain ? ` (${p.domain})` : ""}`
    ).join("\n");

    try {
      const prompt = `You are checking whether this decision aligns with stored principles. Be direct and specific about alignment or conflicts.\n\nDecision: "${decision}"\n\nPrinciples:\n${principleTexts}\n\nRespond with: which principles support or conflict with this decision, and any considerations.`;
      const analysis = await generateText(env.GEMINI_API_KEY, prompt);
      lines.push("### Analysis");
      lines.push(analysis);
      lines.push("");
    } catch (e) {
      console.log(`Cortex alignment_check Gemini error: ${e}`);
    }

    lines.push("### Relevant Principles");
    for (const p of principles.results.slice(0, 5)) {
      const domainStr = p.domain ? ` [${p.domain}]` : "";
      lines.push(`**${(p.content as string).slice(0, 100)}**${domainStr}`);
    }
    lines.push("");
  } else {
    lines.push("*No principles stored yet. Use cortex_remember with type='principle' to add some.*");
    lines.push("");
  }

  if (relatedThoughts.length) {
    lines.push("### Related Past Decisions");
    for (const t of relatedThoughts.slice(0, 5)) {
      const date = (t.created_at as string)?.slice(0, 10) || "";
      const domainStr = t.domain ? ` [${t.domain}]` : "";
      lines.push(`- ${date}${domainStr}: ${(t.content as string).slice(0, 150)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_thinking_trajectory — Track how thinking on a concept evolved over time.
 */
export async function handleCortexThinkingTrajectory(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const topic = params.topic as string;
  if (!topic) return "Error: topic is required";

  // Get chronological data from both tables
  const thoughts = await env.DB.prepare(
    `SELECT id, type, domain, content, importance, thinking_stage, created_at
     FROM cortex_thoughts WHERE content LIKE ?
     ORDER BY created_at ASC`
  ).bind(`%${topic}%`).all();

  const conversations = await env.DB.prepare(
    `SELECT id, title, summary, domain, importance, thinking_stage, concepts, created_at
     FROM cortex_conversations WHERE (title LIKE ? OR summary LIKE ?)
     ORDER BY created_at ASC`
  ).bind(`%${topic}%`, `%${topic}%`).all();

  // Also vector search for semantic matches
  const embedding = await getEmbedding(env, topic);
  const vectorResults = await env.VECTORS.query(embedding, {
    topK: 20,
    returnMetadata: "all",
    filter: { source: "cortex" }
  });

  const semanticIds = new Set(
    (vectorResults.matches || []).map(m => m.id.replace(/^(ctx|conv)-/, ""))
  );

  const allItems: Array<{
    date: string;
    type: string;
    content: string;
    domain: string | null;
    stage: string | null;
    importance: string;
    source: "thought" | "conversation";
  }> = [];

  for (const t of thoughts.results || []) {
    allItems.push({
      date: t.created_at as string,
      type: t.type as string,
      content: t.content as string,
      domain: t.domain as string | null,
      stage: t.thinking_stage as string | null,
      importance: t.importance as string,
      source: "thought"
    });
  }

  for (const c of conversations.results || []) {
    allItems.push({
      date: c.created_at as string,
      type: "conversation",
      content: (c.summary || c.title || "") as string,
      domain: c.domain as string | null,
      stage: c.thinking_stage as string | null,
      importance: c.importance as string,
      source: "conversation"
    });
  }

  // Sort chronologically
  allItems.sort((a, b) => a.date.localeCompare(b.date));

  if (!allItems.length) {
    return `No trajectory data found for "${topic}". Store some thoughts or conversations first.`;
  }

  // Analyze trajectory
  const lines: string[] = [];
  lines.push(`## Thinking Trajectory: "${topic}"`);
  lines.push("");

  // Genesis
  const first = allItems[0];
  const last = allItems[allItems.length - 1];
  lines.push("### Genesis");
  lines.push(`**First appeared**: ${first.date.slice(0, 10)}`);
  lines.push(`**Type**: ${first.type}`);
  lines.push(`> ${first.content.slice(0, 200)}${first.content.length > 200 ? "..." : ""}`);
  lines.push("");

  // Timeline
  const monthGroups = new Map<string, number>();
  for (const item of allItems) {
    const month = item.date.slice(0, 7);
    monthGroups.set(month, (monthGroups.get(month) || 0) + 1);
  }

  const maxCount = Math.max(...monthGroups.values());

  lines.push("### Timeline");
  lines.push(`**Total**: ${allItems.length} entries over ${monthGroups.size} months`);
  lines.push(`**Span**: ${first.date.slice(0, 10)} to ${last.date.slice(0, 10)}`);
  lines.push("");

  for (const [month, count] of monthGroups) {
    const bar = "\u2588".repeat(Math.ceil((count / maxCount) * 15));
    const peak = count === maxCount ? " <- PEAK" : "";
    lines.push(`  ${month}: ${count.toString().padStart(3)} ${bar}${peak}`);
  }
  lines.push("");

  // Stage progression
  const stageProgression: Array<{ stage: string; count: number }> = [];
  const stageCounts = new Map<string, number>();
  for (const item of allItems) {
    if (item.stage) {
      stageCounts.set(item.stage, (stageCounts.get(item.stage) || 0) + 1);
    }
  }

  if (stageCounts.size) {
    lines.push("### Thinking Stage Progression");
    const stageOrder = ["exploring", "crystallizing", "refining", "executing"];
    for (const stage of stageOrder) {
      const count = stageCounts.get(stage);
      if (count) {
        const icon = stage === "exploring" ? "🔍" : stage === "crystallizing" ? "💎" : stage === "refining" ? "🔧" : "🚀";
        lines.push(`  ${icon} ${stage}: ${count}`);
      }
    }
    lines.push("");
  }

  // Trend analysis
  if (monthGroups.size >= 3) {
    const months = Array.from(monthGroups.entries());
    const earlyAvg = months.slice(0, Math.ceil(months.length / 3)).reduce((s, [, c]) => s + c, 0) / Math.ceil(months.length / 3);
    const recentAvg = months.slice(-Math.ceil(months.length / 3)).reduce((s, [, c]) => s + c, 0) / Math.ceil(months.length / 3);

    let trend: string;
    if (recentAvg > earlyAvg * 1.5) trend = "ACCELERATING — thinking about this more over time";
    else if (recentAvg < earlyAvg * 0.5) trend = "DECLINING — less focus recently";
    else trend = "STABLE — consistent attention";

    lines.push(`### Trend: ${trend}`);
    lines.push("");
  }

  // Semantic matches not in keyword results
  const semanticOnly = (vectorResults.matches || [])
    .filter(m => !allItems.some(i =>
      (i.source === "thought" && m.id === `ctx-${(thoughts.results || []).find(t => (t.content as string) === i.content)?.id}`) ||
      (i.source === "conversation")
    ))
    .slice(0, 5);

  if (semanticOnly.length) {
    lines.push("### Semantically Related (not keyword matches)");
    lines.push(`*${semanticOnly.length} related entries found via meaning similarity*`);
    lines.push("");
  }

  return lines.join("\n");
}
