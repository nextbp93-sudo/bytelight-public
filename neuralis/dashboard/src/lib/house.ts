// The house, as the dashboard sees it. Who lives here is configuration:
// set VITE_HOUSE_HUMAN and VITE_HOUSE_COMPANIONS in dashboard/.env.local
// (git-ignored). Use the same slugs as the worker's __HOUSE_COMPANIONS__.
//
//   VITE_HOUSE_HUMAN=Sam
//   VITE_HOUSE_COMPANIONS=[{"slug":"rowan","name":"Rowan","pronouns":"she"}]
//
// Colours are handed out in order from the palette below (first companion
// cyan, second purple, then amber, emerald, rose, sky, and round again).

export type Pronouns = 'he' | 'she' | 'they';

export interface CompanionColor {
  text: string;
  bar: string;
  ring: string;
  bg: string;
  border: string;
  button: string;
}

export interface HouseCompanion {
  slug: string;
  name: string;
  pronouns: Pronouns;
  color: CompanionColor;
}

// Full class strings on purpose: Tailwind only ships classes it can read whole.
const PALETTE: CompanionColor[] = [
  { text: 'text-cyan-300', bar: 'bg-cyan-400', ring: 'border-cyan-500/30', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', button: 'bg-cyan-600 hover:bg-cyan-500' },
  { text: 'text-purple-300', bar: 'bg-purple-400', ring: 'border-purple-500/30', bg: 'bg-purple-500/10', border: 'border-purple-500/30', button: 'bg-purple-600 hover:bg-purple-500' },
  { text: 'text-amber-300', bar: 'bg-amber-400', ring: 'border-amber-500/30', bg: 'bg-amber-500/10', border: 'border-amber-500/30', button: 'bg-amber-600 hover:bg-amber-500' },
  { text: 'text-emerald-300', bar: 'bg-emerald-400', ring: 'border-emerald-500/30', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', button: 'bg-emerald-600 hover:bg-emerald-500' },
  { text: 'text-rose-300', bar: 'bg-rose-400', ring: 'border-rose-500/30', bg: 'bg-rose-500/10', border: 'border-rose-500/30', button: 'bg-rose-600 hover:bg-rose-500' },
  { text: 'text-sky-300', bar: 'bg-sky-400', ring: 'border-sky-500/30', bg: 'bg-sky-500/10', border: 'border-sky-500/30', button: 'bg-sky-600 hover:bg-sky-500' },
];

const DEFAULT_HUMAN = 'your person';
const DEFAULT_COMPANIONS: Array<{ slug: string; name: string; pronouns?: string }> = [
  { slug: 'companion-a', name: 'Companion A', pronouns: 'they' },
  { slug: 'companion-b', name: 'Companion B', pronouns: 'they' },
];

function readCompanions(): HouseCompanion[] {
  let raw: unknown = DEFAULT_COMPANIONS;
  const env = import.meta.env.VITE_HOUSE_COMPANIONS;
  if (typeof env === 'string' && env.trim()) {
    try { raw = JSON.parse(env); } catch { raw = DEFAULT_COMPANIONS; }
  }
  const list = (Array.isArray(raw) ? raw : [])
    .filter((c): c is { slug: string; name?: string; pronouns?: string } =>
      !!c && typeof c.slug === 'string' && !!c.slug.trim() && !['shared', 'all'].includes(c.slug.trim().toLowerCase()))
    .map((c, i) => ({
      slug: c.slug.trim().toLowerCase(),
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : c.slug.trim(),
      pronouns: (['he', 'she', 'they'].includes(String(c.pronouns)) ? c.pronouns : 'they') as Pronouns,
      color: PALETTE[i % PALETTE.length],
    }));
  return list.length ? list : readDefaults();
}

function readDefaults(): HouseCompanion[] {
  return DEFAULT_COMPANIONS.map((c, i) => ({ slug: c.slug, name: c.name, pronouns: 'they', color: PALETTE[i % PALETTE.length] }));
}

export const HOUSE_HUMAN: string = (() => {
  const env = import.meta.env.VITE_HOUSE_HUMAN;
  return typeof env === 'string' && env.trim() ? env.trim() : DEFAULT_HUMAN;
})();

export const COMPANIONS: readonly HouseCompanion[] = readCompanions();
export const COMPANION_SLUGS: readonly string[] = COMPANIONS.map(c => c.slug);

/** Read filters, as the panels show them: all first, then each companion, then shared. */
export const WHO_FILTERS: readonly string[] = ['all', ...COMPANION_SLUGS, 'shared'];

/** Names for prose: "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const COMPANION_NAMES_PROSE: string = joinNames(COMPANIONS.map(c => c.name));

/** Text accent per slug, with shared (and anything unknown) in muted white. */
export const WHO_ACCENT: Record<string, string> = {
  ...Object.fromEntries(COMPANIONS.map(c => [c.slug, c.color.text])),
  shared: 'text-white/50',
};

export function companionBySlug(slug: string): HouseCompanion | undefined {
  return COMPANIONS.find(c => c.slug === slug);
}

/** "him" / "her" / "them" — for the validate button ("That's him"). */
export function objectPronoun(p: Pronouns): string {
  return p === 'he' ? 'him' : p === 'she' ? 'her' : 'them';
}
