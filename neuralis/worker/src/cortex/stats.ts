/**
 * Cortex: Stats + Analytics
 * Knowledge base overview and cognitive patterns.
 */

import type { Env } from "../types";

/**
 * cortex_stats — Overview of the cortex knowledge base.
 * Counts, domain distribution, recent activity, thinking stages.
 */
export async function handleCortexStats(
  env: Env
): Promise<string> {
  // Parallel queries for all stats
  const [
    thoughtCount,
    conversationCount,
    messageCount,
    thoughtsByType,
    thoughtsByDomain,
    conversationsByDomain,
    conversationsBySource,
    recentThoughts,
    thinkingStages,
    importanceBreakdown
  ] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as count FROM cortex_thoughts").first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM cortex_conversations").first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM cortex_messages").first(),
    env.DB.prepare(`
      SELECT type, COUNT(*) as count FROM cortex_thoughts
      GROUP BY type ORDER BY count DESC
    `).all(),
    env.DB.prepare(`
      SELECT domain, COUNT(*) as count FROM cortex_thoughts
      WHERE domain IS NOT NULL
      GROUP BY domain ORDER BY count DESC LIMIT 15
    `).all(),
    env.DB.prepare(`
      SELECT domain, COUNT(*) as count FROM cortex_conversations
      WHERE domain IS NOT NULL
      GROUP BY domain ORDER BY count DESC LIMIT 15
    `).all(),
    env.DB.prepare(`
      SELECT source, COUNT(*) as count FROM cortex_conversations
      GROUP BY source ORDER BY count DESC
    `).all(),
    env.DB.prepare(`
      SELECT type, domain, content, created_at FROM cortex_thoughts
      ORDER BY created_at DESC LIMIT 5
    `).all(),
    env.DB.prepare(`
      SELECT thinking_stage, COUNT(*) as count FROM cortex_conversations
      WHERE thinking_stage IS NOT NULL
      GROUP BY thinking_stage ORDER BY count DESC
    `).all(),
    env.DB.prepare(`
      SELECT importance, COUNT(*) as count FROM cortex_thoughts
      GROUP BY importance ORDER BY count DESC
    `).all()
  ]);

  const lines: string[] = [];
  lines.push("## CORTEX STATS");
  lines.push("");

  // Overview
  lines.push("### Overview");
  lines.push(`Thoughts: ${thoughtCount?.count || 0}`);
  lines.push(`Conversations: ${conversationCount?.count || 0}`);
  lines.push(`Messages archived: ${messageCount?.count || 0}`);
  lines.push("");

  // Thoughts by type
  if (thoughtsByType.results?.length) {
    lines.push("### Thought Types");
    for (const row of thoughtsByType.results) {
      lines.push(`  ${row.type}: ${row.count}`);
    }
    lines.push("");
  }

  // Importance breakdown
  if (importanceBreakdown.results?.length) {
    lines.push("### Importance");
    for (const row of importanceBreakdown.results) {
      lines.push(`  ${row.importance}: ${row.count}`);
    }
    lines.push("");
  }

  // Thought domains
  if (thoughtsByDomain.results?.length) {
    lines.push("### Thought Domains");
    for (const row of thoughtsByDomain.results) {
      lines.push(`  ${row.domain}: ${row.count}`);
    }
    lines.push("");
  }

  // Conversation domains
  if (conversationsByDomain.results?.length) {
    lines.push("### Conversation Domains");
    for (const row of conversationsByDomain.results) {
      lines.push(`  ${row.domain}: ${row.count}`);
    }
    lines.push("");
  }

  // Conversation sources
  if (conversationsBySource.results?.length) {
    lines.push("### Conversation Sources");
    for (const row of conversationsBySource.results) {
      lines.push(`  ${row.source}: ${row.count}`);
    }
    lines.push("");
  }

  // Thinking stages
  if (thinkingStages.results?.length) {
    lines.push("### Thinking Stages");
    for (const row of thinkingStages.results) {
      lines.push(`  ${row.thinking_stage}: ${row.count}`);
    }
    lines.push("");
  }

  // Recent activity
  if (recentThoughts.results?.length) {
    lines.push("### Recent Thoughts");
    for (const row of recentThoughts.results) {
      const date = (row.created_at as string)?.slice(0, 10) || "";
      const domainStr = row.domain ? ` [${row.domain}]` : "";
      const preview = (row.content as string).slice(0, 80);
      lines.push(`  ${date} ${row.type}${domainStr}: ${preview}...`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * cortex_cognitive_patterns — When and how thinking happens best.
 * Temporal analysis of conversation activity, domain focus, and thinking patterns.
 */
export async function handleCortexCognitivePatterns(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const domain = (params.domain as string) || null;

  // Build queries based on domain filter
  const domainFilter = domain ? "WHERE domain = ?" : "";
  const binds: unknown[] = domain ? [domain] : [];

  const [
    monthlyActivity,
    stageDistribution,
    importanceByDomain,
    convsBySource
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT substr(created_at, 1, 7) as month, COUNT(*) as count
      FROM cortex_conversations ${domainFilter}
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).bind(...binds).all(),
    env.DB.prepare(`
      SELECT thinking_stage, COUNT(*) as count, importance
      FROM cortex_conversations
      ${domainFilter ? domainFilter + " AND" : "WHERE"} thinking_stage IS NOT NULL
      GROUP BY thinking_stage, importance ORDER BY count DESC
    `).bind(...binds).all(),
    env.DB.prepare(`
      SELECT domain, COUNT(*) as count,
             SUM(CASE WHEN importance = 'breakthrough' THEN 1 ELSE 0 END) as breakthroughs
      FROM cortex_conversations
      WHERE domain IS NOT NULL
      GROUP BY domain ORDER BY count DESC LIMIT 10
    `).all(),
    env.DB.prepare(`
      SELECT source, COUNT(*) as count FROM cortex_conversations ${domainFilter}
      GROUP BY source ORDER BY count DESC
    `).bind(...binds).all()
  ]);

  const lines: string[] = [];
  lines.push(`## Cognitive Patterns${domain ? ` (${domain})` : ""}`);
  lines.push("");

  // Monthly activity
  if (monthlyActivity.results?.length) {
    const maxCount = Math.max(...monthlyActivity.results.map(r => r.count as number));
    lines.push("### Monthly Activity");
    for (const r of monthlyActivity.results) {
      const bar = "\u2588".repeat(Math.ceil(((r.count as number) / maxCount) * 15));
      lines.push(`  ${r.month}: ${(r.count as number).toString().padStart(3)} ${bar}`);
    }
    lines.push("");
  }

  // Thinking stages
  if (stageDistribution.results?.length) {
    const stageAgg = new Map<string, { total: number; breakthroughs: number }>();
    for (const r of stageDistribution.results) {
      const stage = r.thinking_stage as string;
      const existing = stageAgg.get(stage) || { total: 0, breakthroughs: 0 };
      existing.total += r.count as number;
      if (r.importance === "breakthrough") existing.breakthroughs += r.count as number;
      stageAgg.set(stage, existing);
    }

    lines.push("### Thinking Stages");
    for (const [stage, data] of stageAgg) {
      const btStr = data.breakthroughs > 0 ? ` (💎×${data.breakthroughs})` : "";
      lines.push(`  ${stage}: ${data.total}${btStr}`);
    }
    lines.push("");
  }

  // Domain focus (only show if not filtering by domain)
  if (!domain && importanceByDomain.results?.length) {
    lines.push("### Domain Focus");
    for (const r of importanceByDomain.results) {
      const btStr = (r.breakthroughs as number) > 0 ? ` (💎×${r.breakthroughs})` : "";
      lines.push(`  ${r.domain}: ${r.count}${btStr}`);
    }
    lines.push("");
  }

  // Source distribution
  if (convsBySource.results?.length) {
    lines.push("### Sources");
    for (const r of convsBySource.results) {
      lines.push(`  ${r.source}: ${r.count}`);
    }
    lines.push("");
  }

  if (!monthlyActivity.results?.length) {
    lines.push("*No conversation data yet. Use cortex_save_conversation to start tracking.*");
  }

  return lines.join("\n");
}

/**
 * cortex_what_was_i_thinking — Time-travel snapshot for a specific month.
 * What was on your mind during YYYY-MM?
 */
export async function handleCortexWhatWasIThinking(
  env: Env,
  params: Record<string, unknown>
): Promise<string> {
  const month = params.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return "Error: month is required in YYYY-MM format";
  }

  const monthStart = `${month}-01`;
  const [year, mon] = month.split("-").map(Number);
  const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;

  const [
    convStats,
    thoughtStats,
    topConversations,
    topThoughts,
    domainBreakdown,
    sourceBreakdown,
    avgMonthly
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) as count,
             SUM(message_count) as total_msgs
      FROM cortex_conversations
      WHERE created_at >= ? AND created_at < ?
    `).bind(monthStart, nextMonth).first(),
    env.DB.prepare(`
      SELECT COUNT(*) as count,
             SUM(CASE WHEN type = 'question' THEN 1 ELSE 0 END) as questions,
             SUM(CASE WHEN type = 'decision' THEN 1 ELSE 0 END) as decisions,
             SUM(CASE WHEN importance = 'breakthrough' THEN 1 ELSE 0 END) as breakthroughs
      FROM cortex_thoughts
      WHERE created_at >= ? AND created_at < ?
    `).bind(monthStart, nextMonth).first(),
    env.DB.prepare(`
      SELECT title, domain, importance, thinking_stage, message_count, created_at
      FROM cortex_conversations
      WHERE created_at >= ? AND created_at < ?
      ORDER BY CASE importance WHEN 'breakthrough' THEN 0 WHEN 'significant' THEN 1 ELSE 2 END, message_count DESC
      LIMIT 10
    `).bind(monthStart, nextMonth).all(),
    env.DB.prepare(`
      SELECT type, domain, content, importance, created_at
      FROM cortex_thoughts
      WHERE created_at >= ? AND created_at < ?
      ORDER BY CASE importance WHEN 'breakthrough' THEN 0 WHEN 'significant' THEN 1 ELSE 2 END, created_at DESC
      LIMIT 10
    `).bind(monthStart, nextMonth).all(),
    env.DB.prepare(`
      SELECT domain, COUNT(*) as count
      FROM cortex_conversations
      WHERE created_at >= ? AND created_at < ? AND domain IS NOT NULL
      GROUP BY domain ORDER BY count DESC LIMIT 10
    `).bind(monthStart, nextMonth).all(),
    env.DB.prepare(`
      SELECT source, COUNT(*) as count
      FROM cortex_conversations
      WHERE created_at >= ? AND created_at < ?
      GROUP BY source ORDER BY count DESC
    `).bind(monthStart, nextMonth).all(),
    env.DB.prepare(`
      SELECT AVG(monthly_count) as avg FROM (
        SELECT COUNT(*) as monthly_count FROM cortex_conversations
        GROUP BY substr(created_at, 1, 7)
      )
    `).first()
  ]);

  const convCount = (convStats?.count as number) || 0;
  const totalMsgs = (convStats?.total_msgs as number) || 0;
  const thoughtCount = (thoughtStats?.count as number) || 0;
  const questionCount = (thoughtStats?.questions as number) || 0;
  const decisionCount = (thoughtStats?.decisions as number) || 0;
  const btCount = (thoughtStats?.breakthroughs as number) || 0;
  const avgCount = (avgMonthly?.avg as number) || 1;

  // Activity level
  const activityRatio = convCount / Math.max(avgCount, 1);
  const activityLevel = activityRatio > 1.5 ? "HIGH" : activityRatio > 0.5 ? "NORMAL" : "LOW";

  const lines: string[] = [];
  lines.push(`## What Was I Thinking: ${month}`);
  lines.push("");

  lines.push(`### Activity Level: ${activityLevel}`);
  lines.push(`- **${convCount}** conversations (${Math.round(activityRatio * 100)}% of average)`);
  lines.push(`- **${totalMsgs}** total messages`);
  lines.push(`- **${thoughtCount}** thoughts recorded`);
  lines.push(`- **${questionCount}** questions asked`);
  lines.push(`- **${decisionCount}** decisions made`);
  if (btCount) lines.push(`- **${btCount}** breakthroughs`);
  lines.push("");

  if (sourceBreakdown.results?.length) {
    lines.push("### Sources");
    for (const r of sourceBreakdown.results) {
      lines.push(`  ${r.source}: ${r.count}`);
    }
    lines.push("");
  }

  if (domainBreakdown.results?.length) {
    lines.push("### Domains");
    for (const r of domainBreakdown.results) {
      lines.push(`  ${r.domain}: ${r.count}`);
    }
    lines.push("");
  }

  if (topConversations.results?.length) {
    lines.push("### Top Conversations");
    for (const c of topConversations.results) {
      const icon = c.importance === "breakthrough" ? "💎" : c.importance === "significant" ? "⭐" : "📝";
      const domainStr = c.domain ? ` [${c.domain}]` : "";
      const msgs = c.message_count ? ` (${c.message_count} msgs)` : "";
      lines.push(`  ${icon} ${c.title || "Untitled"}${domainStr}${msgs}`);
    }
    lines.push("");
  }

  if (topThoughts.results?.length) {
    lines.push("### Notable Thoughts");
    for (const t of topThoughts.results) {
      const icon = t.importance === "breakthrough" ? "💎" : t.importance === "significant" ? "⭐" : "";
      const preview = (t.content as string).slice(0, 100);
      lines.push(`  ${icon} [${t.type}] ${preview}${(t.content as string).length > 100 ? "..." : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
