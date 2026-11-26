import { getProfiles } from '../bytelight/profiles';

// One companion row, whichever backend wrote it.
//
// Main's /api/companions and /api/threads/:id/roster answer with
// {id, display_name, avatar, brain, model, sort_order, created_at}. The phone
// was built against rows carrying slug / avatar_url / color / emoji. Main's id
// already IS the slug ('companion-a', 'companion-b', 'companion-c' — migrations/014_companions.sql),
// so every screen that lists companions reads them through this one seam rather
// than each learning main's field names separately.

export interface CompanionRowFields {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  color: string | null;
  emoji: string | null;
}

export function normalizeCompanionRow<T extends Record<string, unknown>>(row: T): T & CompanionRowFields {
  const id = String(row.id ?? row.slug ?? '');
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const slug = str(row.slug) ?? id;
  // Main's live profile for this identity (photo + emoji), when it has been
  // read; the row's own avatar is the seeded copy and only a fallback.
  const profile = getProfiles()?.[slug] ?? null;
  return {
    ...row,
    id,
    slug,
    display_name: str(row.display_name) ?? id,
    avatar_url: profile?.image || str(row.avatar_url) || str(row.avatar),
    color: str(row.color),
    emoji: profile?.emoji || str(row.emoji),
  };
}

export function normalizeCompanionRows(rows: unknown): Array<Record<string, unknown> & CompanionRowFields> {
  return Array.isArray(rows) ? rows.map((r) => normalizeCompanionRow(r as Record<string, unknown>)) : [];
}

/**
 * True when a companion row is still an unconfigured software placeholder slot
 * (Companion B / Companion C with no custom name or avatar).
 */
export function isDormantCompanionSlot(row: { id?: unknown; slug?: unknown; display_name?: unknown; avatar?: unknown; avatar_url?: unknown }): boolean {
  const slug = String(row.slug ?? row.id ?? '').trim();
  const name = String(row.display_name ?? '').trim();
  const defaultName = slug === 'companion-b'
    ? 'Companion B'
    : slug === 'companion-c'
      ? 'Companion C'
      : null;
  if (!defaultName || (name && name !== defaultName)) return false;

  // The original database seed gives Companion B a stock avatar even when the
  // slot has never been inhabited. Treat the live speaker profile as the
  // source of truth: a custom profile photo makes the slot real; the seeded
  // registry avatar alone does not. This keeps an unused B out of rosters and
  // the model pill without preventing someone from configuring the slot later.
  const profile = getProfiles()?.[slug];
  if (profile?.image) return false;
  return true;
}

export function filterInhabitedCompanions<T extends { id?: unknown; slug?: unknown; display_name?: unknown; avatar?: unknown; avatar_url?: unknown }>(rows: T[]): T[] {
  const inhabited = rows.filter((r) => !isDormantCompanionSlot(r));
  return inhabited.length > 0 ? inhabited : rows;
}

