/**
 * Cortex recall: one ranked list from thoughts AND conversations.
 *
 * The vector index holds both kinds under source "cortex": thoughts as
 * `ctx-<id>`, conversations as `conv-<id>` (cortex/conversations.ts). Recall
 * used to ask the index for both and then keep only the thoughts, so a saved
 * conversation could be searched for by name but never surfaced on its own.
 *
 * Kept pure (no env, no D1) so the ranking and rendering can be tested.
 */

export interface RecallMatch {
  id: string;
  score?: number;
}

export type RecallRow = Record<string, unknown>;

export interface RankedRecall {
  kind: "thought" | "conversation";
  row: RecallRow;
  score: number;
}

/** Split vector ids into thought ids and conversation ids, prefixes removed. */
export function splitMatchIds(matches: RecallMatch[]): { thoughtIds: string[]; conversationIds: string[] } {
  const thoughtIds: string[] = [];
  const conversationIds: string[] = [];
  for (const m of matches) {
    if (m.id.startsWith("ctx-")) thoughtIds.push(m.id.slice(4));
    else if (m.id.startsWith("conv-")) conversationIds.push(m.id.slice(5));
  }
  return { thoughtIds, conversationIds };
}

/** Best score per id, keyed by the full vector id. */
export function scoreMap(matches: RecallMatch[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) {
    const s = m.score || 0;
    if (s > (out.get(m.id) ?? -1)) out.set(m.id, s);
  }
  return out;
}

/** Thoughts and conversations together, best match first. */
export function rankRecall(
  thoughts: RecallRow[],
  conversations: RecallRow[],
  scores: Map<string, number>,
  limit: number,
): RankedRecall[] {
  const all: RankedRecall[] = [
    ...thoughts.map((row) => ({ kind: "thought" as const, row, score: scores.get(`ctx-${row.id}`) ?? 0 })),
    ...conversations.map((row) => ({ kind: "conversation" as const, row, score: scores.get(`conv-${row.id}`) ?? 0 })),
  ];
  return all.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit));
}

const SUMMARY_CHARS = 600;

function dateOf(row: RecallRow): string {
  const raw = (row.started_at as string | null) || (row.created_at as string | null) || "";
  return raw.slice(0, 10) || "unknown";
}

function scoreText(score: number): string {
  return score ? ` (${(score * 100).toFixed(0)}%)` : "";
}

function jsonList(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * One conversation as recall prose. The heading has the same shape as a
 * thought's ("### kind [domain] (NN%) — date"), which is what the house's
 * whisper parses into a card.
 */
export function renderConversation(row: RecallRow, score: number): string[] {
  const lines: string[] = [];
  const domain = row.domain ? ` [${row.domain}]` : "";
  lines.push(`### conversation${domain}${scoreText(score)} — ${dateOf(row)}`);
  const title = (row.title as string | null)?.trim();
  const summary = ((row.summary as string | null) || "").trim();
  const body = summary.length > SUMMARY_CHARS ? summary.slice(0, SUMMARY_CHARS).trimEnd() + "…" : summary;
  if (title && body) lines.push(`${title}: ${body}`);
  else lines.push(title || body || "(untitled conversation)");
  const decisions = jsonList(row.decisions);
  if (decisions.length) lines.push(`*Decisions: ${decisions.join("; ")}*`);
  const source = (row.source as string | null) || "unknown";
  lines.push(`*From a ${source} conversation · ID: ${row.id}*`);
  return lines;
}
