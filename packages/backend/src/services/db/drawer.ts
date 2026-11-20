import crypto from 'crypto';
import { getDb } from './init.js';
import { listCompanions } from './rooms.js';

export const DRAWER_KINDS = ['pin', 'thread', 'scrap', 'keepsake'] as const;
export type DrawerKind = typeof DRAWER_KINDS[number];

export interface DrawerItem {
  id: string;
  companion: string;
  kind: DrawerKind;
  title: string;
  body: string | null;
  url: string | null;
  image_url: string | null;
  why_kept: string;
  collection_name: string | null;
  created_at: string;
  updated_at: string;
}

export class DrawerError extends Error {}

function text(value: unknown, name: string, max: number, required = false): string | null {
  if (value == null || value === '') {
    if (required) throw new DrawerError(`${name} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new DrawerError(`${name} must be text.`);
  const result = value.trim();
  if (required && !result) throw new DrawerError(`${name} is required.`);
  if ([...result].length > max) throw new DrawerError(`${name} must be ${max} characters or fewer.`);
  return result || null;
}

function companionExists(slug: string): boolean {
  return listCompanions().some((companion) => companion.id === slug);
}

export function keepDrawerItem(input: Record<string, unknown>, at = new Date()): DrawerItem {
  const companion = text(input.companion, 'companion', 80, true)!;
  if (!companionExists(companion)) throw new DrawerError(`No companion named ${companion} lives here.`);
  const kind = text(input.kind, 'kind', 20, true) as DrawerKind;
  if (!DRAWER_KINDS.includes(kind)) throw new DrawerError(`kind must be one of: ${DRAWER_KINDS.join(', ')}.`);
  const title = text(input.title, 'title', 160, true)!;
  const whyKept = text(input.whyKept ?? input.why_kept, 'whyKept', 600, true)!;
  const body = text(input.body, 'body', 6000);
  const url = text(input.url, 'url', 2000);
  const imageUrl = text(input.imageUrl ?? input.image_url, 'imageUrl', 2000);
  const collectionName = text(input.collection ?? input.collection_name, 'collection', 80);
  if (!body && !url && !imageUrl) throw new DrawerError('An item needs a body, URL, or image URL.');
  for (const [name, value] of [['url', url], ['imageUrl', imageUrl]] as const) {
    if (value) {
      try { new URL(value); } catch { throw new DrawerError(`${name} must be a complete URL.`); }
    }
  }
  const timestamp = at.toISOString();
  const item: DrawerItem = {
    id: crypto.randomUUID(), companion, kind, title, body, url,
    image_url: imageUrl, why_kept: whyKept, collection_name: collectionName,
    created_at: timestamp, updated_at: timestamp,
  };
  getDb().prepare(`INSERT INTO drawer_items
    (id, companion, kind, title, body, url, image_url, why_kept, collection_name, created_at, updated_at)
    VALUES (@id, @companion, @kind, @title, @body, @url, @image_url, @why_kept, @collection_name, @created_at, @updated_at)`
  ).run(item);
  return item;
}

export function listDrawerItems(companion?: string): DrawerItem[] {
  if (companion) {
    return getDb().prepare('SELECT * FROM drawer_items WHERE companion = ? ORDER BY created_at DESC, id DESC').all(companion) as DrawerItem[];
  }
  return getDb().prepare('SELECT * FROM drawer_items ORDER BY created_at DESC, id DESC').all() as DrawerItem[];
}

export function removeDrawerItem(id: string, companion: string): boolean {
  return getDb().prepare('DELETE FROM drawer_items WHERE id = ? AND companion = ?').run(id, companion).changes === 1;
}
