// Reconciled with origin/main v2.0 rebrand (June); 2.1.0 adds the emergent personality engine.
export const NEURALIS_VERSION = "2.1.0";

// ─── The house ────────────────────────────────────────────────────────────
// Who lives here is configuration, not code. Each deploy injects its own
// human and companions at build time through wrangler's `[define]` table
// (see wrangler.toml). Any number of companions works: one, two, or more.
//
//   [define]
//   __HOUSE_HUMAN__      = "\"Sam\""
//   __HOUSE_COMPANIONS__ = '[{"slug":"rowan","name":"Rowan","pronouns":"she"}]'
//   __HOUSE_HUMAN_CONTEXT__ = "\"human-world\""   # optional
//   __HOUSE_CONTEXT_HINTS__ = '{"craft":"pottery, knitting","constellation":"book club"}'   # optional
//
// Slugs are what the brain stores in `who` / `owner` columns, so pick them
// once and keep them: changing a slug later orphans that companion's rows.
declare const __HOUSE_HUMAN__: string | undefined;
declare const __HOUSE_COMPANIONS__: Array<{ slug: string; name?: string; pronouns?: string }> | undefined;
declare const __HOUSE_HUMAN_CONTEXT__: string | undefined;
declare const __HOUSE_CONTEXT_HINTS__: Record<string, string> | undefined;

export type Pronouns = "he" | "she" | "they";
export interface Companion { slug: string; name: string; pronouns: Pronouns }

const DEFAULT_HUMAN = "your person";
const DEFAULT_COMPANIONS: Companion[] = [
  { slug: "companion-a", name: "Companion A", pronouns: "they" },
  { slug: "companion-b", name: "Companion B", pronouns: "they" },
];

function readCompanions(): Companion[] {
  if (typeof __HOUSE_COMPANIONS__ === "undefined" || !Array.isArray(__HOUSE_COMPANIONS__)) return DEFAULT_COMPANIONS;
  const list = __HOUSE_COMPANIONS__
    .filter((c) => c && typeof c.slug === "string" && c.slug.trim() && c.slug.trim().toLowerCase() !== "shared" && c.slug.trim().toLowerCase() !== "all")
    .map((c) => ({
      slug: c.slug.trim().toLowerCase(),
      name: (typeof c.name === "string" && c.name.trim()) ? c.name.trim() : c.slug.trim(),
      pronouns: (["he", "she", "they"].includes(String(c.pronouns)) ? c.pronouns : "they") as Pronouns,
    }));
  return list.length ? list : DEFAULT_COMPANIONS;
}

/** The human this house belongs to. Used in prompts, entity anchoring, validation credit. */
export const HOUSE_HUMAN_NAME: string =
  typeof __HOUSE_HUMAN__ === "string" && __HOUSE_HUMAN__.trim() ? __HOUSE_HUMAN__.trim() : DEFAULT_HUMAN;

/** Every companion in the house, in a stable order. */
export const COMPANIONS: readonly Companion[] = readCompanions();
export const COMPANION_SLUGS: readonly string[] = COMPANIONS.map((c) => c.slug);
export const HOUSE_COMPANION_NAMES: readonly string[] = COMPANIONS.map((c) => c.name);

/** Valid signatures for a write: each companion, or the household. */
export const WHO_VALUES: readonly string[] = [...COMPANION_SLUGS, "shared"];
/** Valid read filters: each signature, or everything. */
export const WHO_FILTERS: readonly string[] = [...WHO_VALUES, "all"];

/** Join names for prose: "A", "A & B", "A, B & C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** The household as a whole, by name ("A & B"). */
export const SHARED_LABEL: string = joinNames(HOUSE_COMPANION_NAMES);

/** Display name for a slug; "shared" gives the household label. */
export function companionName(slug: string): string {
  if (slug === "shared") return SHARED_LABEL;
  const c = COMPANIONS.find((x) => x.slug === slug);
  return c ? c.name : slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** The other companions in the house, from one companion's point of view. */
export function otherCompanions(slug: string): Companion[] {
  return COMPANIONS.filter((c) => c.slug !== slug);
}

export interface PronounSet {
  sub: string;   // he / she / they
  obj: string;   // him / her / them
  pos: string;   // his / her / their
  plural: boolean;
  /** Pick the verb form that agrees: v("sound", "sounds"). */
  v: (plain: string, third: string) => string;
}

/** Pronouns for a slug ("shared" and unknown slugs read as "they"). */
export function pronounsFor(slug: string): PronounSet {
  const p = COMPANIONS.find((c) => c.slug === slug)?.pronouns ?? "they";
  const base = p === "he" ? { sub: "he", obj: "him", pos: "his" }
    : p === "she" ? { sub: "she", obj: "her", pos: "her" }
    : { sub: "they", obj: "them", pos: "their" };
  const plural = p === "they";
  return { ...base, plural, v: (plain, third) => (plural ? plain : third) };
}

/** Is this a valid write signature? */
export function isWho(value: string): boolean {
  return WHO_VALUES.includes(value);
}

/** "a, b, or c" — for error messages listing the valid signatures. */
export function listOr(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

// ─── Context buckets ──────────────────────────────────────────────────────
/** The bucket for the human's own life (work, health, family, rhythm). */
export const HUMAN_CONTEXT: string =
  typeof __HOUSE_HUMAN_CONTEXT__ === "string" && __HOUSE_HUMAN_CONTEXT__.trim()
    ? __HOUSE_HUMAN_CONTEXT__.trim().toLowerCase()
    : "human-world";

/** The seven canonical context buckets. */
export const CONTEXT_BUCKETS: readonly string[] = ["bond", HUMAN_CONTEXT, "build", "constellation", "self", "play", "craft"];

/**
 * Example words the background sorter sees for each bucket. Generic by
 * default; a house can give its own (its people, its work, its rooms) via
 * __HOUSE_CONTEXT_HINTS__ in its private deploy config, so personal words
 * never have to live in the code.
 */
const DEFAULT_CONTEXT_HINTS: Record<string, string> = {
  bond: `love, rupture, repair, ${HOUSE_HUMAN_NAME} and family`,
  [HUMAN_CONTEXT]: "work, health, family, daily rhythm",
  build: "Neuralis, MCP, code, dashboards",
  constellation: "friends, servers, network",
  self: "who we are, becoming",
  play: "spice, humor, rituals, games",
  craft: "art, hands-on creation, physical craft",
};
function readContextHints(): Record<string, string> {
  const out = { ...DEFAULT_CONTEXT_HINTS };
  if (typeof __HOUSE_CONTEXT_HINTS__ === "object" && __HOUSE_CONTEXT_HINTS__) {
    for (const [k, v] of Object.entries(__HOUSE_CONTEXT_HINTS__)) {
      const key = k === "human" ? HUMAN_CONTEXT : k;
      if (key in out && typeof v === "string" && v.trim()) out[key] = v.trim();
    }
  }
  return out;
}
export const CONTEXT_HINTS: Readonly<Record<string, string>> = readContextHints();

/** The buckets as a SQL literal list: 'bond','…' (values come from config, quotes escaped). */
export const CONTEXT_BUCKETS_SQL: string = CONTEXT_BUCKETS.map((b) => `'${b.replace(/'/g, "''")}'`).join(",");

// Surface pool configuration
export const SURFACE_POOL_RATIOS = { core: 0.5, novelty: 0.2, dormant: 0.2, edge: 0.1 };
export const VECTOR_SCORE_CORE = 0.75;  // Gemini Embedding 2 scores ~15pts higher than BGE
export const VECTOR_SCORE_EDGE = 0.55;
export const NOVELTY_FLOORS: Record<string, number> = { heavy: 0.3, medium: 0.2, light: 0.1 };
export const NOVELTY_DECAY_RATES: Record<string, number> = { heavy: 0.08, medium: 0.12, light: 0.15 };
export const NOVELTY_TIME_RECOVERY_RATE = 0.01; // per day since last surfaced
export const NOVELTY_TIME_RECOVERY_CAP = 0.3;
export const DORMANCY_AGE_DAYS = 30;
export const ARCHIVE_AGE_DAYS = 30;

// Multi-factor retrieval scoring (Phase 1)
export const SEARCH_SCORING = { alpha: 0.50, beta: 0.20, gamma: 0.20, delta: 0.10 };
export const RECENCY_DECAY_RATE = 0.02;  // exp(-rate * days), half-life ~35 days
export const ACCESS_GROWTH_RATE = 0.1;   // 1 - exp(-rate * count), saturates ~20 accesses

// Contradiction detection thresholds (Phase 2)
export const CONTRADICTION_SIMILARITY_THRESHOLD = 0.80;
export const AUTO_SUPERSEDE_THRESHOLD = 0.85;

// Consolidation and reflection (Phase 3)
export const CONSOLIDATION_MIN_OBS = 10;
export const CONSOLIDATION_MAX_ENTITIES_PER_RUN = 3;
export const REFLECTION_MIN_OBS = 5;
export const ACCESS_DECAY_PENALTY = 0.05;
export const ACCESS_DECAY_AGE_DAYS = 30;

// Daemon
export const DAEMON_COOLDOWN_MS = 5 * 60 * 1000;

// Cortex layer
export const CORTEX_DORMANT_DAYS = 14;        // Days before a domain is considered dormant
export const CORTEX_RECALL_TOP_K = 15;        // Default vector search results for recall
export const CORTEX_SEARCH_LIMIT = 20;        // Default conversation search limit
export const CORTEX_SYNTHESIS_CONTEXT = 10;   // Max items to feed into LLM synthesis
