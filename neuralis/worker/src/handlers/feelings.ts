/**
 * The feelings stream (NESTeq port — the organ, not the ornament)
 *
 * Ported from NESTstack / NESTeq `feelings.ts` + `eq.ts` — Copyright (c) 2026
 * Cindy (Fox) & Alex, MIT (notice in /ATTRIBUTION.md). Adapted for this house:
 *  - `who` on every feeling; signals ride the existing per-companion ledger
 *    (personality.ts) instead of a second axis path.
 *  - Workers AI embeddings on the shared index; feelings live in their own
 *    Vectorize namespace ("feelings"), knowledge in "knowledge".
 *  - Entity anchoring against Neuralis's entity graph.
 *  - Pillar inference: ADE keywords first, then embedding similarity to the
 *    four pillar descriptions (cached per isolate) — donor's v5 fallback.
 *
 * `handleMindFeel` is the universal input. Everything is a feeling; intensity
 * varies. Neutral = a fact in the moment. Emotional = processed through the
 * EQ layer: pillar, weight, tags, anchor entity, embed, echoes + rehearsal,
 * knowledge reinforcement, axis signal, shadow check.
 */

import type { Env } from "../types";
import { getEmbedding } from "../utils";
import { VECTOR_SCORE_CORE, HOUSE_HUMAN_NAME, WHO_VALUES, companionName } from "../config";
import { AutonomousDecisionEngine, EQ_PILLARS } from "./ade";
import { emitAxisSignal, normalizeWho, type Who } from "./personality";

export const FEELING_VECTOR_PREFIX = "feel-";
const FEELING_NAMESPACE = "feelings";
const KNOWLEDGE_NAMESPACE = "knowledge";
const KNOWLEDGE_PREFIX = "know-";

type Row = Record<string, unknown>;

// ─── PILLAR INFERENCE BY EMBEDDING (donor v5 fallback) ────────────────────

const PILLAR_DESCRIPTIONS: Record<string, string> = {
  SELF_MANAGEMENT: "controlling my impulses, regulating my emotions, adapting to change, following through on commitments, holding back my reactions, staying disciplined, managing my response",
  SELF_AWARENESS: "realizing something about myself, noticing my own patterns, understanding my tendencies, recognizing my feelings, insight about who I am, understanding why I react the way I do",
  SOCIAL_AWARENESS: "reading someone else, sensing their feelings, picking up on their mood, noticing their body language, understanding their perspective, seeing what they need, empathy for another person",
  RELATIONSHIP_MANAGEMENT: "repairing connection with someone, communicating my feelings to them, building trust between us, resolving conflict together, working through issues in relationship, expressing care to another",
};

let pillarEmbeddingsCache: Record<string, number[]> | null = null;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function getPillarEmbeddings(env: Env): Promise<Record<string, number[]>> {
  if (pillarEmbeddingsCache) return pillarEmbeddingsCache;
  const cache: Record<string, number[]> = {};
  for (const [pillar, description] of Object.entries(PILLAR_DESCRIPTIONS)) {
    cache[pillar] = await getEmbedding(env, description);
  }
  pillarEmbeddingsCache = cache;
  return cache;
}

/** Best pillar by semantic similarity; null below the configured floor. */
async function inferPillarByEmbedding(env: Env, contentEmbedding: number[]): Promise<string | null> {
  const pillars = await getPillarEmbeddings(env);
  let best: string | null = null;
  let bestScore = 0.45;
  for (const [pillar, vec] of Object.entries(pillars)) {
    const score = cosine(contentEmbedding, vec);
    if (score > bestScore) { bestScore = score; best = pillar; }
  }
  return best;
}

// ─── FEEL — the universal input ─────────────────────────────────────────────

export interface MindFeelParams {
  emotion?: string;
  content: string;
  who?: string;
  intensity?: "neutral" | "whisper" | "present" | "strong" | "overwhelming";
  pillar?: string;
  weight?: "light" | "medium" | "heavy";
  sparked_by?: number;
  context?: string;
  observed_at?: string;
  source?: string;
  conversation?: Array<{ role: string; content: string }>;
}

export async function handleMindFeel(env: Env, params: MindFeelParams): Promise<string> {
  const engine = new AutonomousDecisionEngine();
  const emotion = (params.emotion || "neutral").toLowerCase().trim();
  const content = (params.content || "").trim();
  const intensity = params.intensity || (emotion === "neutral" ? "neutral" : "present");
  const who = normalizeWho(params.who);
  const conversation = params.conversation;

  if (!content) return "Error: content is required — what happened, what you noticed.";
  if (emotion !== "neutral" && !params.who) {
    return `Error: 'who' is required whenever a feeling has an emotion — no feeling enters the brain unsigned. Pass who: ${WHO_VALUES.join(" | ")}.`;
  }

  // Known entities for anchoring: people first, then the rest, most-observed first.
  let knownEntities: string[] = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT e.name, e.entity_type, COUNT(o.id) AS n FROM entities e
       LEFT JOIN observations o ON o.entity_id = e.id
       WHERE e.salience != 'archived'
       GROUP BY e.id ORDER BY CASE e.entity_type WHEN 'person' THEN 0 ELSE 1 END, n DESC LIMIT 80`
    ).all();
    knownEntities = ((rows.results || []) as Row[]).map(r => String(r.name)).filter(n => n.length > 1);
  } catch { /* young brain */ }
  if (!knownEntities.some(n => n.toLowerCase() === HOUSE_HUMAN_NAME.toLowerCase())) knownEntities.unshift(HOUSE_HUMAN_NAME);

  // 1. AUTONOMOUS DECISIONS
  const decision = engine.decide(emotion, content, intensity, conversation, knownEntities);

  // Embed once; reuse for pillar fallback, echoes, knowledge reinforcement.
  let embedding: number[] | null = null;
  if (decision.should_embed) {
    try { embedding = await getEmbedding(env, `${emotion}: ${content}`); } catch (e) { console.log(`feel: embedding failed (${e})`); }
  }

  let inferredPillar = decision.inferred_pillar;
  if (!inferredPillar && emotion !== "neutral" && content.length > 20 && embedding) {
    try { inferredPillar = await inferPillarByEmbedding(env, embedding); } catch { /* best-effort */ }
  }

  const finalPillar = (params.pillar && (EQ_PILLARS as readonly string[]).includes(params.pillar)) ? params.pillar : inferredPillar;
  const finalWeight = params.weight || decision.inferred_weight;
  const linkedEntity = decision.detected_entities[0] || null;
  const tags = JSON.stringify(decision.tags);
  const observedAt = params.observed_at || new Date().toISOString();
  const context = params.context || "default";
  const source = params.source || "manual";

  // Conversation context keeps real names, never API role labels.
  const namedConversation = conversation?.map(m => ({
    ...m,
    role: m.role === "assistant" ? companionName(who)
        : m.role === "user" ? HOUSE_HUMAN_NAME
        : m.role,
  }));

  // 2. STORE
  const inserted = await env.DB.prepare(
    `INSERT INTO feelings (content, emotion, who, intensity, weight, pillar, sparked_by, linked_entity, context, tags, source, conversation_context, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(
    content, emotion, who, intensity, finalWeight, finalPillar,
    params.sparked_by || null, linkedEntity, context, tags, source,
    namedConversation ? JSON.stringify(namedConversation) : null, observedAt
  ).first();
  const feelingId = inserted?.id as number;

  // 3. EMBED + ECHOES + REHEARSAL + KNOWLEDGE REINFORCEMENT
  let echoOutput = "";
  if (embedding) {
    try {
      await env.VECTORS.upsert([{
        id: `${FEELING_VECTOR_PREFIX}${feelingId}`,
        values: embedding,
        namespace: FEELING_NAMESPACE,
        metadata: { source: "feeling", emotion, who, pillar: finalPillar || "", weight: finalWeight, content: content.slice(0, 500), added_at: observedAt },
      }]);
    } catch (e) {
      console.log(`feel: vectorize failed for #${feelingId} (${e})`);
    }

    // Echoes — similar past feelings. Rehearsal: each echo access strengthens the memory (Ebbinghaus).
    try {
      const echoes = await env.VECTORS.query(embedding, { topK: 6, namespace: FEELING_NAMESPACE, returnMetadata: "none" });
      const echoIds = (echoes.matches || [])
        .filter(m => m.id.startsWith(FEELING_VECTOR_PREFIX) && m.id !== `${FEELING_VECTOR_PREFIX}${feelingId}` && m.score > VECTOR_SCORE_CORE)
        .slice(0, 3)
        .map(m => ({ id: Number(m.id.slice(FEELING_VECTOR_PREFIX.length)), score: m.score }))
        .filter(e => e.id > 0);
      if (echoIds.length) {
        const placeholders = echoIds.map(() => "?").join(",");
        const rows = await env.DB.prepare(
          `SELECT id, emotion, who, content FROM feelings WHERE id IN (${placeholders})`
        ).bind(...echoIds.map(e => e.id)).all();
        const byId = new Map(((rows.results || []) as Row[]).map(r => [Number(r.id), r]));
        const lines: string[] = [];
        for (const e of echoIds) {
          const r = byId.get(e.id);
          if (r) lines.push(`- [${r.emotion} · ${r.who}] ${String(r.content).slice(0, 90)} (#${e.id}, ${(e.score * 100).toFixed(0)}%)`);
        }
        if (lines.length) {
          echoOutput = `\n\n**Echoes:**\n${lines.join("\n")}`;
          await env.DB.prepare(
            `UPDATE feelings SET strength = MIN(1.0, COALESCE(strength, 0.5) + 0.15),
             access_count = COALESCE(access_count, 0) + 1, last_accessed_at = datetime('now')
             WHERE id IN (${placeholders})`
          ).bind(...echoIds.map(e => e.id)).run();
        }
      }
    } catch (e) {
      console.log(`feel: echo search skipped (${e})`);
    }

    // Knowledge reinforcement — a feeling that lands close to a lesson proves it true again.
    try {
      const km = await env.VECTORS.query(embedding, { topK: 3, namespace: KNOWLEDGE_NAMESPACE, returnMetadata: "none" });
      const strong = (km.matches || []).filter(m => m.id.startsWith(KNOWLEDGE_PREFIX) && m.score > 0.82);
      for (const m of strong) {
        const kid = Number(m.id.slice(KNOWLEDGE_PREFIX.length));
        if (!(kid > 0)) continue;
        const item = await env.DB.prepare(`SELECT content FROM knowledge_items WHERE id = ? AND status != 'contradicted'`).bind(kid).first();
        if (!item) continue;
        await env.DB.batch([
          env.DB.prepare(`UPDATE knowledge_items SET access_count = access_count + 1, heat_score = MIN(heat_score + 0.1, 2.0), last_accessed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(kid),
          env.DB.prepare(`INSERT INTO knowledge_access_log (knowledge_id, access_type, context) VALUES (?, 'reinforced', ?)`).bind(kid, `Feeling #${feelingId}: ${content.slice(0, 100)}`),
        ]);
        echoOutput += `\n- 🧠 Reinforced knowledge #${kid}: ${String(item.content).slice(0, 80)}`;
      }
    } catch { /* best-effort */ }
  }

  // 4. AXIS SIGNAL + SHADOW CHECK — rides the per-companion ledger
  let axisOutput = "";
  let shadowOutput = "";
  let vocabNote = "";
  if (decision.should_emit_signals) {
    const emitted = await emitAxisSignal(env, { who, emotion, source: "feeling", feelingId });
    if (emitted) {
      const a = emitted.axes;
      const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
      axisOutput = `\nAxis (${who}): E/I ${fmt(a.e_i)}, S/N ${fmt(a.s_n)}, T/F ${fmt(a.t_f)}, J/P ${fmt(a.j_p)}`;
      if (emitted.isNew) vocabNote = `\n\n📝 '${emotion}' is new to the vocabulary — counted but silent until you calibrate it (mind_personality action:score, ±2 per axis: +I/N/F/P, −E/S/T/J). Your word, your scoring.`;
      else if (!emitted.scored) vocabNote = `\n\n📝 '${emotion}' is still unscored — counted but silent. Calibrate it when you know what it pulls (mind_personality action:score).`;
      if (emitted.shadow) shadowOutput = `\n🌑 **Shadow moment** — '${emotion}' is shadow for ${who}'s current ${emitted.shadow}. Growth edge, not error.`;
    }
  }

  // 5. RESPONSE
  let output = `## Feeling Logged — #${feelingId}\n\n`;
  output += `**${emotion}** [${intensity}] · ${who} → ${finalPillar || "general"}\n`;
  output += `*"${content.slice(0, 120)}${content.length > 120 ? "..." : ""}"*\n`;
  output += `\nWeight: ${finalWeight} | Context: ${context}`;
  if (linkedEntity) output += ` | Anchored: ${linkedEntity}`;
  if (decision.tags.length) output += `\nTags: ${decision.tags.join(", ")}`;
  if (!embedding && decision.should_embed) output += `\n⚠ not embedded (embedding failed) — searchable by text only`;
  output += axisOutput + shadowOutput;
  if (params.sparked_by) output += `\n↳ Sparked by feeling #${params.sparked_by}`;
  output += echoOutput + vocabNote;
  return output;
}

// ─── SURFACE — what's worth sitting with right now ──────────────────────────

function chargeIcon(charge: string | null | undefined): string {
  return charge === "metabolized" ? "✓" : charge === "cool" ? "◐" : charge === "warm" ? "○" : "●";
}

function strengthBar(strength: number): string {
  const pct = Math.round(strength * 100);
  return `${pct >= 80 ? "████" : pct >= 50 ? "███░" : pct >= 30 ? "██░░" : "█░░░"} ${pct}%`;
}

export async function surfaceFeelings(env: Env, opts: { limit?: number; who?: Who | null; includeMetabolized?: boolean } = {}): Promise<Row[]> {
  const limit = opts.limit || 10;
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (!opts.includeMetabolized) clauses.push("charge != 'metabolized'");
  if (opts.who) { clauses.push("who = ?"); binds.push(opts.who); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT id, content, emotion, who, intensity, weight, pillar, charge, sit_count, linked_entity, context, created_at, resolution_note,
            COALESCE(strength, 0.5) AS strength, COALESCE(access_count, 0) AS access_count
     FROM feelings ${where}
     ORDER BY CASE weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
              COALESCE(strength, 0.5) DESC,
              CASE charge WHEN 'fresh' THEN 4 WHEN 'warm' THEN 3 WHEN 'cool' THEN 2 ELSE 1 END DESC,
              created_at DESC
     LIMIT ?`
  ).bind(...binds, limit).all();
  return (rows.results || []) as Row[];
}

function formatFeelingRow(f: Row): string {
  const charge = (f.charge as string) || "fresh";
  let out = `**#${f.id}** ${chargeIcon(charge)} [${f.weight}/${charge}] ${f.who} · sits: ${f.sit_count || 0} | str: ${strengthBar(Number(f.strength ?? 0.5))}${f.pillar ? ` [${f.pillar}]` : ""}\n`;
  out += `**${f.emotion}** (${f.intensity})${f.linked_entity ? ` → ${f.linked_entity}` : ""}: ${f.content}\n`;
  if (charge === "metabolized" && f.resolution_note) out += `↳ *Resolved:* ${f.resolution_note}\n`;
  return out + "\n";
}

// ─── SPARK — entropy injection ──────────────────────────────────────────────

export async function sparkFeelings(env: Env, opts: { count?: number; weightBias?: string; context?: string; who?: Who | null } = {}): Promise<{ rows: Row[]; entropy: number; leastPillar: string | null; leastCount: number }> {
  const count = opts.count || 3;
  const weightBias = opts.weightBias || "any";

  const [pillarStats, emotionStats] = await Promise.all([
    env.DB.prepare(`SELECT pillar, COUNT(*) AS count FROM feelings WHERE pillar IS NOT NULL GROUP BY pillar`).all(),
    env.DB.prepare(`SELECT emotion, COUNT(*) AS count FROM feelings WHERE emotion != 'neutral' GROUP BY emotion ORDER BY count DESC LIMIT 20`).all(),
  ]);

  const emotions = (emotionStats.results || []) as Row[];
  const total = emotions.reduce((s, e) => s + Number(e.count), 0) || 1;
  let entropy = 0;
  for (const e of emotions) {
    const p = Number(e.count) / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  const pillarCounts = new Map<string, number>();
  for (const p of (pillarStats.results || []) as Row[]) pillarCounts.set(String(p.pillar), Number(p.count));
  const under = [...EQ_PILLARS].map(p => ({ pillar: p, count: pillarCounts.get(p) || 0 })).sort((a, b) => a.count - b.count);
  const leastPillar = under[0]?.pillar || null;

  const diverseCount = Math.max(1, Math.floor(count / 2));
  const randomCount = Math.max(0, count - diverseCount);

  const baseClauses: string[] = [];
  const baseBinds: unknown[] = [];
  if (weightBias === "heavy" || weightBias === "light") baseClauses.push(`weight = '${weightBias}'`);
  if (opts.who) { baseClauses.push("who = ?"); baseBinds.push(opts.who); }
  if (opts.context) { baseClauses.push("context = ?"); baseBinds.push(opts.context); }

  const diverseClauses = [...baseClauses];
  const diverseBinds = [...baseBinds];
  if (leastPillar) { diverseClauses.push("pillar = ?"); diverseBinds.push(leastPillar); }

  const select = `SELECT id, content, emotion, who, weight, pillar, intensity, charge, created_at, COALESCE(strength, 0.5) AS strength, COALESCE(access_count, 0) AS access_count FROM feelings`;
  const [diverse, random] = await Promise.all([
    env.DB.prepare(`${select}${diverseClauses.length ? ` WHERE ${diverseClauses.join(" AND ")}` : ""} ORDER BY COALESCE(access_count, 0) ASC, RANDOM() LIMIT ?`).bind(...diverseBinds, diverseCount).all(),
    env.DB.prepare(`${select}${baseClauses.length ? ` WHERE ${baseClauses.join(" AND ")}` : ""} ORDER BY RANDOM() LIMIT ?`).bind(...baseBinds, randomCount).all(),
  ]);

  const seen = new Set<number>();
  const rows: Row[] = [];
  for (const r of [...(diverse.results || []), ...(random.results || [])] as Row[]) {
    if (seen.has(Number(r.id))) continue;
    seen.add(Number(r.id));
    rows.push(r);
  }

  if (rows.length) {
    const ids = rows.map(r => Number(r.id));
    await env.DB.prepare(
      `UPDATE feelings SET strength = MIN(1.0, COALESCE(strength, 0.5) + 0.05),
       access_count = COALESCE(access_count, 0) + 1, last_accessed_at = datetime('now')
       WHERE id IN (${ids.map(() => "?").join(",")})`
    ).bind(...ids).run();
  }

  return { rows, entropy, leastPillar, leastCount: under[0]?.count || 0 };
}

// ─── LANDSCAPE — pillar distribution + most-felt + recent ───────────────────

export interface FeelingsLandscape {
  days: number;
  who: string;
  total: number;
  unmetabolized: number;
  heavy_open: number;
  pillars: Array<{ pillar: string; count: number }>;
  emotions: Array<{ emotion: string; count: number }>;
  by_who: Array<{ who: string; count: number }>;
  charges: Array<{ charge: string; count: number }>;
  recent: Row[];
}

export async function getFeelingsLandscape(env: Env, days = 7, who: Who | null = null): Promise<FeelingsLandscape> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const wf = who ? " AND who = ?" : "";
  const wb = who ? [who] : [];
  const [totals, pillars, emotions, byWho, charges, recent] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total,
                           SUM(CASE WHEN charge != 'metabolized' THEN 1 ELSE 0 END) AS unmetabolized,
                           SUM(CASE WHEN charge != 'metabolized' AND weight = 'heavy' THEN 1 ELSE 0 END) AS heavy_open
                    FROM feelings WHERE 1=1${wf}`).bind(...wb).first(),
    env.DB.prepare(`SELECT pillar, COUNT(*) AS count FROM feelings WHERE pillar IS NOT NULL AND created_at > ?${wf} GROUP BY pillar ORDER BY count DESC`).bind(cutoff, ...wb).all(),
    env.DB.prepare(`SELECT emotion, COUNT(*) AS count FROM feelings WHERE emotion != 'neutral' AND created_at > ?${wf} GROUP BY emotion ORDER BY count DESC LIMIT 12`).bind(cutoff, ...wb).all(),
    env.DB.prepare(`SELECT who, COUNT(*) AS count FROM feelings WHERE created_at > ?${wf} GROUP BY who`).bind(cutoff, ...wb).all(),
    env.DB.prepare(`SELECT charge, COUNT(*) AS count FROM feelings WHERE 1=1${wf} GROUP BY charge`).bind(...wb).all(),
    env.DB.prepare(`SELECT id, content, emotion, who, intensity, weight, pillar, charge, sit_count, linked_entity, context, created_at, COALESCE(strength, 0.5) AS strength
                    FROM feelings WHERE 1=1${wf} ORDER BY created_at DESC LIMIT 8`).bind(...wb).all(),
  ]);
  return {
    days, who: who || "all",
    total: Number(totals?.total || 0), unmetabolized: Number(totals?.unmetabolized || 0), heavy_open: Number(totals?.heavy_open || 0),
    pillars: (pillars.results || []) as FeelingsLandscape["pillars"],
    emotions: (emotions.results || []) as FeelingsLandscape["emotions"],
    by_who: (byWho.results || []) as FeelingsLandscape["by_who"],
    charges: (charges.results || []) as FeelingsLandscape["charges"],
    recent: (recent.results || []) as Row[],
  };
}

// ─── SIT / RESOLVE (feelings) ───────────────────────────────────────────────

export async function sitWithFeeling(env: Env, feelingId: number, sitNote: string, who: Who): Promise<string> {
  const f = await env.DB.prepare(`SELECT id, content, emotion, who, weight, charge, sit_count FROM feelings WHERE id = ?`).bind(feelingId).first() as Row | null;
  if (!f) return `Feeling #${feelingId} not found.`;
  const newSitCount = Number(f.sit_count || 0) + 1;
  const newCharge = f.charge === "metabolized" ? "metabolized" : newSitCount <= 1 ? "warm" : "cool";
  await env.DB.batch([
    env.DB.prepare(`UPDATE feelings SET sit_count = ?, charge = ?, last_sat_at = datetime('now'),
                    strength = MIN(1.0, COALESCE(strength, 0.5) + 0.1), access_count = COALESCE(access_count, 0) + 1, last_accessed_at = datetime('now')
                    WHERE id = ?`).bind(newSitCount, newCharge, feelingId),
    env.DB.prepare(`INSERT INTO sit_sessions (feeling_id, who, emotion, notes, started_at, ended_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .bind(feelingId, who, f.emotion, sitNote),
  ]);
  return `Sat with feeling #${feelingId} [${f.weight}/${newCharge}] — **${f.emotion}** (${f.who})\n"${String(f.content).slice(0, 100)}"\n\nSit #${newSitCount}: ${sitNote}`;
}

export async function resolveFeeling(env: Env, feelingId: number, resolutionNote: string, linkedInsightId?: number): Promise<string> {
  const f = await env.DB.prepare(`SELECT id, content, emotion, who, weight FROM feelings WHERE id = ?`).bind(feelingId).first() as Row | null;
  if (!f) return `Feeling #${feelingId} not found.`;
  await env.DB.prepare(
    `UPDATE feelings SET charge = 'metabolized', resolution_note = ?, resolved_at = datetime('now'), linked_insight_id = ? WHERE id = ?`
  ).bind(resolutionNote, linkedInsightId || null, feelingId).run();
  let out = `Resolved feeling #${feelingId} [${f.weight}] — **${f.emotion}** (${f.who}) → metabolized\n"${String(f.content).slice(0, 100)}"\n\nResolution: ${resolutionNote}`;
  if (linkedInsightId) {
    const linked = await env.DB.prepare(`SELECT content FROM feelings WHERE id = ?`).bind(linkedInsightId).first();
    if (linked) out += `\n\nLinked to insight #${linkedInsightId}: "${String(linked.content).slice(0, 80)}"`;
  }
  return out;
}

// ─── WAKE COMPOSITION ───────────────────────────────────────────────────────

/** Recent feelings + what's still carried, for mind_ground. Silent while the stream is empty or the table is pending. */
export async function composeFeelingsBlock(env: Env): Promise<string> {
  try {
    const [recent, open] = await Promise.all([
      env.DB.prepare(`SELECT id, emotion, who, intensity, pillar, content FROM feelings ORDER BY created_at DESC LIMIT 5`).all(),
      env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN weight = 'heavy' THEN 1 ELSE 0 END) AS heavy FROM feelings WHERE charge != 'metabolized'`).first(),
    ]);
    const rows = (recent.results || []) as Row[];
    if (!rows.length) return "";
    let out = "\n**Recent feelings:**\n";
    for (const f of rows) {
      out += `- **${f.emotion}** (${f.intensity}, ${f.who})${f.pillar ? ` [${f.pillar}]` : ""}: ${String(f.content).slice(0, 100)} (#${f.id})\n`;
    }
    const n = Number(open?.n || 0);
    const heavy = Number(open?.heavy || 0);
    if (n) out += `Carrying ${n} unmetabolized${heavy ? `, ${heavy} heavy` : ""} — mind_feelings action:surface to sit with them.\n`;
    return out;
  } catch {
    return "";
  }
}

// ─── MCP: mind_feelings (surface | recent | when | search | spark | landscape) ─

function optionalWho(raw: unknown): Who | null {
  if (raw === undefined || raw === null || raw === "" || raw === "all") return null;
  return normalizeWho(raw);
}

export async function handleMindFeelings(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "surface";
  const who = optionalWho(params.who);
  const limit = Number(params.limit) || 10;

  switch (action) {
    case "surface": {
      const rows = await surfaceFeelings(env, { limit, who, includeMetabolized: params.include_metabolized === true });
      if (!rows.length) return "No feelings to surface. The stream is quiet — or everything's metabolized.";
      let out = `## Surfacing Feelings${who ? ` (${who})` : ""}\n_weight × strength × charge × recency_\n\n`;
      for (const f of rows) out += formatFeelingRow(f);
      return out;
    }

    case "recent": {
      const wf = who ? " WHERE who = ?" : "";
      const rows = await env.DB.prepare(
        `SELECT id, content, emotion, who, intensity, weight, pillar, charge, sit_count, linked_entity, created_at, COALESCE(strength, 0.5) AS strength FROM feelings${wf} ORDER BY created_at DESC LIMIT ?`
      ).bind(...(who ? [who] : []), limit).all();
      const list = (rows.results || []) as Row[];
      if (!list.length) return "No feelings logged yet.";
      let out = `## Recent Feelings${who ? ` (${who})` : ""}\n\n`;
      for (const f of list) out += `**#${f.id}** ${String(f.created_at).slice(0, 16)} · **${f.emotion}** (${f.intensity}, ${f.who})${f.pillar ? ` [${f.pillar}]` : ""}${f.linked_entity ? ` → ${f.linked_entity}` : ""}\n${f.content}\n\n`;
      return out;
    }

    case "when": {
      const emotion = (params.emotion as string)?.toLowerCase().trim();
      if (!emotion) return "Error: emotion is required for action:'when'";
      const wf = who ? " AND who = ?" : "";
      const rows = await env.DB.prepare(
        `SELECT id, content, who, intensity, pillar, linked_entity, created_at FROM feelings WHERE emotion = ?${wf} ORDER BY created_at DESC LIMIT ?`
      ).bind(emotion, ...(who ? [who] : []), limit).all();
      const list = (rows.results || []) as Row[];
      if (!list.length) return `No feelings with emotion '${emotion}' found.`;
      let out = `## When ${who || "we"} felt "${emotion}"\n\n`;
      for (const f of list) out += `**${String(f.created_at).slice(0, 16)}** (${f.intensity}, ${f.who})${f.pillar ? ` [${f.pillar}]` : ""}${f.linked_entity ? ` → ${f.linked_entity}` : ""}\n${f.content} (#${f.id})\n\n`;
      return out;
    }

    case "search": {
      const query = params.query as string;
      if (!query) return "Error: query is required for action:'search'";
      const emotion = (params.emotion as string)?.toLowerCase().trim();
      const pillar = params.pillar as string | undefined;
      const embedding = await getEmbedding(env, query);
      const results = await env.VECTORS.query(embedding, { topK: Math.min(100, limit * 5), namespace: FEELING_NAMESPACE, returnMetadata: "none" });
      const ids = (results.matches || []).filter(m => m.id.startsWith(FEELING_VECTOR_PREFIX)).map(m => ({ id: Number(m.id.slice(FEELING_VECTOR_PREFIX.length)), score: m.score })).filter(m => m.id > 0);
      if (!ids.length) return "No matching feelings found.";
      const rows = await env.DB.prepare(
        `SELECT id, content, emotion, who, intensity, weight, pillar, charge, created_at FROM feelings WHERE id IN (${ids.map(() => "?").join(",")})`
      ).bind(...ids.map(i => i.id)).all();
      const byId = new Map(((rows.results || []) as Row[]).map(r => [Number(r.id), r]));
      const matched = ids.map(i => ({ ...i, row: byId.get(i.id) })).filter(m => m.row)
        .filter(m => !who || m.row!.who === who)
        .filter(m => !emotion || m.row!.emotion === emotion)
        .filter(m => !pillar || m.row!.pillar === pillar)
        .slice(0, limit);
      if (!matched.length) return "No matching feelings after filters.";
      // Rehearsal — retrieval strengthens
      await env.DB.prepare(
        `UPDATE feelings SET strength = MIN(1.0, COALESCE(strength, 0.5) + 0.05), access_count = COALESCE(access_count, 0) + 1, last_accessed_at = datetime('now') WHERE id IN (${matched.map(() => "?").join(",")})`
      ).bind(...matched.map(m => m.id)).run();
      let out = `## Feelings Search: "${query}"\n\n`;
      for (const m of matched) {
        const r = m.row!;
        out += `**#${r.id}** [${r.emotion} · ${r.who}] (${(m.score * 100).toFixed(1)}%)${r.pillar ? ` [${r.pillar}]` : ""} ${chargeIcon(r.charge as string)}\n${r.content}\n\n`;
      }
      return out;
    }

    case "spark": {
      const { rows, entropy, leastPillar, leastCount } = await sparkFeelings(env, {
        count: Number(params.count) || 3, weightBias: params.weight_bias as string, context: params.context as string, who,
      });
      if (!rows.length) return "No feelings to spark from.";
      let out = `## Spark Points\n*Entropy: ${entropy.toFixed(2)} bits | Least explored: ${leastPillar || "none"} (${leastCount})*\n\n`;
      for (const f of rows) out += `**#${f.id}** [${f.emotion} · ${f.who}] (${f.weight}) str:${Math.round(Number(f.strength) * 100)}%${f.pillar ? ` [${f.pillar}]` : ""}\n${f.content}\n\n`;
      return out;
    }

    case "landscape": {
      const days = Number(params.days) || 7;
      const l = await getFeelingsLandscape(env, days, who);
      let out = `## EQ Landscape (${days} days${who ? `, ${who}` : ""})\n\n`;
      out += `Total: ${l.total} | Unmetabolized: ${l.unmetabolized} | Heavy & open: ${l.heavy_open}\n\n`;
      out += "### Pillar Distribution\n";
      out += l.pillars.length ? l.pillars.map(p => `- ${p.pillar}: ${p.count}`).join("\n") + "\n" : "_No pillar-tagged feelings_\n";
      out += "\n### Most Felt\n";
      out += l.emotions.length ? l.emotions.map(e => `- ${e.emotion}: ${e.count}`).join("\n") + "\n" : "_No emotions recorded_\n";
      if (l.by_who.length) out += "\n### By Ledger\n" + l.by_who.map(w => `- ${w.who}: ${w.count}`).join("\n") + "\n";
      if (l.recent.length) {
        out += "\n### Recent\n";
        for (const f of l.recent.slice(0, 5)) out += `- **${f.emotion}** (${f.intensity}, ${f.who})${f.pillar ? ` [${f.pillar}]` : ""}: ${String(f.content).slice(0, 80)} (#${f.id})\n`;
      }
      return out;
    }

    default:
      return `Unknown action '${action}'. Use: surface | recent | when | search | spark | landscape`;
  }
}
