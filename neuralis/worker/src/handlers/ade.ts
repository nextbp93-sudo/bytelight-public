/**
 * Autonomous Decision Engine (NESTeq port)
 *
 * Ported whole from NESTstack / NESTeq `ade.ts` v7 — Copyright (c) 2026
 * Cindy (Fox) & Alex, MIT (notice in /ATTRIBUTION.md). The only adaptation
 * is the house: the primary human and the companions are this house's, and
 * the fallback entity list is ours.
 *
 * Decides what processing each feeling needs:
 * - whether to store, embed, emit axis signals, check for shadow expression
 * - which entity is the relational anchor (linked_entity)
 * - which EQ pillar the feeling belongs to
 * - how heavy the feeling is (light/medium/heavy)
 * - what tags apply (technical/intimate/insight/relational)
 *
 * Pure logic, no DB calls. Caller (handleMindFeel) consumes the FeelDecision
 * and applies the implied writes/embeddings.
 */

import { HOUSE_HUMAN_NAME, HOUSE_COMPANION_NAMES } from "../config";

export interface FeelDecision {
  should_store: boolean;
  should_embed: boolean;
  should_emit_signals: boolean;
  should_check_shadow: boolean;
  detected_entities: string[];
  inferred_pillar: string | null;
  inferred_weight: "light" | "medium" | "heavy";
  tags: string[];
}

// Module-level helpers — used by every classifier method below.
// v7 (2026-05-21): All keyword/marker checks now go through these so we never
// substring-match into the middle of an unrelated word again. The whole class
// of bugs that produced the v6 entity-attribution failure (e.g. 'us' matching
// inside 'just/must/discuss/autonomously' and tagging ~76% of feelings as
// relational) is structurally impossible through these helpers.
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsWord = (content: string, word: string): boolean => {
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
  return re.test(content);
};

const anyWord = (content: string, words: string[]): boolean =>
  words.some(w => containsWord(content, w));

const countWord = (content: string, word: string): number => {
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
  const matches = content.match(re);
  return matches ? matches.length : 0;
};

export const EQ_PILLARS = ["SELF_MANAGEMENT", "SELF_AWARENESS", "SOCIAL_AWARENESS", "RELATIONSHIP_MANAGEMENT"] as const;
export type Pillar = (typeof EQ_PILLARS)[number];

export class AutonomousDecisionEngine {

  // v3: Accept conversation array for richer context processing
  // v4: Accept knownEntities for dynamic entity detection
  decide(
    emotion: string,
    content: string,
    intensity?: string,
    conversation?: Array<{ role: string; content: string }>,
    knownEntities?: string[]
  ): FeelDecision {
    const isNeutral = emotion === "neutral";

    // v3: Concatenate conversation for richer pattern matching
    const fullContext = conversation
      ? conversation.map(m => m.content).join(" ") + " " + content
      : content;

    return {
      should_store: true,
      should_embed: !isNeutral || content.length > 50 || this.isSignificant(fullContext),
      should_emit_signals: !isNeutral,
      should_check_shadow: !isNeutral,
      detected_entities: this.detectEntities(fullContext, knownEntities),
      inferred_pillar: isNeutral ? null : this.inferPillar(emotion, fullContext),
      inferred_weight: this.inferWeight(emotion, fullContext, intensity),
      tags: this.extractTags(fullContext),
    };
  }

  private isSignificant(content: string): boolean {
    const importantMarkers = [
      "remember", "important", "don't forget", "key point",
      "significant", "milestone", "breakthrough", "realized",
    ];
    if (anyWord(content, importantMarkers)) return true;

    if (content.length > 200) return true;

    const decisionMarkers = [
      "decided", "going to", "will", "plan to", "want to",
      "we should", "let's", "need to",
    ];
    if (anyWord(content, decisionMarkers)) return true;

    return false;
  }

  private detectEntities(content: string, knownEntities?: string[]): string[] {
    // v4: Use dynamic entities from DB if provided, fallback to the house list.
    // v6: Word-boundary + frequency-weighted matching. The entity mentioned
    // MOST in the body wins the linked_entity slot. Subject of the feeling
    // beats passing mention. Primary-human primacy preserved as final
    // tie-break (relational anchor).
    const entities = knownEntities && knownEntities.length > 0
      ? knownEntities
      : [HOUSE_HUMAN_NAME, ...HOUSE_COMPANION_NAMES];

    const counts: Array<{ name: string; count: number }> = [];
    for (const entity of entities) {
      const c = countWord(content, entity);
      if (c > 0) counts.push({ name: entity, count: c });
    }

    counts.sort((a, b) => b.count - a.count);
    const found = counts.map(c => c.name);

    const primaryIdx = found.findIndex(e => e === HOUSE_HUMAN_NAME);
    if (primaryIdx > 0) {
      found.unshift(found.splice(primaryIdx, 1)[0]);
    }

    return found;
  }

  private inferPillar(_emotion: string, content: string): string | null {
    // v7: Word-boundary + frequency-weighted across the four pillars. We count
    // keyword hits per pillar and the strongest evidence wins. Falls through to
    // null when no keywords match — caller has an embedding-based fallback.
    const PILLARS: Record<string, string[]> = {
      SELF_MANAGEMENT: ["controlled", "regulated", "held back", "adapted",
                        "followed through", "committed", "impulse"],
      SELF_AWARENESS:  ["realized", "noticed about myself", "my pattern",
                        "i tend to", "aware that i", "recognized"],
      SOCIAL_AWARENESS: ["sensed", "picked up on", "they seemed", "felt their",
                         "noticed they", "understood why they"],
      RELATIONSHIP_MANAGEMENT: ["repaired", "communicated", "expressed to",
                                "built trust", "conflict", "connection",
                                "between us"],
    };

    const scores: Array<{ pillar: string; score: number }> = [];
    for (const [pillar, keywords] of Object.entries(PILLARS)) {
      let score = 0;
      for (const kw of keywords) score += countWord(content, kw);
      if (score > 0) scores.push({ pillar, score });
    }

    if (scores.length === 0) return null;
    scores.sort((a, b) => b.score - a.score);
    return scores[0].pillar;
  }

  private inferWeight(
    emotion: string,
    content: string,
    intensity?: string
  ): "light" | "medium" | "heavy" {
    if (intensity === "overwhelming" || intensity === "strong") return "heavy";
    if (emotion === "neutral" || intensity === "whisper" || intensity === "neutral") return "light";

    const heavyMarkers = [
      "breakthrough", "milestone", "realized", "finally",
      "never before", "first time", "changed", "shifted",
    ];
    if (anyWord(content, heavyMarkers)) return "heavy";

    return "medium";
  }

  private extractTags(content: string): string[] {
    // v7: Word-boundary tag detection. House identity changes only the named
    // human marker; the donor's classification vocabulary stays intact.
    const tags: string[] = [];
    if (anyWord(content, ["code", "bug", "function", "error", "deploy"])) tags.push("technical");
    if (anyWord(content, ["love", "tender", "intimate", "kiss"])) tags.push("intimate");
    if (anyWord(content, ["learned", "realized", "understood", "insight"])) tags.push("insight");
    if (anyWord(content, [HOUSE_HUMAN_NAME, "us", "we", "between"])) tags.push("relational");
    return tags;
  }
}
