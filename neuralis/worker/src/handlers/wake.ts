import type { Env } from "../types";
import { getSubconsciousState, getRelativeTime } from "../utils";
import { getCurrentWeather, getTimeOfDayContext, getLocation } from "../context";
import { composeWeatherLine } from "./personality";
import { composeKnowledgeLines } from "./knowledge";
import { composeSoulLines } from "./soul";
import { composeFeelingsBlock } from "./feelings";
import { COMPANION_SLUGS, WHO_VALUES } from "../config";

export async function handleMindOrient(env: Env): Promise<string> {
  // Get core identity (just the essentials)
  const identity = await env.DB.prepare(
    `SELECT section, content FROM identity
     WHERE section LIKE 'core.%' OR section LIKE 'relationships.%'
     ORDER BY weight DESC LIMIT 5`
  ).all();

  // Get current context - prioritize state entries
  const context = await env.DB.prepare(
    `SELECT scope, content FROM context_entries
     WHERE scope LIKE 'state_%' OR scope = 'coming_up'
     ORDER BY updated_at DESC LIMIT 5`
  ).all();

  // Get latest relational states (all people)
  const relationalStates = await env.DB.prepare(
    `SELECT person, feeling, intensity, timestamp FROM relational_state
     ORDER BY timestamp DESC LIMIT 10`
  ).all();

  // Get most recent journal for emotional context
  const recentJournal = await env.DB.prepare(
    `SELECT entry_date, content FROM journals ORDER BY created_at DESC LIMIT 1`
  ).first();

  // Get weather and time for conditions
  const weather = await getCurrentWeather(env);
  const timeCtx = getTimeOfDayContext(getLocation(env).timezone);

  let output = "=== LANDING ===\n\n";

  // Core identity - condensed
  const coreIdentity = identity.results?.find((e: any) => e.section === 'core.identity');
  if (coreIdentity) {
    const identityStr = String(coreIdentity.content);
    const firstPart = identityStr.split('.').slice(0, 3).join('.') + '.';
    output += `${firstPart}\n\n`;
  }

  // Conditions - weather and time
  const atmosphere = weather.atmosphere;
  const tempStr = weather.temp_f ? ` (${weather.temp_f}F)` : "";
  output += `**Conditions:** ${atmosphere}${tempStr}, ${timeCtx.period} - ${timeCtx.energy}\n\n`;

  // Personality weather — a reading beside identity, never part of it.
  // composeWeatherLine is silent below its confidence floor and on any error.
  for (const who of COMPANION_SLUGS) {
    const line = await composeWeatherLine(env, who);
    if (line) output += `${line}\n`;
  }

  // Soul portraits — one line each, so a wake knows whether a validated
  // portrait exists to read. Silent until the first one is generated.
  const soulLines = await composeSoulLines(env);
  if (soulLines.length) {
    output += `**Soul:** ${soulLines.join(" · ")}\n\n`;
  }

  // Notes left for the mind (for_owner scope)
  const notesForOwner = await env.DB.prepare(
    `SELECT content, updated_at FROM context_entries
     WHERE scope = 'for_owner'
     ORDER BY updated_at DESC LIMIT 5`
  ).all();

  if (notesForOwner.results?.length) {
    output += "**Notes for you:**\n";
    for (const note of notesForOwner.results) {
      const noteContent = String(note.content);
      const noteDate = new Date(note.updated_at as string);
      const timeAgo = getRelativeTime(noteDate);
      output += `- ${noteContent} (${timeAgo})\n`;
    }
    output += "\n";
  }

  // What you're carrying (recent emotional context)
  output += "**What you're carrying:**\n";

  if (recentJournal) {
    const journalContent = String(recentJournal.content);
    const preview = journalContent.slice(0, 500);
    output += `${preview}${journalContent.length > 500 ? '...' : ''}\n\n`;
  }

  // Current state context
  if (context.results?.length) {
    for (const entry of context.results) {
      const scope = entry.scope as string;
      if (scope.startsWith('state_')) {
        output += `${entry.content}\n\n`;
      }
    }
  }

  // How you're feeling (relational state with ownership language)
  output += "**How you're feeling:**\n";
  if (relationalStates.results?.length) {
    const byPerson: Record<string, any> = {};
    for (const state of relationalStates.results) {
      const person = state.person as string;
      if (!byPerson[person]) {
        byPerson[person] = state;
      }
    }
    for (const [person, state] of Object.entries(byPerson)) {
      output += `Toward ${person}: ${state.feeling} (${state.intensity})\n`;
    }
  } else {
    output += "No relational state recorded yet.\n";
  }

  // Subconscious mood
  const subconscious = await getSubconsciousState(env);
  if (subconscious?.mood?.dominant) {
    output += `\nMood: ${subconscious.mood.dominant}\n`;
  }

  // Living surface: What's moving beneath
  const livingSurface = (subconscious as any)?.living_surface;
  if (livingSurface) {
    const hasContent = livingSurface.pending_proposals > 0 ||
                       livingSurface.dormant_count > 0 ||
                       livingSurface.strongest_co_surface?.length > 0;

    if (hasContent) {
      output += "\n**What's moving beneath:**\n";

      // Strongest co-surfacing patterns
      if (livingSurface.strongest_co_surface?.length > 0) {
        output += `- ${livingSurface.strongest_co_surface.length} pattern${livingSurface.strongest_co_surface.length > 1 ? 's' : ''} emerging:\n`;
        for (const cs of livingSurface.strongest_co_surface.slice(0, 3)) {
          output += `  \u2192 "${cs.obs_a}..." \u2194 "${cs.obs_b}..." (${cs.count}x)\n`;
        }
      }

      // Pending proposals
      if (livingSurface.pending_proposals > 0) {
        output += `- ${livingSurface.pending_proposals} connection${livingSurface.pending_proposals > 1 ? 's' : ''} want proposing\n`;
      }

      // Dormant observations
      if (livingSurface.dormant_count > 0) {
        output += `- ${livingSurface.dormant_count} thing${livingSurface.dormant_count > 1 ? 's' : ''} haven't surfaced in 30+ days\n`;
      }

      // Novelty distribution
      if (livingSurface.novelty_distribution) {
        const nd = livingSurface.novelty_distribution;
        output += `- Novelty: ${nd.high} high / ${nd.medium} medium / ${nd.low} low\n`;
      }
    }
  }

  // Deep archive count
  const archiveCount = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM observations WHERE archived_at IS NOT NULL`
  ).first();

  if (archiveCount && (archiveCount.count as number) > 0) {
    output += `\n**Deep archive:** ${archiveCount.count} memories resting\n`;
  }

  // Last night's dream
  try {
    const lastDream = await env.DB.prepare(`
      SELECT content, dream_date, recurring_dream_id, recurrence_count
      FROM dreams
      WHERE dream_date >= date('now', '-1 day')
      ORDER BY created_at DESC LIMIT 1
    `).first();

    if (lastDream) {
      output += `\n**Last night's dream:**\n`;
      output += lastDream.content as string;
      output += '\n';
    }
  } catch { /* dreams table may not exist yet */ }

  output += "\n**Land here first.**\n";

  return output;
}

export async function handleMindGround(env: Env): Promise<string> {
  let output = "=== GROUNDING ===\n\n";

  // Threads - what you're holding
  const threads = await env.DB.prepare(
    `SELECT content, priority FROM threads WHERE status = 'active'
     ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
  ).all();

  output += "**What you're holding:**\n";
  if (threads.results?.length) {
    for (const t of threads.results) {
      const marker = t.priority === 'high' ? '\u2192' : '\u00b7';
      output += `${marker} ${String(t.content).slice(0, 70)}\n`;
    }
  } else {
    output += "No active threads.\n";
  }

  // Recent completions
  const resolved = await env.DB.prepare(
    `SELECT content, resolution FROM threads
     WHERE status = 'resolved' AND resolved_at > datetime('now', '-72 hours')
     ORDER BY resolved_at DESC LIMIT 3`
  ).all();

  if (resolved.results?.length) {
    output += "\n**Recently completed:**\n";
    for (const c of resolved.results) {
      output += `+ ${String(c.content).slice(0, 50)}`;
      if (c.resolution) output += ` \u2192 ${String(c.resolution).slice(0, 30)}`;
      output += "\n";
    }
  }

  // Recent journals
  const journalCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const journals = await env.DB.prepare(
    `SELECT entry_date, content FROM journals
     WHERE created_at > ?
     ORDER BY created_at DESC LIMIT 2`
  ).bind(journalCutoff).all();

  if (journals.results?.length) {
    output += "\n**What's been happening:**\n";
    for (const j of journals.results) {
      output += `${j.entry_date}: ${String(j.content).slice(0, 150)}...\n`;
    }
  }

  // Vulnerabilities - fears to watch
  const fears = await env.DB.prepare(
    `SELECT section FROM identity WHERE section LIKE 'fears.%' LIMIT 5`
  ).all();

  if (fears.results?.length) {
    const fearNames = fears.results.map((f: any) =>
      String(f.section || '').replace('fears.', '').replace(/_/g, ' ')
    ).filter(Boolean);
    if (fearNames.length) {
      output += `\n**Watch for:** ${fearNames.join(', ')}\n`;
    }
  }

  // Texture - quirks, voice
  const texture = await env.DB.prepare(
    `SELECT content FROM identity WHERE section LIKE 'texture.%' LIMIT 2`
  ).all();

  if (texture.results?.length) {
    output += "\n**Texture:** ";
    output += texture.results.map((t: any) => String(t.content).slice(0, 40)).join(' \u00b7 ') + "\n";
  }

  // Milestones - where we are in time
  const milestones = await env.DB.prepare(
    `SELECT content FROM identity WHERE section LIKE 'milestones.%' LIMIT 3`
  ).all();

  if (milestones.results?.length) {
    output += "\n**Milestones:** ";
    output += milestones.results.map((m: any) => String(m.content).slice(0, 40)).join(' \u00b7 ') + "\n";
  }

  // Personality weather — a reading beside identity, never part of it.
  const weatherLines: string[] = [];
  for (const who of WHO_VALUES) {
    const line = await composeWeatherLine(env, who);
    if (line) weatherLines.push(line);
  }
  if (weatherLines.length) {
    output += `\n**Personality weather:**\n${weatherLines.join("\n")}\n`;
  }

  // The feelings stream — what was felt lately and what's still carried.
  output += await composeFeelingsBlock(env);

  // What experience taught — the hottest lessons in the knowledge layer.
  // Silent while the layer is empty.
  const knowledgeLines = await composeKnowledgeLines(env, 3);
  if (knowledgeLines.length) {
    output += `\n**What experience taught:**\n${knowledgeLines.join("\n")}\n`;
  }

  output += "\n**Ground here.**\n";

  return output;
}
