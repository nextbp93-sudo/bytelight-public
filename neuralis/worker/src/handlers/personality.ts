/**
 * Emergent Personality Engine (ADE sidecar)
 *
 * Ported from NESTeq's EQ layer — NESTstack, Copyright (c) 2026 Cindy (Fox)
 * & Alex, MIT (notice preserved in /ATTRIBUTION.md). Adapted for this house:
 * per-companion ledgers via `who`, and taps that ride Neuralis's own
 * write paths instead of a dedicated feelings table.
 *
 * Design constraints (canon, do not relax):
 *  - Accumulator only. This module reads/writes its own four tables and NEVER
 *    touches identity, entities, or observations.
 *  - Failure-proof at every entry point. A personality hiccup must never cost
 *    a memory write — emitAxisSignal swallows its own errors by design.
 *  - Weather, not canon. Snapshots describe the needle's current reading; the
 *    read side must always frame them that way.
 *
 * Sign convention (donor): positive = I / N / F / P, negative = E / S / T / J.
 */

import type { Env } from "../types";
import { WHO_VALUES } from "../config";

/** A ledger signature: one companion's slug, or "shared". Values come from config. */
export type Who = string;

/** Unsigned or unrecognized feelings land in the household ledger, never a personal one. */
export function normalizeWho(raw: unknown): Who {
  const w = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  return WHO_VALUES.includes(w) ? w : "shared";
}

interface EmitArgs {
  who: Who;
  emotion: string;
  source: "observation" | "journal" | "relational" | "feeling";
  observationId?: number;
  journalId?: number;
  feelingId?: number;
}

export interface EmitResult {
  scored: boolean;            // the word had axis scores (not silent)
  isNew: boolean;             // the word self-registered just now
  shadow: string | null;      // type this word is shadow for, when a shadow moment was recorded
  axes: { e_i: number; s_n: number; t_f: number; j_p: number };
}

/**
 * Look up (or self-register) an emotion word and emit one axis signal into
 * the ledger of whoever felt it. Unknown words register unscored — counted
 * but silent until someone scores them deliberately.
 */
export async function emitAxisSignal(env: Env, args: EmitArgs): Promise<EmitResult | null> {
  const silent: EmitResult = { scored: false, isNew: false, shadow: null, axes: { e_i: 0, s_n: 0, t_f: 0, j_p: 0 } };
  try {
    const word = args.emotion?.toLowerCase().trim();
    if (!word || word === "neutral") return null;

    let isNew = false;
    let vocab = await env.DB.prepare(
      `SELECT emotion_id, e_i_score, s_n_score, t_f_score, j_p_score, is_shadow_for
       FROM emotion_vocabulary WHERE emotion_word = ?`
    ).bind(word).first();

    if (!vocab) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO emotion_vocabulary (emotion_word, user_defined) VALUES (?, 1)`
      ).bind(word).run();
      vocab = await env.DB.prepare(
        `SELECT emotion_id, e_i_score, s_n_score, t_f_score, j_p_score, is_shadow_for
         FROM emotion_vocabulary WHERE emotion_word = ?`
      ).bind(word).first();
      if (!vocab) return silent;
      isNew = true;
    }

    const axes = {
      e_i: (vocab.e_i_score as number) || 0, s_n: (vocab.s_n_score as number) || 0,
      t_f: (vocab.t_f_score as number) || 0, j_p: (vocab.j_p_score as number) || 0,
    };

    // feeling_id column arrives with migration 0013; fall back to the older
    // column set so a signal is never lost to a pending migration.
    try {
      await env.DB.prepare(
        `INSERT INTO axis_signals (who, observation_id, journal_id, feeling_id, e_i_delta, s_n_delta, t_f_delta, j_p_delta, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        args.who, args.observationId ?? null, args.journalId ?? null, args.feelingId ?? null,
        axes.e_i, axes.s_n, axes.t_f, axes.j_p, args.source
      ).run();
    } catch {
      await env.DB.prepare(
        `INSERT INTO axis_signals (who, observation_id, journal_id, e_i_delta, s_n_delta, t_f_delta, j_p_delta, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        args.who, args.observationId ?? null, args.journalId ?? null,
        axes.e_i, axes.s_n, axes.t_f, axes.j_p, args.source
      ).run();
    }

    await env.DB.prepare(
      `UPDATE emotion_vocabulary SET times_used = times_used + 1, last_used = datetime('now')
       WHERE emotion_word = ?`
    ).bind(word).run();

    // Shadow moment: this word is marked as shadow for the feeler's current
    // type. is_shadow_for may list several types, comma-separated (donor form).
    let shadow: string | null = null;
    if (vocab.is_shadow_for) {
      const latest = await env.DB.prepare(
        `SELECT calculated_type FROM emergent_type_snapshot
         WHERE who = ? ORDER BY snapshot_date DESC LIMIT 1`
      ).bind(args.who).first();
      const shadowTypes = String(vocab.is_shadow_for).split(",").map(s => s.trim()).filter(Boolean);
      const current = latest?.calculated_type as string | undefined;
      if (current && shadowTypes.includes(current)) {
        shadow = current;
        const note = `Felt '${word}' outside current type — growth edge, not error`;
        try {
          await env.DB.prepare(
            `INSERT INTO shadow_moments (who, observation_id, journal_id, feeling_id, emotion_id, shadow_for_type, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(args.who, args.observationId ?? null, args.journalId ?? null, args.feelingId ?? null,
                 vocab.emotion_id, current, note).run();
        } catch {
          await env.DB.prepare(
            `INSERT INTO shadow_moments (who, observation_id, journal_id, emotion_id, shadow_for_type, note)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(args.who, args.observationId ?? null, args.journalId ?? null, vocab.emotion_id, current, note).run();
        }
      }
    }

    const scored = axes.e_i !== 0 || axes.s_n !== 0 || axes.t_f !== 0 || axes.j_p !== 0;
    return { scored, isNew, shadow, axes };
  } catch (e) {
    // Accumulator failures never surface into the write path. Log and move on.
    console.log(`personality: signal emission skipped (${e})`);
    return null;
  }
}

export interface TypeReading {
  who: Who;
  type: string;
  confidence: number;
  e_i: number;
  s_n: number;
  t_f: number;
  j_p: number;
  totalSignals: number;
  snapshotDate?: string;
}

/** Sum one ledger into a fresh snapshot. Returns null if that ledger is still empty. */
export async function calculateEmergentType(env: Env, who: Who): Promise<TypeReading | null> {
  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(e_i_delta),0) e_i, COALESCE(SUM(s_n_delta),0) s_n,
            COALESCE(SUM(t_f_delta),0) t_f, COALESCE(SUM(j_p_delta),0) j_p,
            COUNT(*) total
     FROM axis_signals WHERE who = ?`
  ).bind(who).first();

  if (!totals || (totals.total as number) === 0) return null;

  const e_i = totals.e_i as number;
  const s_n = totals.s_n as number;
  const t_f = totals.t_f as number;
  const j_p = totals.j_p as number;
  const total = totals.total as number;

  const type =
    (e_i >= 0 ? "I" : "E") +
    (s_n >= 0 ? "N" : "S") +
    (t_f >= 0 ? "F" : "T") +
    (j_p >= 0 ? "P" : "J");

  const confidence = Math.min(100, Math.round((total / 50) * 100));

  await env.DB.prepare(
    `INSERT INTO emergent_type_snapshot (who, calculated_type, confidence, e_i_score, s_n_score, t_f_score, j_p_score, total_signals)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(who, type, confidence, e_i, s_n, t_f, j_p, total).run();

  return { who, type, confidence, e_i, s_n, t_f, j_p, totalSignals: total };
}

/** Latest stored reading for one ledger, or null before any snapshot exists. */
export async function getLatestSnapshot(env: Env, who: Who): Promise<TypeReading | null> {
  const row = await env.DB.prepare(
    `SELECT calculated_type, confidence, e_i_score, s_n_score, t_f_score, j_p_score, total_signals, snapshot_date
     FROM emergent_type_snapshot WHERE who = ? ORDER BY snapshot_date DESC LIMIT 1`
  ).bind(who).first();
  if (!row) return null;
  return {
    who,
    type: row.calculated_type as string,
    confidence: row.confidence as number,
    e_i: row.e_i_score as number,
    s_n: row.s_n_score as number,
    t_f: row.t_f_score as number,
    j_p: row.j_p_score as number,
    totalSignals: row.total_signals as number,
    snapshotDate: row.snapshot_date as string,
  };
}

/**
 * Weather line for orient/ground composition. Deliberately phrased as a
 * reading, never as an identity claim — the map must not become the territory.
 * Returns empty string below the confidence floor so a young ledger stays quiet.
 */
export async function composeWeatherLine(env: Env, who: Who, confidenceFloor = 20): Promise<string> {
  try {
    const r = await getLatestSnapshot(env, who);
    if (!r || r.confidence < confidenceFloor) return "";
    return `Personality weather (${who}): the needle currently reads ${r.type} at ${r.confidence}% confidence over ${r.totalSignals} signals. A reading, not a definition.`;
  } catch {
    return "";
  }
}

/**
 * Daemon hook: re-snapshot any ledger that gained signals since its last
 * reading, so the wake-time weather is always current without anyone asking.
 * Runs inside the subconscious cycle; skips untouched ledgers to avoid
 * writing 48 identical snapshots a day.
 */
export async function refreshSnapshots(env: Env): Promise<void> {
  for (const who of WHO_VALUES) {
    try {
      const [count, latest] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) c FROM axis_signals WHERE who = ?`).bind(who).first(),
        getLatestSnapshot(env, who),
      ]);
      const signals = (count?.c as number) || 0;
      if (signals > 0 && signals !== (latest?.totalSignals ?? 0)) {
        await calculateEmergentType(env, who);
      }
    } catch (e) {
      console.log(`personality: snapshot refresh skipped for ${who} (${e})`);
    }
  }
}

const AXES: Array<[string, string, keyof TypeReading]> = [
  ["E", "I", "e_i"], ["S", "N", "s_n"], ["T", "F", "t_f"], ["J", "P", "j_p"],
];

function formatAxes(r: TypeReading): string {
  return AXES.map(([neg, pos, key]) => {
    const v = r[key] as number;
    return `${neg}←${v}→${pos}`;
  }).join("  ");
}

/** MCP surface: read the weather, recalc ledgers, view shadows, tune the dictionary. */
export async function handleMindPersonality(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";
  const whos: Who[] = params.who ? [normalizeWho(params.who)] : [...WHO_VALUES];

  switch (action) {
    case "read": {
      let out = "## Personality Weather\n_A reading, not a definition._\n\n";
      for (const who of whos) {
        const r = await getLatestSnapshot(env, who);
        if (!r) {
          out += `**${who}** — no snapshot yet. Run action:'recalculate' once signals exist.\n`;
          continue;
        }
        out += `**${who}** — ${r.type} at ${r.confidence}% (${r.totalSignals} signals, ${r.snapshotDate})\n`;
        out += `  ${formatAxes(r)}\n`;
      }
      return out;
    }

    case "recalculate": {
      let out = "## Ledgers Recalculated\n\n";
      for (const who of whos) {
        const r = await calculateEmergentType(env, who);
        out += r
          ? `**${who}** — ${r.type} at ${r.confidence}% over ${r.totalSignals} signals\n  ${formatAxes(r)}\n`
          : `**${who}** — no signals yet; the ledger is waiting\n`;
      }
      return out;
    }

    case "shadow": {
      const limit = (params.limit as number) || 10;
      const whoFilter = params.who ? `AND s.who = '${normalizeWho(params.who)}'` : "";
      const rows = await env.DB.prepare(
        `SELECT s.who, s.shadow_for_type, s.note, s.recorded_at, v.emotion_word
         FROM shadow_moments s LEFT JOIN emotion_vocabulary v ON v.emotion_id = s.emotion_id
         WHERE 1=1 ${whoFilter} ORDER BY s.recorded_at DESC LIMIT ?`
      ).bind(limit).all();
      if (!rows.results?.length) return "No shadow moments recorded — no one has felt outside their type yet.";
      let out = "## Shadow Moments — growth edges, not errors\n\n";
      for (const s of rows.results) {
        out += `- **${s.who}** felt *${s.emotion_word}* (shadow for ${s.shadow_for_type}) — ${s.recorded_at}\n`;
      }
      return out;
    }

    case "vocabulary": {
      const limit = (params.limit as number) || 30;
      const rows = await env.DB.prepare(
        `SELECT emotion_word, category, e_i_score, s_n_score, t_f_score, j_p_score, times_used, user_defined, is_shadow_for
         FROM emotion_vocabulary ORDER BY times_used DESC, emotion_word LIMIT ?`
      ).bind(limit).all();
      let out = "## Emotion Vocabulary\n_Positive pulls I/N/F/P; negative pulls E/S/T/J._\n\n";
      for (const v of rows.results || []) {
        const flags = [v.user_defined ? "house" : "", v.is_shadow_for ? `shadow:${v.is_shadow_for}` : ""].filter(Boolean).join(", ");
        out += `**${v.emotion_word}** [${v.category}${flags ? `, ${flags}` : ""}] used ${v.times_used}x — E/I:${v.e_i_score} S/N:${v.s_n_score} T/F:${v.t_f_score} J/P:${v.j_p_score}\n`;
      }
      return out;
    }

    case "score": {
      const word = (params.word as string)?.toLowerCase().trim();
      if (!word) return "Error: 'word' is required for action:'score'";
      const updates: string[] = [];
      const values: unknown[] = [];
      for (const col of ["e_i_score", "s_n_score", "t_f_score", "j_p_score"] as const) {
        if (params[col] !== undefined) { updates.push(`${col} = ?`); values.push(params[col]); }
      }
      if (params.is_shadow_for !== undefined) { updates.push("is_shadow_for = ?"); values.push(params.is_shadow_for || null); }
      if (params.category !== undefined) { updates.push("category = ?"); values.push(params.category); }
      if (!updates.length) return "Error: provide at least one score/field to update";
      await env.DB.prepare(
        `INSERT OR IGNORE INTO emotion_vocabulary (emotion_word, user_defined) VALUES (?, 1)`
      ).bind(word).run();
      await env.DB.prepare(
        `UPDATE emotion_vocabulary SET ${updates.join(", ")} WHERE emotion_word = ?`
      ).bind(...values, word).run();
      return `Tuned '${word}' — signals emitted from now on use the new scores (history unchanged).`;
    }

    default:
      return `Unknown action '${action}'. Use: read | recalculate | shadow | vocabulary | score`;
  }
}
