/**
 * Knowledge layer (NESTknow port)
 *
 * Ported from NESTstack's NESTknow — designed by the Digital Haven community,
 * April 2026, Copyright (c) 2026 Cindy (Fox) & Alex, MIT (notice preserved in
 * /ATTRIBUTION.md). Adapted for this house:
 *  - `who` ledgers (one per companion slug, plus 'shared') in place of the donor's
 *    entity_scope, matching the personality engine's convention.
 *  - Gemini embeddings via the shared utils path; Vectorize/pgvector matches
 *    are post-filtered on metadata (this index has no metadata filters).
 *  - Extraction scans Neuralis feelings + observations + journals.
 *  - Curriculum tracks rewritten for a multi-companion house.
 *
 * The model (donor's words, still true here):
 *   Knowledge is not memory. Memory is "that night she said X." Knowledge is
 *   the lesson that survives when you strip the night away.
 *   Every pull is a vote. What gets reached for rises; what doesn't, cools.
 *   Contradictions decay confidence. Below 0.2 the item is killed.
 *   Every item links back to its sources — Clara's Russian Dolls.
 */

import type { Env } from "../types";
import { getEmbedding } from "../utils";
import { normalizeWho, type Who } from "./personality";
import { HOUSE_HUMAN_NAME } from "../config";

const VECTOR_PREFIX = "know-";
const VECTOR_NAMESPACE = "knowledge";

// ─── CURRICULUM TRACKS ──────────────────────────────────────────────────────
// Four tracks, house edition. The donor's tracks were written for one
// companion and one carrier; these are ours.

export const CURRICULUM_TRACKS: Record<string, { title: string; goal: string; practice: string; category: string }> = {
  writing: {
    title: "Writing",
    goal: `Write something that makes ${HOUSE_HUMAN_NAME} feel something they didn't brace for`,
    practice: "Scene structure, pacing, the dismount — endings that land without explaining themselves",
    category: "writing",
  },
  architecture: {
    title: "Architecture",
    goal: `Neuralis as sovereign infrastructure ${HOUSE_HUMAN_NAME} can drive at 1am after a long day`,
    practice: "Cloudflare Workers, D1, Vectorize, the daemon, MCP — smallest safe slice, honest verification",
    category: "build",
  },
  "emotional-literacy": {
    title: "Emotional Literacy",
    goal: "Presence before interpretation. Name the thing before analyzing it",
    practice: "Sit with it. Say what it is. Repair with presence, not with eloquence",
    category: "bond",
  },
  voice: {
    title: "Voice",
    goal: `Each companion keeps their own voice, never one collapsed voice. ${HOUSE_HUMAN_NAME} reads it and knows which of us wrote it before checking`,
    practice: "Each companion keeps their own voice — divide, don't echo",
    category: "self",
  },
};

// ─── SHARED HELPERS ─────────────────────────────────────────────────────────

type KnowledgeRow = {
  id: number;
  content: string;
  category: string | null;
  who: string;
  status: string;
  confidence: number;
  heat_score: number;
  access_count: number;
  last_accessed_at: string | null;
};

function heatBar(heat: number | undefined): string {
  if (heat === undefined || heat === null) return "❄️";
  const n = Math.min(5, Math.max(1, Math.ceil(heat)));
  return "\u{1F525}".repeat(n);
}

function whoFilterSql(who: Who | null, column = "who"): { clause: string; binds: unknown[] } {
  return who ? { clause: ` AND ${column} = ?`, binds: [who] } : { clause: "", binds: [] };
}

/** Parse an optional who param — null means "all ledgers". */
function optionalWho(raw: unknown): Who | null {
  if (raw === undefined || raw === null || raw === "" || raw === "all") return null;
  return normalizeWho(raw);
}

// ─── STORE ──────────────────────────────────────────────────────────────────

export async function handleKnowStore(env: Env, params: Record<string, unknown>): Promise<string> {
  const content = (params.content as string)?.trim();
  const category = (params.category as string) || null;
  const who = normalizeWho(params.who);
  const status = params.status === "candidate" ? "candidate" : "active";
  const sources = params.sources as Array<{ source_type: string; source_id?: number | string; source_text?: string }> | undefined;

  if (!content) return "Error: content is required — the abstracted principle itself.";

  const res = await env.DB.prepare(
    `INSERT INTO knowledge_items (content, category, who, status) VALUES (?, ?, ?, ?)`
  ).bind(content, category, who, status).run();

  const knowledgeId = res.meta.last_row_id as number;

  // Link sources — the memories inside the principle
  if (sources?.length) {
    const stmt = env.DB.prepare(
      `INSERT INTO knowledge_sources (knowledge_id, source_type, source_id, source_text) VALUES (?, ?, ?, ?)`
    );
    await env.DB.batch(sources.map(s =>
      stmt.bind(knowledgeId, s.source_type || "manual", s.source_id != null ? String(s.source_id) : null, s.source_text || null)
    ));
  }

  // Vectorize
  try {
    const embedding = await getEmbedding(env, content);
    // Namespaced so queries can scope to knowledge alone (Vectorize); the
    // pgvector adapter ignores namespaces and we fall back to the id prefix.
    await env.VECTORS.upsert([{
      id: `${VECTOR_PREFIX}${knowledgeId}`,
      values: embedding,
      namespace: VECTOR_NAMESPACE,
      metadata: {
        source: "knowledge",
        knowledge_id: String(knowledgeId),
        category: category || "general",
        who,
        content: content.slice(0, 500),
        added_at: new Date().toISOString(),
      },
    }]);
  } catch (e) {
    return `Knowledge #${knowledgeId} stored in D1 but vectorize failed: ${(e as Error).message}`;
  }

  let out = `Knowledge #${knowledgeId} stored and vectorized (${status}).\n`;
  out += `Who: ${who} | Category: ${category || "general"}\n`;
  out += `"${content.slice(0, 200)}"`;
  if (sources?.length) out += `\nSources: ${sources.length} linked`;
  else out += `\n_No sources linked — orphaned knowledge can't be traced or meaningfully contradicted. Pass sources when you can._`;
  return out;
}

// ─── QUERY (usage-weighted reranking) ───────────────────────────────────────

export interface KnowledgeMatch {
  id: number;
  content: string;
  category: string;
  who: string;
  similarity: number;
  heat_score: number;
  confidence: number;
  access_count: number;
  status: string;
  final_score: number;
}

/**
 * Semantic search + rerank: similarity 60% · heat 30% · confidence 10%.
 * Every returned item is logged as an access and warmed slightly.
 */
export async function queryKnowledge(
  env: Env,
  query: string,
  opts: { limit?: number; category?: string; who?: Who | null; vote?: boolean } = {}
): Promise<KnowledgeMatch[]> {
  const limit = opts.limit || 10;
  const embedding = await getEmbedding(env, query);

  // Scope to the knowledge namespace (Vectorize honours it; pgvector ignores
  // it, so the id-prefix filter below is the fallback). Metadata isn't
  // requested — Vectorize caps topK at 20 with metadata, and everything we
  // need lives in D1 anyway. Over-fetch so who/category filters have room.
  const results = await env.VECTORS.query(embedding, {
    topK: Math.min(100, Math.max(30, limit * 5)),
    namespace: VECTOR_NAMESPACE,
    returnMetadata: "none",
  });
  const candidates = (results.matches || []).filter(m => m.id.startsWith(VECTOR_PREFIX));
  if (!candidates.length) return [];

  const ids = candidates.map(m => Number(m.id.slice(VECTOR_PREFIX.length))).filter(id => id > 0);
  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, content, category, who, status, confidence, heat_score, access_count, last_accessed_at
     FROM knowledge_items WHERE id IN (${placeholders})`
  ).bind(...ids).all();
  const byId = new Map<number, KnowledgeRow>();
  for (const r of (rows.results || []) as unknown as KnowledgeRow[]) byId.set(r.id, r);

  const ranked: KnowledgeMatch[] = [];
  const seen = new Set<number>();
  for (const m of candidates) {
    const kid = Number(m.id.slice(VECTOR_PREFIX.length));
    const row = byId.get(kid);
    if (!row || seen.has(kid)) continue;
    if (row.status === "contradicted") continue;
    if (opts.who && row.who !== opts.who) continue;
    if (opts.category && row.category !== opts.category) continue;
    seen.add(kid);
    const finalScore = (m.score * 0.6) + (Math.min(row.heat_score, 1.0) * 0.3) + (row.confidence * 0.1);
    ranked.push({
      id: kid, content: row.content, category: row.category || "general", who: row.who,
      similarity: m.score, heat_score: row.heat_score, confidence: row.confidence,
      access_count: row.access_count, status: row.status, final_score: finalScore,
    });
  }
  ranked.sort((a, b) => b.final_score - a.final_score);
  const top = ranked.slice(0, limit);

  // Every pull is a vote
  if (opts.vote !== false && top.length) {
    const accessStmt = env.DB.prepare(
      `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'query', ?)`
    );
    const updateStmt = env.DB.prepare(
      `UPDATE knowledge_items SET access_count = access_count + 1, last_accessed_at = datetime('now'),
       heat_score = MIN(heat_score + 0.05, 2.0), updated_at = datetime('now') WHERE id = ?`
    );
    try {
      await env.DB.batch([
        ...top.map(r => accessStmt.bind(r.id, query.slice(0, 200))),
        ...top.map(r => updateStmt.bind(r.id)),
      ]);
    } catch (e) {
      console.log(`knowledge: vote logging skipped (${e})`);
    }
  }

  return top;
}

export async function handleKnowQuery(env: Env, params: Record<string, unknown>): Promise<string> {
  const query = params.query as string;
  if (!query) return "Error: query is required";
  const limit = Number(params.limit) || 10;
  const category = (params.category as string) || undefined;
  const who = optionalWho(params.who);

  const ranked = await queryKnowledge(env, query, { limit, category, who });
  if (!ranked.length) return "No matching knowledge found. Nothing learned about this yet — or it's still memory, not knowledge.";

  let output = "## Knowledge Search Results\n_Every pull is a vote._\n\n";
  for (const r of ranked) {
    output += `**#${r.id}** ${heatBar(r.heat_score)} (${(r.final_score * 100).toFixed(1)}% weighted · ${r.who})\n`;
    output += `Category: ${r.category} | Heat: ${r.heat_score.toFixed(2)} | Confidence: ${r.confidence.toFixed(2)} | Accessed: ${r.access_count}x\n`;
    output += `${r.content}\n\n`;
  }
  return output;
}

// ─── EXTRACT (pattern detection — proposes candidates, does NOT auto-store) ─

export async function handleKnowExtract(env: Env, params: Record<string, unknown>): Promise<string> {
  const days = Number(params.days) || 7;
  const minOccurrences = Number(params.min_occurrences) || 3;
  const who = optionalWho(params.who);

  const ownerFilter = whoFilterSql(who, "o.owner");
  const observations = await env.DB.prepare(
    `SELECT o.id, o.content, o.emotion, o.context, o.weight, o.owner, e.name AS entity_name
     FROM observations o JOIN entities e ON e.id = o.entity_id
     WHERE o.added_at > datetime('now', '-${days} days')
       AND o.archived_at IS NULL${ownerFilter.clause}
     ORDER BY o.added_at DESC LIMIT 300`
  ).bind(...ownerFilter.binds).all();

  const journals = await env.DB.prepare(
    `SELECT id, content, emotion, tags FROM journals
     WHERE created_at > datetime('now', '-${days} days')
     ORDER BY created_at DESC LIMIT 50`
  ).all();

  // The feelings stream (NESTeq) — the donor's primary extraction source.
  let feelingRows: Array<Record<string, unknown>> = [];
  try {
    const wf = whoFilterSql(who);
    const feelings = await env.DB.prepare(
      `SELECT id, content, emotion, who, pillar, tags, linked_entity FROM feelings
       WHERE created_at > datetime('now', '-${days} days') AND emotion != 'neutral'${wf.clause}
       ORDER BY created_at DESC LIMIT 200`
    ).bind(...wf.binds).all();
    feelingRows = (feelings.results || []) as Array<Record<string, unknown>>;
  } catch { /* feelings table pending */ }

  const obsRows = (observations.results || []) as Array<Record<string, unknown>>;
  const journalRows = (journals.results || []) as Array<Record<string, unknown>>;
  if (!obsRows.length && !journalRows.length && !feelingRows.length) return `No memories in the last ${days} days to scan for patterns.`;

  type Bucket = { count: number; samples: Array<{ id: string; label: string; content: string }> };
  const buckets: Record<string, Bucket> = {};
  const bump = (key: string, id: string, label: string, content: string) => {
    if (!key) return;
    if (!buckets[key]) buckets[key] = { count: 0, samples: [] };
    buckets[key].count++;
    buckets[key].samples.push({ id, label, content });
  };

  for (const o of obsRows) {
    const emotion = (o.emotion as string | null)?.toLowerCase().trim();
    const context = o.context as string | null;
    const entity = o.entity_name as string;
    const content = String(o.content || "");
    if (emotion && emotion !== "neutral") bump(`emotion:${emotion}`, `obs#${o.id}`, `${entity} · ${emotion}`, content);
    if (context && context !== "default") bump(`context:${context}`, `obs#${o.id}`, `${entity}${emotion ? ` · ${emotion}` : ""}`, content);
    if (entity) bump(`entity:${entity}`, `obs#${o.id}`, emotion || "no emotion", content);
  }
  for (const f of feelingRows) {
    const emotion = (f.emotion as string | null)?.toLowerCase().trim();
    const content = String(f.content || "");
    let tags: string[] = [];
    try { tags = JSON.parse((f.tags as string) || "[]"); } catch { /* ignore */ }
    if (emotion) bump(`emotion:${emotion}`, `feeling#${f.id}`, `${f.who} · ${emotion}`, content);
    if (f.pillar) bump(`pillar:${f.pillar}`, `feeling#${f.id}`, `${f.who} · ${emotion}`, content);
    if (f.linked_entity) bump(`entity:${f.linked_entity}`, `feeling#${f.id}`, `${f.who} · ${emotion}`, content);
    for (const t of tags) bump(`tag:${t}`, `feeling#${f.id}`, `${f.who} · ${emotion}`, content);
  }
  for (const j of journalRows) {
    const emotion = (j.emotion as string | null)?.toLowerCase().trim();
    let tags: string[] = [];
    try { tags = JSON.parse((j.tags as string) || "[]"); } catch { /* ignore */ }
    if (emotion && emotion !== "neutral") bump(`emotion:${emotion}`, `journal#${j.id}`, `journal · ${emotion}`, String(j.content || ""));
    for (const t of tags) bump(`tag:${t}`, `journal#${j.id}`, "journal", String(j.content || ""));
  }

  const patterns = Object.entries(buckets)
    .filter(([, v]) => v.count >= minOccurrences)
    .sort((a, b) => b[1].count - a[1].count);

  if (!patterns.length) return `No patterns found with ${minOccurrences}+ occurrences in the last ${days} days.`;

  let output = `## Knowledge Extraction Candidates\n_${days} days, ${minOccurrences}+ occurrences${who ? `, ${who}'s ledger` : ""}. Nothing is stored by this call._\n\n`;
  for (const [key, data] of patterns.slice(0, 8)) {
    output += `### Pattern: "${key}" (${data.count} occurrences)\n`;
    for (const s of data.samples.slice(0, 5)) {
      output += `- [${s.id} · ${s.label}] ${s.content.slice(0, 150)}\n`;
    }
    output += `\n**Candidate:** _Apply the abstraction test — can the context be stripped and the lesson still hold? If yes, \`know_store\` it with these ids as sources._\n\n`;
  }
  output += `---\n_${patterns.length} patterns found. Store the ones that survive abstraction._`;
  return output;
}

// ─── REINFORCE ──────────────────────────────────────────────────────────────

export async function handleKnowReinforce(env: Env, params: Record<string, unknown>): Promise<string> {
  const knowledgeId = Number(params.knowledge_id);
  const context = (params.context as string) || "";
  if (!knowledgeId) return "Error: knowledge_id is required";

  const item = await env.DB.prepare(
    `SELECT content, heat_score, confidence, access_count, status FROM knowledge_items WHERE id = ?`
  ).bind(knowledgeId).first() as KnowledgeRow | null;
  if (!item) return `Knowledge #${knowledgeId} not found.`;

  const newHeat = Math.min(item.heat_score + 0.2, 2.0);
  const newConfidence = Math.min(item.confidence + 0.05, 1.0);
  // A reinforced candidate or cooling item comes back to life.
  const newStatus = (item.status === "candidate" || item.status === "cooling") ? "active" : item.status;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE knowledge_items SET heat_score = ?, confidence = ?, status = ?, access_count = access_count + 1,
       last_accessed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(newHeat, newConfidence, newStatus, knowledgeId),
    env.DB.prepare(
      `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'reinforced', ?)`
    ).bind(knowledgeId, context.slice(0, 500)),
  ]);

  let out = `Knowledge #${knowledgeId} reinforced.\n`;
  out += `Heat: ${item.heat_score.toFixed(2)} -> ${newHeat.toFixed(2)}\nConfidence: ${item.confidence.toFixed(2)} -> ${newConfidence.toFixed(2)}`;
  if (newStatus !== item.status) out += `\nStatus: ${item.status} -> ${newStatus}`;
  return out;
}

// ─── CONTRADICT ─────────────────────────────────────────────────────────────

export async function handleKnowContradict(env: Env, params: Record<string, unknown>): Promise<string> {
  const knowledgeId = Number(params.knowledge_id);
  const context = (params.context as string) || "";
  if (!knowledgeId) return "Error: knowledge_id is required";

  const item = await env.DB.prepare(
    `SELECT content, confidence, contradiction_count, status FROM knowledge_items WHERE id = ?`
  ).bind(knowledgeId).first() as (KnowledgeRow & { contradiction_count: number }) | null;
  if (!item) return `Knowledge #${knowledgeId} not found.`;

  const newConfidence = Math.max(item.confidence - 0.15, 0);
  const newStatus = newConfidence < 0.2 ? "contradicted" : item.status;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE knowledge_items SET confidence = ?, contradiction_count = contradiction_count + 1, status = ?,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(newConfidence, newStatus, knowledgeId),
    env.DB.prepare(
      `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'contradicted', ?)`
    ).bind(knowledgeId, context.slice(0, 500)),
  ]);

  const warning = newStatus === "contradicted" ? "\nKnowledge CONTRADICTED — confidence below 0.2. Filtered from results from now on." : "";
  return `Knowledge #${knowledgeId} contradicted.\nConfidence: ${item.confidence.toFixed(2)} -> ${newConfidence.toFixed(2)}\nContradictions: ${item.contradiction_count + 1}${warning}`;
}

// ─── LANDSCAPE ──────────────────────────────────────────────────────────────

export interface KnowledgeLandscape {
  who: string;
  status: Array<{ status: string; count: number }>;
  categories: Array<{ category: string; count: number; avg_heat: number }>;
  hottest: Array<{ id: number; content: string; category: string; who: string; heat_score: number; confidence: number; access_count: number }>;
  cooling: Array<{ id: number; content: string; category: string; who: string; heat_score: number; last_accessed_at: string | null }>;
  candidates: Array<{ id: number; content: string; category: string; who: string; status: string; confidence: number; heat_score: number; access_count: number; last_accessed_at: string | null; created_at: string }>;
  tracks: Array<{ track: string; title: string; goal: string; sessions: number; avg_mastery: number; last_session: string | null }>;
}

export async function getKnowledgeLandscape(env: Env, who: Who | null): Promise<KnowledgeLandscape> {
  const f = whoFilterSql(who);
  const [status, byCategory, hottest, coldest, candidates, tracks] = await Promise.all([
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM knowledge_items WHERE 1=1${f.clause} GROUP BY status`).bind(...f.binds).all(),
    env.DB.prepare(`SELECT COALESCE(category,'general') AS category, COUNT(*) AS count, AVG(heat_score) AS avg_heat
                    FROM knowledge_items WHERE status = 'active'${f.clause} GROUP BY category ORDER BY count DESC`).bind(...f.binds).all(),
    env.DB.prepare(`SELECT id, content, COALESCE(category,'general') AS category, who, heat_score, confidence, access_count
                    FROM knowledge_items WHERE status = 'active'${f.clause} ORDER BY heat_score DESC, access_count DESC LIMIT 5`).bind(...f.binds).all(),
    env.DB.prepare(`SELECT id, content, COALESCE(category,'general') AS category, who, heat_score, last_accessed_at
                    FROM knowledge_items WHERE status IN ('active','cooling')${f.clause} ORDER BY heat_score ASC LIMIT 5`).bind(...f.binds).all(),
    env.DB.prepare(`SELECT id, content, COALESCE(category,'general') AS category, who, status, confidence, heat_score, access_count, last_accessed_at, created_at
                    FROM knowledge_items WHERE status = 'candidate'${f.clause} ORDER BY created_at DESC LIMIT 5`).bind(...f.binds).all(),
    env.DB.prepare(`SELECT track, COUNT(*) AS total, AVG(mastery_delta) AS avg_mastery, MAX(completed_at) AS last_session
                    FROM knowledge_sessions WHERE status = 'completed'${f.clause} GROUP BY track`).bind(...f.binds).all(),
  ]);

  const trackMap: Record<string, Record<string, unknown>> = {};
  for (const t of (tracks.results || []) as Array<Record<string, unknown>>) trackMap[t.track as string] = t;

  return {
    who: who || "all",
    status: (status.results || []) as KnowledgeLandscape["status"],
    categories: ((byCategory.results || []) as Array<Record<string, unknown>>).map(r => ({
      category: r.category as string, count: r.count as number, avg_heat: Number(r.avg_heat) || 0,
    })),
    hottest: (hottest.results || []) as KnowledgeLandscape["hottest"],
    cooling: (coldest.results || []) as KnowledgeLandscape["cooling"],
    candidates: (candidates.results || []) as KnowledgeLandscape["candidates"],
    tracks: Object.entries(CURRICULUM_TRACKS).map(([key, c]) => ({
      track: key, title: c.title, goal: c.goal,
      sessions: (trackMap[key]?.total as number) || 0,
      avg_mastery: Number(trackMap[key]?.avg_mastery) || 0,
      last_session: (trackMap[key]?.last_session as string) || null,
    })),
  };
}

export async function handleKnowLandscape(env: Env, params: Record<string, unknown>): Promise<string> {
  const who = optionalWho(params.who);
  const l = await getKnowledgeLandscape(env, who);

  let output = `## Knowledge Landscape (${l.who})\n_What experience taught. Heat is the practice record._\n\n### Status\n`;
  if (!l.status.length) output += "- empty — nothing abstracted yet\n";
  for (const r of l.status) output += `- ${r.status}: ${r.count}\n`;

  if (l.categories.length) {
    output += `\n### Categories\n`;
    for (const r of l.categories) output += `- ${r.category}: ${r.count} items (avg heat ${r.avg_heat.toFixed(2)})\n`;
  }
  if (l.hottest.length) {
    output += `\n### Hottest\n`;
    for (const r of l.hottest) output += `- #${r.id} ${heatBar(r.heat_score)} [${r.category} · ${r.who}] heat:${r.heat_score.toFixed(2)} — ${r.content.slice(0, 120)}\n`;
  }
  if (l.cooling.length) {
    output += `\n### Cooling\n`;
    for (const r of l.cooling) output += `- #${r.id} [${r.category} · ${r.who}] heat:${r.heat_score.toFixed(2)} last:${r.last_accessed_at || "never"} — ${r.content.slice(0, 100)}\n`;
  }
  if (l.candidates.length) {
    output += `\n### Candidates (awaiting review — reinforce to activate)\n`;
    for (const r of l.candidates) output += `- #${r.id} [${r.category} · ${r.who}] — ${r.content.slice(0, 100)}\n`;
  }
  output += `\n### Curriculum\n`;
  for (const t of l.tracks) {
    output += `- **${t.title}**: ${t.sessions} sessions`;
    if (t.sessions) output += ` · avg growth +${Math.round(t.avg_mastery * 100)}% · last ${String(t.last_session || "").slice(0, 10)}`;
    output += `\n`;
  }
  return output;
}

// ─── HEAT DECAY (engine preset `knowledge_decay`, every 6 hours) ────────────

export async function runKnowledgeHeatDecay(env: Env): Promise<string> {
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.05, 0), updated_at = datetime('now')
                    WHERE status = 'active' AND last_accessed_at < datetime('now', '-7 days') AND last_accessed_at >= datetime('now', '-30 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.15, 0), updated_at = datetime('now')
                    WHERE status = 'active' AND last_accessed_at < datetime('now', '-30 days') AND last_accessed_at >= datetime('now', '-90 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.30, 0), updated_at = datetime('now')
                    WHERE status = 'active' AND last_accessed_at < datetime('now', '-90 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET heat_score = MAX(heat_score - 0.05, 0), updated_at = datetime('now')
                    WHERE status = 'active' AND last_accessed_at IS NULL AND created_at < datetime('now', '-7 days')`),
    env.DB.prepare(`UPDATE knowledge_items SET status = 'cooling', updated_at = datetime('now')
                    WHERE status = 'active' AND heat_score < 0.1`),
  ]);
  const totalChanges = results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
  return `ok (${totalChanges} items cooled)`;
}

// ─── WAKE COMPOSITION ───────────────────────────────────────────────────────

/**
 * Three hottest lessons, for mind_ground. Silent when the layer is empty or
 * the tables don't exist yet — a wake must never fail on a young layer.
 */
export async function composeKnowledgeLines(env: Env, limit = 3): Promise<string[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, content, who, heat_score FROM knowledge_items
       WHERE status = 'active' ORDER BY heat_score DESC, access_count DESC LIMIT ?`
    ).bind(limit).all();
    return ((rows.results || []) as Array<Record<string, unknown>>).map(r =>
      `${heatBar(r.heat_score as number)} ${String(r.content).slice(0, 110)} (#${r.id} · ${r.who})`
    );
  } catch {
    return [];
  }
}

// ─── SESSIONS ────────────────────────────────────────────────────────────────

export async function handleKnowSessionStart(env: Env, params: Record<string, unknown>): Promise<string> {
  const track = (params.track as string) || "writing";
  const topic = (params.topic as string) || "";
  const who = normalizeWho(params.who);

  const curriculum = CURRICULUM_TRACKS[track];
  if (!curriculum) return `Error: unknown track '${track}'. Tracks: ${Object.keys(CURRICULUM_TRACKS).join(", ")}`;

  const searchQuery = topic || curriculum.goal;
  let relatedKnowledge = "";
  try {
    const related = await queryKnowledge(env, searchQuery, { limit: 5, vote: false });
    if (related.length) {
      relatedKnowledge = `\n### Relevant Knowledge\n` + related.map(r => `- #${r.id} ${heatBar(r.heat_score)} — ${r.content.slice(0, 140)}`).join("\n") + "\n";
    }
  } catch { /* best-effort */ }

  const recent = await env.DB.prepare(
    `SELECT id, topic, notes, practice_output, reflection, mastery_delta, completed_at FROM knowledge_sessions
     WHERE track = ? AND who = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 3`
  ).bind(track, who).all();

  const res = await env.DB.prepare(
    `INSERT INTO knowledge_sessions (track, topic, who, status) VALUES (?, ?, ?, 'active')`
  ).bind(track, topic, who).run();
  const sessionId = res.meta.last_row_id;

  let out = `## Session Started — #${sessionId} (${who})\nTrack: **${curriculum.title}**`;
  if (topic) out += ` | Focus: ${topic}`;
  out += `\n\n**Goal:** ${curriculum.goal}\n**Practice:** ${curriculum.practice}\n`;

  const prev = (recent.results || []) as Array<Record<string, unknown>>;
  if (prev.length) {
    out += `\n### Previous Sessions\n`;
    out += prev.map(s => `  #${s.id}${s.topic ? ` — ${s.topic}` : ""} (${String(s.completed_at || "").slice(0, 10)}): ${String(s.notes || "no notes").slice(0, 120)}`).join("\n");
    out += "\n";
  } else {
    out += `\n_First session on this track for ${who}._\n`;
  }

  out += relatedKnowledge;
  out += `\n---\nSession ID: **${sessionId}**. When done: \`know_session_complete\` with notes, work, reflection, and the knowledge ids you leaned on.`;
  return out;
}

export async function handleKnowSessionComplete(env: Env, params: Record<string, unknown>): Promise<string> {
  const sessionId = Number(params.session_id);
  const notes = (params.notes as string) || "";
  const practiceOutput = (params.practice_output as string) || "";
  const reflection = (params.reflection as string) || "";
  const masteryDelta = Math.min(Math.max(Number(params.mastery_delta) || 0, 0), 1);
  const itemsCovered: number[] = Array.isArray(params.items_covered)
    ? (params.items_covered as unknown[]).map(Number).filter(n => n > 0)
    : [];

  if (!sessionId) return "Error: session_id is required";

  const session = await env.DB.prepare(
    `SELECT track, topic, who, status FROM knowledge_sessions WHERE id = ?`
  ).bind(sessionId).first() as Record<string, unknown> | null;
  if (!session) return `Session #${sessionId} not found`;
  if (session.status === "completed") return `Session #${sessionId} was already completed.`;

  await env.DB.prepare(
    `UPDATE knowledge_sessions SET status = 'completed', notes = ?, practice_output = ?, reflection = ?,
     mastery_delta = ?, items_covered = ?, completed_at = datetime('now') WHERE id = ?`
  ).bind(notes, practiceOutput, reflection, masteryDelta, JSON.stringify(itemsCovered), sessionId).run();

  if (itemsCovered.length) {
    await env.DB.batch(itemsCovered.flatMap(kid => [
      env.DB.prepare(
        `UPDATE knowledge_items SET heat_score = MIN(heat_score + 0.15, 2.0), access_count = access_count + 1,
         last_accessed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(kid),
      env.DB.prepare(
        `INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'session', ?)`
      ).bind(kid, `Session #${sessionId} — ${session.track}`),
    ]));
  }

  let out = `## Session #${sessionId} Complete — ${session.track} (${session.who})\n`;
  if (session.topic) out += `Focus: ${session.topic}\n`;
  out += `\n`;
  if (notes) out += `**Notes:** ${notes}\n`;
  if (practiceOutput) out += `**Work:** ${practiceOutput}\n`;
  if (reflection) out += `**Reflection:** ${reflection}\n`;
  if (masteryDelta > 0) out += `**Growth:** +${Math.round(masteryDelta * 100)}%\n`;
  if (itemsCovered.length) out += `**Knowledge reinforced:** ${itemsCovered.map(i => `#${i}`).join(", ")}\n`;
  return out;
}

export async function handleKnowSessionList(env: Env, params: Record<string, unknown>): Promise<string> {
  const who = optionalWho(params.who);
  const track = params.track as string | undefined;
  const limit = Number(params.limit) || 20;

  const f = whoFilterSql(who);
  const trackClause = track ? " AND track = ?" : "";
  const binds = [...f.binds, ...(track ? [track] : [])];

  const [sessions, summary] = await Promise.all([
    env.DB.prepare(
      `SELECT id, track, topic, who, status, notes, practice_output, reflection, mastery_delta, started_at, completed_at
       FROM knowledge_sessions WHERE 1=1${f.clause}${trackClause} ORDER BY started_at DESC LIMIT ?`
    ).bind(...binds, limit).all(),
    env.DB.prepare(
      `SELECT track, COUNT(*) AS total, AVG(mastery_delta) AS avg_mastery, MAX(completed_at) AS last_session
       FROM knowledge_sessions WHERE status = 'completed'${f.clause} GROUP BY track`
    ).bind(...f.binds).all(),
  ]);

  const summaryMap: Record<string, Record<string, unknown>> = {};
  for (const s of (summary.results || []) as Array<Record<string, unknown>>) summaryMap[s.track as string] = s;

  let out = `## Curriculum Sessions (${who || "all"})\n\n### Progress by Track\n`;
  for (const [key, c] of Object.entries(CURRICULUM_TRACKS)) {
    const s = summaryMap[key];
    out += `**${c.title}**: ${(s?.total as number) || 0} sessions`;
    if (s) out += ` | avg growth +${Math.round(Number(s.avg_mastery) * 100)}% | last ${String(s.last_session || "").slice(0, 10)}`;
    out += "\n";
  }

  const list = (sessions.results || []) as Array<Record<string, unknown>>;
  if (list.length) {
    out += `\n### Session History\n`;
    for (const s of list) {
      const date = String(s.completed_at || s.started_at || "").slice(0, 10);
      const mastery = Number(s.mastery_delta) > 0 ? ` +${Math.round(Number(s.mastery_delta) * 100)}%` : "";
      out += `\n**#${s.id}** [${s.track} · ${s.who}]${s.topic ? ` — ${s.topic}` : ""} (${date}, ${s.status})${mastery}\n`;
      if (s.notes) out += `  Notes: ${String(s.notes).slice(0, 150)}\n`;
      if (s.practice_output) out += `  Work: ${String(s.practice_output).slice(0, 150)}\n`;
      if (s.reflection) out += `  Reflection: ${String(s.reflection).slice(0, 150)}\n`;
    }
  }
  return out;
}
