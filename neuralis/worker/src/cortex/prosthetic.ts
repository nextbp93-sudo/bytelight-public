/**
 * Cortex: Cognitive Prosthetic Tools
 * Domain state recovery, dormant context detection, open thread tracking.
 */

import { CORTEX_DORMANT_DAYS } from "../config";
import type { Env } from "../types";

/** Safely parse a JSON array field */
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
 * cortex_tunnel_state — Reconstruct where you left off on a domain.
 * Returns: open questions, recent decisions, active concepts, thinking stage.
 */
export async function handleCortexTunnelState(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const domain = params.domain as string;
  if (!domain) return "Error: domain is required";

  const limit = Math.min((params.limit as number) || 10, 30);

  // Get recent conversations for this domain
  const conversations = await env.DB.prepare(
    `SELECT title, summary, thinking_stage, importance, emotional_tone,
            decisions, open_questions, key_insights, concepts, message_count, created_at
     FROM cortex_conversations WHERE domain = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(domain, limit).all();

  // Get thoughts for this domain
  const thoughts = await env.DB.prepare(
    `SELECT type, content, importance, thinking_stage, open_questions, created_at
     FROM cortex_thoughts WHERE domain = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(domain, limit).all();

  if (!conversations.results?.length && !thoughts.results?.length) {
    return `No data found for domain "${domain}". Try cortex_remember or cortex_save_conversation first.`;
  }

  // Aggregate across all results
  const allDecisions: string[] = [];
  const allOpenQuestions: string[] = [];
  const allInsights: string[] = [];
  const allConcepts: string[] = [];
  const stageCounts = new Map<string, number>();
  let breakthroughCount = 0;
  let latestStage: string | null = null;
  let latestTone: string | null = null;

  for (const c of conversations.results || []) {
    allDecisions.push(...parseJsonField(c.decisions));
    allOpenQuestions.push(...parseJsonField(c.open_questions));
    allInsights.push(...parseJsonField(c.key_insights));
    allConcepts.push(...parseJsonField(c.concepts));
    if (c.thinking_stage) {
      stageCounts.set(c.thinking_stage as string, (stageCounts.get(c.thinking_stage as string) || 0) + 1);
      if (!latestStage) latestStage = c.thinking_stage as string;
    }
    if (c.emotional_tone && !latestTone) latestTone = c.emotional_tone as string;
    if (c.importance === "breakthrough") breakthroughCount++;
  }

  for (const t of thoughts.results || []) {
    if (t.type === "decision") allDecisions.push(t.content as string);
    if (t.type === "question") allOpenQuestions.push(t.content as string);
    if (t.type === "insight") allInsights.push(t.content as string);
    allOpenQuestions.push(...parseJsonField(t.open_questions));
    if (t.thinking_stage && !latestStage) latestStage = t.thinking_stage as string;
    if (t.importance === "breakthrough") breakthroughCount++;
  }

  const lines: string[] = [];
  lines.push(`## Tunnel State: ${domain}`);
  lines.push("");

  const convCount = conversations.results?.length || 0;
  const thoughtCount = thoughts.results?.length || 0;

  if (latestStage) lines.push(`**Current stage:** ${latestStage}`);
  if (latestTone) lines.push(`**Emotional tone:** ${latestTone}`);
  lines.push(`**Conversations:** ${convCount} | **Thoughts:** ${thoughtCount}`);
  if (breakthroughCount) lines.push(`**Breakthroughs:** ${breakthroughCount}`);
  lines.push("");

  const dedupedQuestions = dedup(allOpenQuestions);
  if (dedupedQuestions.length) {
    lines.push(`### Open Questions (${dedupedQuestions.length})`);
    for (const q of dedupedQuestions.slice(0, 15)) {
      lines.push(`  - ${q}`);
    }
    if (dedupedQuestions.length > 15) lines.push(`  *... and ${dedupedQuestions.length - 15} more*`);
    lines.push("");
  }

  const dedupedDecisions = dedup(allDecisions);
  if (dedupedDecisions.length) {
    lines.push(`### Decisions (${dedupedDecisions.length})`);
    for (const d of dedupedDecisions.slice(0, 10)) {
      lines.push(`  - ${d}`);
    }
    lines.push("");
  }

  const dedupedConcepts = dedup(allConcepts, 40);
  if (dedupedConcepts.length) {
    lines.push(`### Active Concepts (${dedupedConcepts.length})`);
    lines.push(`  ${dedupedConcepts.slice(0, 20).join(", ")}`);
    lines.push("");
  }

  const dedupedInsights = dedup(allInsights);
  if (dedupedInsights.length) {
    lines.push(`### Key Insights`);
    for (const i of dedupedInsights.slice(0, 10)) {
      lines.push(`  - ${i}`);
    }
    lines.push("");
  }

  if (stageCounts.size) {
    lines.push("### Thinking Stage History");
    for (const [stage, count] of stageCounts) {
      lines.push(`  ${stage}: ${count}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_context_recovery — Full re-entry brief for a domain.
 * More detailed than tunnel_state — includes recent summaries and cross-references.
 */
export async function handleCortexContextRecovery(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const domain = params.domain as string;
  if (!domain) return "Error: domain is required";

  const summaryCount = Math.min((params.summary_count as number) || 5, 15);

  // Get recent conversations with full summaries
  const conversations = await env.DB.prepare(
    `SELECT * FROM cortex_conversations WHERE domain = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(domain, summaryCount + 10).all();

  // Get all thoughts for this domain
  const thoughts = await env.DB.prepare(
    `SELECT * FROM cortex_thoughts WHERE domain = ?
     ORDER BY created_at DESC LIMIT 30`
  ).bind(domain).all();

  // Also check mind layer for related entities
  let mindEntities: Record<string, unknown>[] = [];
  try {
    const entityResult = await env.DB.prepare(
      `SELECT e.name, e.entity_type, e.context, COUNT(o.id) as obs_count
       FROM entities e
       LEFT JOIN observations o ON e.id = o.entity_id
       WHERE e.name LIKE ? OR e.context LIKE ?
       GROUP BY e.id
       ORDER BY obs_count DESC LIMIT 5`
    ).bind(`%${domain}%`, `%${domain}%`).all();
    mindEntities = entityResult.results || [];
  } catch { /* mind layer tables might not exist */ }

  if (!conversations.results?.length && !thoughts.results?.length) {
    return `No cortex data for domain "${domain}".`;
  }

  const lines: string[] = [];
  lines.push(`## Context Recovery: ${domain}`);
  lines.push("");

  // Quick stats
  const convCount = conversations.results?.length || 0;
  const thoughtCount = thoughts.results?.length || 0;
  const latestConv = conversations.results?.[0];
  const latestStage = (latestConv?.thinking_stage as string) || null;
  const latestTone = (latestConv?.emotional_tone as string) || null;

  lines.push(`**Stage:** ${latestStage || "unknown"} | **Tone:** ${latestTone || "unknown"} | **Conversations:** ${convCount} | **Thoughts:** ${thoughtCount}`);
  lines.push("");

  // Recent summaries
  if (conversations.results?.length) {
    lines.push("### Recent Summaries");
    for (const c of conversations.results.slice(0, summaryCount)) {
      const icon = c.importance === "breakthrough" ? "💎" : c.importance === "significant" ? "⭐" : "📝";
      const msgCount = c.message_count ? `, ${c.message_count} msgs` : "";
      lines.push(`**${icon} ${c.title || "Untitled"}** (${c.source}${msgCount})`);
      if (c.summary) {
        const summaryText = (c.summary as string).slice(0, 300);
        lines.push(`> ${summaryText}${(c.summary as string).length > 300 ? "..." : ""}`);
      }
      lines.push("");
    }
  }

  // Aggregate open questions and decisions
  const allQuestions: string[] = [];
  const allDecisions: string[] = [];
  const allInsights: string[] = [];

  for (const c of conversations.results || []) {
    allQuestions.push(...parseJsonField(c.open_questions));
    allDecisions.push(...parseJsonField(c.decisions));
    allInsights.push(...parseJsonField(c.key_insights));
  }
  for (const t of thoughts.results || []) {
    if (t.type === "question") allQuestions.push(t.content as string);
    if (t.type === "decision") allDecisions.push(t.content as string);
    if (t.type === "insight") allInsights.push(t.content as string);
    allQuestions.push(...parseJsonField(t.open_questions));
  }

  const dedupedQ = dedup(allQuestions);
  if (dedupedQ.length) {
    lines.push(`### Open Questions (${dedupedQ.length})`);
    for (const q of dedupedQ.slice(0, 15)) {
      lines.push(`  - ${q}`);
    }
    if (dedupedQ.length > 15) lines.push(`  *... and ${dedupedQ.length - 15} more*`);
    lines.push("");
  }

  const dedupedD = dedup(allDecisions);
  if (dedupedD.length) {
    lines.push(`### Key Decisions (${dedupedD.length})`);
    for (const d of dedupedD.slice(0, 10)) {
      lines.push(`  - ${d}`);
    }
    lines.push("");
  }

  const dedupedI = dedup(allInsights);
  if (dedupedI.length) {
    lines.push(`### Key Insights`);
    for (const i of dedupedI.slice(0, 10)) {
      lines.push(`  - ${i}`);
    }
    lines.push("");
  }

  // Mind Bridge cross-reference
  if (mindEntities.length) {
    lines.push("### Related Mind Bridge Entities");
    for (const e of mindEntities) {
      lines.push(`  - ${e.name} (${e.entity_type}): ${e.obs_count} observations`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_dormant_contexts — Find domains with open questions that haven't been active recently.
 */
export async function handleCortexDormantContexts(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const days = (params.days as number) || CORTEX_DORMANT_DAYS;
  const limit = Math.min((params.limit as number) || 20, 50);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  // Find domains where latest activity is before cutoff and have open questions
  const results = await env.DB.prepare(`
    SELECT domain,
           COUNT(*) as conv_count,
           MAX(created_at) as last_active,
           GROUP_CONCAT(open_questions, '|||') as all_oq,
           GROUP_CONCAT(importance) as importances,
           MAX(thinking_stage) as latest_stage
    FROM cortex_conversations
    WHERE domain IS NOT NULL AND domain != ''
    GROUP BY domain
    HAVING MAX(created_at) < ?
    ORDER BY last_active ASC
    LIMIT ?
  `).bind(cutoff, limit).all();

  // Also check thoughts
  const dormantThoughts = await env.DB.prepare(`
    SELECT domain, COUNT(*) as count,
           MAX(created_at) as last_active,
           GROUP_CONCAT(CASE WHEN type = 'question' THEN content END, '|||') as questions
    FROM cortex_thoughts
    WHERE domain IS NOT NULL AND domain != ''
    GROUP BY domain
    HAVING MAX(created_at) < ?
  `).bind(cutoff).all();

  // Merge domains
  const domainMap = new Map<string, {
    convCount: number;
    thoughtCount: number;
    lastActive: string;
    questions: string[];
    stage: string | null;
    hasBreakthrough: boolean;
  }>();

  for (const r of results.results || []) {
    const questions: string[] = [];
    if (r.all_oq) {
      for (const chunk of (r.all_oq as string).split("|||")) {
        questions.push(...parseJsonField(chunk));
      }
    }

    domainMap.set(r.domain as string, {
      convCount: r.conv_count as number,
      thoughtCount: 0,
      lastActive: r.last_active as string,
      questions: dedup(questions),
      stage: r.latest_stage as string | null,
      hasBreakthrough: (r.importances as string)?.includes("breakthrough") || false
    });
  }

  for (const t of dormantThoughts.results || []) {
    const domain = t.domain as string;
    const existing = domainMap.get(domain);
    const tQuestions = t.questions ? (t.questions as string).split("|||").filter(Boolean) : [];

    if (existing) {
      existing.thoughtCount = t.count as number;
      existing.questions.push(...tQuestions);
      existing.questions = dedup(existing.questions);
      if (t.last_active as string > existing.lastActive) {
        existing.lastActive = t.last_active as string;
      }
    } else {
      domainMap.set(domain, {
        convCount: 0,
        thoughtCount: t.count as number,
        lastActive: t.last_active as string,
        questions: tQuestions,
        stage: null,
        hasBreakthrough: false
      });
    }
  }

  // Filter to only domains with open questions
  const withQuestions = Array.from(domainMap.entries())
    .filter(([, v]) => v.questions.length > 0)
    .sort((a, b) => {
      if (a[1].hasBreakthrough !== b[1].hasBreakthrough) return a[1].hasBreakthrough ? -1 : 1;
      return b[1].questions.length - a[1].questions.length;
    });

  if (!withQuestions.length) {
    return `No dormant domains with open questions found (threshold: ${days} days).`;
  }

  const lines: string[] = [];
  lines.push(`## Dormant Contexts (inactive ${days}+ days)`);
  lines.push(`*Domains with unresolved open questions*`);
  lines.push("");

  for (const [domain, data] of withQuestions) {
    const icon = data.hasBreakthrough ? " 💎" : "";
    const date = data.lastActive.slice(0, 10);
    lines.push(`### ${domain}${icon} (${data.questions.length} questions)`);
    lines.push(`*Last active: ${date} | ${data.convCount} convos, ${data.thoughtCount} thoughts${data.stage ? ` | Stage: ${data.stage}` : ""}*`);
    for (const q of data.questions.slice(0, 5)) {
      lines.push(`  - ${q}`);
    }
    if (data.questions.length > 5) lines.push(`  *... and ${data.questions.length - 5} more*`);
    lines.push("");
  }

  lines.push(`*Total: ${withQuestions.length} dormant domains with open questions*`);

  return lines.join("\n");
}

/**
 * cortex_open_threads — All unfinished work across all domains.
 */
export async function handleCortexOpenThreads(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const limitPerDomain = Math.min((params.limit_per_domain as number) || 5, 15);
  const maxDomains = Math.min((params.max_domains as number) || 20, 50);

  // Get all conversations with open questions, grouped by domain
  const results = await env.DB.prepare(`
    SELECT domain, open_questions, importance, thinking_stage, title, created_at
    FROM cortex_conversations
    WHERE open_questions IS NOT NULL AND open_questions != '[]'
    ORDER BY created_at DESC
  `).all();

  // Get open-question thoughts
  const openThoughts = await env.DB.prepare(`
    SELECT domain, content, importance, created_at
    FROM cortex_thoughts
    WHERE type = 'question'
    ORDER BY created_at DESC
  `).all();

  // Group by domain
  const domainData = new Map<string, {
    questions: string[];
    convCount: number;
    breakthroughs: number;
    latestStage: string | null;
  }>();

  for (const r of results.results || []) {
    const domain = (r.domain as string) || "unclassified";
    if (!domainData.has(domain)) {
      domainData.set(domain, { questions: [], convCount: 0, breakthroughs: 0, latestStage: null });
    }
    const data = domainData.get(domain)!;
    data.questions.push(...parseJsonField(r.open_questions));
    data.convCount++;
    if (r.importance === "breakthrough") data.breakthroughs++;
    if (r.thinking_stage && !data.latestStage) data.latestStage = r.thinking_stage as string;
  }

  for (const t of openThoughts.results || []) {
    const domain = (t.domain as string) || "unclassified";
    if (!domainData.has(domain)) {
      domainData.set(domain, { questions: [], convCount: 0, breakthroughs: 0, latestStage: null });
    }
    domainData.get(domain)!.questions.push(t.content as string);
  }

  // Deduplicate within each domain
  for (const [, data] of domainData) {
    data.questions = dedup(data.questions);
  }

  // Sort: breakthroughs first, then by question count
  const sorted = Array.from(domainData.entries())
    .filter(([, v]) => v.questions.length > 0)
    .sort((a, b) => {
      if (a[1].breakthroughs !== b[1].breakthroughs) return b[1].breakthroughs - a[1].breakthroughs;
      return b[1].questions.length - a[1].questions.length;
    })
    .slice(0, maxDomains);

  if (!sorted.length) {
    return "No open threads found. All questions resolved.";
  }

  const totalQuestions = sorted.reduce((sum, [, v]) => sum + v.questions.length, 0);

  const lines: string[] = [];
  lines.push(`## Open Threads`);
  lines.push(`**${totalQuestions} open questions** across **${sorted.length} domains**`);
  lines.push("");

  for (const [domain, data] of sorted) {
    const btIcon = data.breakthroughs > 0 ? ` 💎×${data.breakthroughs}` : "";
    lines.push(`### ${domain}${btIcon} (${data.questions.length} questions, ${data.convCount} convos)`);
    for (const q of data.questions.slice(0, limitPerDomain)) {
      lines.push(`  - ${q}`);
    }
    if (data.questions.length > limitPerDomain) {
      lines.push(`  *... and ${data.questions.length - limitPerDomain} more*`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_switching_cost — Estimate cognitive cost of switching between domains.
 * Score 0-1 (lower = cheaper to switch).
 */
export async function handleCortexSwitchingCost(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const current = params.current_domain as string;
  const target = params.target_domain as string;

  if (!current || !target) return "Error: current_domain and target_domain are required";

  const [curConvs, curThoughts, tgtConvs, tgtThoughts] = await Promise.all([
    env.DB.prepare(
      `SELECT open_questions, concepts, thinking_stage, importance
       FROM cortex_conversations WHERE domain = ? ORDER BY created_at DESC LIMIT 10`
    ).bind(current).all(),
    env.DB.prepare(
      `SELECT type, content, open_questions FROM cortex_thoughts
       WHERE domain = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(current).all(),
    env.DB.prepare(
      `SELECT concepts, thinking_stage FROM cortex_conversations
       WHERE domain = ? ORDER BY created_at DESC LIMIT 10`
    ).bind(target).all(),
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM cortex_thoughts WHERE domain = ?`
    ).bind(target).first()
  ]);

  const curOpenQuestions: string[] = [];
  const curConcepts = new Set<string>();
  let curStage: string | null = null;

  for (const c of curConvs.results || []) {
    curOpenQuestions.push(...parseJsonField(c.open_questions));
    for (const concept of parseJsonField(c.concepts)) curConcepts.add(concept.toLowerCase());
    if (!curStage && c.thinking_stage) curStage = c.thinking_stage as string;
  }
  for (const t of curThoughts.results || []) {
    if (t.type === "question") curOpenQuestions.push(t.content as string);
    curOpenQuestions.push(...parseJsonField(t.open_questions));
  }
  const dedupedCurQ = dedup(curOpenQuestions);

  const tgtConcepts = new Set<string>();
  let tgtStage: string | null = null;
  for (const c of tgtConvs.results || []) {
    for (const concept of parseJsonField(c.concepts)) tgtConcepts.add(concept.toLowerCase());
    if (!tgtStage && c.thinking_stage) tgtStage = c.thinking_stage as string;
  }

  const shared = new Set([...curConcepts].filter(c => tgtConcepts.has(c)));

  const oqCost = Math.min(dedupedCurQ.length / 10, 1.0);
  const stagePenalty: Record<string, number> = {
    executing: 0.8, refining: 0.6, crystallizing: 0.4, exploring: 0.2
  };
  const stageCost = stagePenalty[curStage || ""] || 0.3;
  const overlapDiscount = Math.min(shared.size / Math.max(curConcepts.size, 1), 1.0);

  const score = Math.max(0, Math.min(1, Math.round(
    ((oqCost * 0.35) + (stageCost * 0.35) - (overlapDiscount * 0.3)) * 1000
  ) / 1000));

  const rec = score < 0.3
    ? "Low cost — go for it"
    : score < 0.6
    ? "Moderate — consider noting current open questions first"
    : "High cost — significant unfinished work in current domain";

  const lines: string[] = [];
  lines.push(`## Switching Cost: ${current} -> ${target}`);
  lines.push("");
  lines.push(`### Score: **${score}** / 1.0  (${rec})`);
  lines.push("");
  lines.push(`**Current domain:** ${current}`);
  lines.push(`  Stage: ${curStage || "unknown"}`);
  lines.push(`  Open questions: ${dedupedCurQ.length}`);
  lines.push(`  Concepts: ${curConcepts.size}`);
  lines.push("");
  lines.push(`**Target domain:** ${target}`);
  lines.push(`  Stage: ${tgtStage || "unknown"}`);
  lines.push(`  Conversations: ${tgtConvs.results?.length || 0}`);
  lines.push(`  Thoughts: ${(tgtThoughts?.count as number) || 0}`);
  lines.push(`  Concepts: ${tgtConcepts.size}`);
  lines.push("");

  if (shared.size) {
    lines.push(`**Overlap:** ${shared.size} shared concepts`);
    lines.push(`  ${Array.from(shared).slice(0, 10).join(", ")}`);
    lines.push("");
  }

  lines.push("**Cost breakdown:**");
  lines.push(`  Abandonment (open Qs): ${(oqCost * 0.35).toFixed(3)}`);
  lines.push(`  Stage penalty (${curStage || "unknown"}): ${(stageCost * 0.35).toFixed(3)}`);
  lines.push(`  Overlap discount: -${(overlapDiscount * 0.3).toFixed(3)}`);
  lines.push("");

  if (dedupedCurQ.length) {
    lines.push("**Questions you'd leave behind:**");
    for (const q of dedupedCurQ.slice(0, 5)) lines.push(`  - ${q}`);
    if (dedupedCurQ.length > 5) lines.push(`  *... and ${dedupedCurQ.length - 5} more*`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_tunnel_history — Meta-view of engagement with a domain over time.
 */
export async function handleCortexTunnelHistory(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const domain = params.domain as string;
  if (!domain) return "Error: domain is required";

  const [convs, monthlyActivity, thoughtsByType, totalThoughts] = await Promise.all([
    env.DB.prepare(`
      SELECT thinking_stage, importance, emotional_tone, concepts, source, message_count
      FROM cortex_conversations WHERE domain = ? ORDER BY created_at DESC
    `).bind(domain).all(),
    env.DB.prepare(`
      SELECT substr(created_at, 1, 7) as month, COUNT(*) as count
      FROM cortex_conversations WHERE domain = ?
      GROUP BY month ORDER BY month
    `).bind(domain).all(),
    env.DB.prepare(`
      SELECT type, COUNT(*) as count FROM cortex_thoughts WHERE domain = ?
      GROUP BY type ORDER BY count DESC
    `).bind(domain).all(),
    env.DB.prepare(
      `SELECT COUNT(*) as count FROM cortex_thoughts WHERE domain = ?`
    ).bind(domain).first()
  ]);

  if (!convs.results?.length && !(totalThoughts?.count as number)) {
    return `No data found for domain "${domain}".`;
  }

  const stageCounts = new Map<string, number>();
  const importanceCounts = new Map<string, number>();
  const toneCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const conceptFreq = new Map<string, number>();
  let totalMsgs = 0;

  for (const c of convs.results || []) {
    if (c.thinking_stage) stageCounts.set(c.thinking_stage as string, (stageCounts.get(c.thinking_stage as string) || 0) + 1);
    if (c.importance) importanceCounts.set(c.importance as string, (importanceCounts.get(c.importance as string) || 0) + 1);
    if (c.emotional_tone) toneCounts.set(c.emotional_tone as string, (toneCounts.get(c.emotional_tone as string) || 0) + 1);
    if (c.source) sourceCounts.set(c.source as string, (sourceCounts.get(c.source as string) || 0) + 1);
    totalMsgs += (c.message_count as number) || 0;
    for (const concept of parseJsonField(c.concepts)) {
      const key = concept.toLowerCase();
      conceptFreq.set(key, (conceptFreq.get(key) || 0) + 1);
    }
  }

  const lines: string[] = [];
  lines.push(`## Tunnel History: ${domain}`);
  lines.push("");

  const bt = importanceCounts.get("breakthrough") || 0;
  const sig = importanceCounts.get("significant") || 0;
  lines.push(`**Conversations:** ${convs.results?.length || 0} | **Thoughts:** ${totalThoughts?.count || 0} | **Messages:** ${totalMsgs}`);
  lines.push(`**Importance:** ${bt} breakthrough, ${sig} significant, ${importanceCounts.get("routine") || 0} routine`);
  lines.push("");

  if (monthlyActivity.results?.length) {
    const maxCount = Math.max(...monthlyActivity.results.map(r => r.count as number));
    lines.push("### Timeline");
    for (const r of monthlyActivity.results) {
      const bar = "\u2588".repeat(Math.ceil(((r.count as number) / maxCount) * 15));
      lines.push(`  ${r.month}: ${(r.count as number).toString().padStart(3)} ${bar}`);
    }
    lines.push("");
  }

  if (stageCounts.size) {
    const total = Array.from(stageCounts.values()).reduce((s, v) => s + v, 0);
    lines.push("### Thinking Stages");
    for (const stage of ["exploring", "crystallizing", "refining", "executing"]) {
      const count = stageCounts.get(stage);
      if (count) {
        const pct = Math.round((count / total) * 100);
        const bar = "\u2588".repeat(Math.ceil((count / total) * 15));
        lines.push(`  ${stage}: ${count} (${pct}%) ${bar}`);
      }
    }
    lines.push("");
  }

  if (sourceCounts.size) {
    lines.push("### Sources");
    for (const [source, count] of sourceCounts) lines.push(`  ${source}: ${count}`);
    lines.push("");
  }

  if (toneCounts.size) {
    lines.push("### Emotional Tones");
    const sorted = Array.from(toneCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [tone, count] of sorted.slice(0, 10)) lines.push(`  ${tone}: ${count}`);
    lines.push("");
  }

  if (thoughtsByType.results?.length) {
    lines.push("### Thought Types");
    for (const r of thoughtsByType.results) lines.push(`  ${r.type}: ${r.count}`);
    lines.push("");
  }

  if (conceptFreq.size) {
    const sorted = Array.from(conceptFreq.entries()).sort((a, b) => b[1] - a[1]);
    lines.push(`### Top Concepts (${conceptFreq.size} total)`);
    for (const [concept, count] of sorted.slice(0, 15)) lines.push(`  ${concept}: ${count}`);
    lines.push("");
  }

  return lines.join("\n");
}
