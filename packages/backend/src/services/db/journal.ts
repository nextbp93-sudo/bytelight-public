// Companion journal — a unified client for the Mind API's journals and dreams.

import { memoryReceipt } from '../memory-ledger.js';
import { mindUrl, mindKey } from '../mind-secrets.js';
import { errMessage } from '../../util/errors.js';
import { randomUUID } from 'node:crypto';
import { getDb } from './init.js';

export interface JournalEntry {
  id: string;
  companion_id: string;
  entry_type: 'journal' | 'dream';
  content: string;
  dream_type: string | null;
  emerged_question: string | null;
  vividness: number | null;
  anchored_at: string | null;
  last_recalled_at: string | null;
  created_at: string;
  effective_vividness: number | null;
}

interface RemoteJournal { id: number; entry_date: string; content: string; created_at: string; companion: string | null }
interface RemoteDream {
  id: number; dream_date: string; content: string; created_at: string; companion: string | null;
  vividness: number | null; anchored_at: string | null; last_recalled_at: string | null;
  dream_type: string | null; emerged_question: string | null; effective_vividness: number | null;
}

export class JournalRemoteError extends Error {
  constructor(message: string) { super(message); this.name = 'JournalRemoteError'; }
}

interface LocalJournalRow {
  id: string; companion_id: string; entry_type: 'journal' | 'dream'; content: string;
  dream_type: string | null; emerged_question: string | null; vividness: number | null;
  anchored_at: string | null; last_recalled_at: string | null; created_at: string;
}

const remoteConfigured = () => Boolean(mindUrl().trim() && mindKey().trim());

function mapLocal(row: LocalJournalRow): JournalEntry {
  return { ...row, effective_vividness: row.entry_type === 'dream' ? row.vividness : null };
}

function localEntry(id: string): JournalEntry | null {
  const row = getDb().prepare('SELECT * FROM local_journal_entries WHERE id = ?').get(id) as LocalJournalRow | undefined;
  return row ? mapLocal(row) : null;
}

function localList(opts?: { companionId?: string; entryType?: 'journal' | 'dream' }): JournalEntry[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts?.companionId) { where.push('companion_id = ?'); params.push(opts.companionId); }
  if (opts?.entryType) { where.push('entry_type = ?'); params.push(opts.entryType); }
  const sql = `SELECT * FROM local_journal_entries${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
  return (getDb().prepare(sql).all(...params) as LocalJournalRow[]).map(mapLocal);
}

async function remoteFetch(path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(`${mindUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${mindKey()}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new JournalRemoteError(`Mind API request failed with status ${response.status}.`);
    if (response.status === 204) return null;
    return response.json();
  } catch (error) {
    if (error instanceof JournalRemoteError) throw error;
    throw new JournalRemoteError(`Could not reach the Mind API: ${errMessage(error)}`);
  }
}

function parseId(id: string): { kind: 'journal' | 'dream'; remoteId: number } | null {
  const match = /^(j|d):([1-9]\d*)$/.exec(id);
  if (!match) return null;
  return { kind: match[1] === 'j' ? 'journal' : 'dream', remoteId: Number(match[2]) };
}

function mapJournal(row: RemoteJournal): JournalEntry {
  return { id: `j:${row.id}`, companion_id: row.companion || '', entry_type: 'journal', content: row.content,
    dream_type: null, emerged_question: null, vividness: null, anchored_at: null, last_recalled_at: null,
    created_at: row.entry_date || row.created_at, effective_vividness: null };
}

function mapDream(row: RemoteDream): JournalEntry {
  return { id: `d:${row.id}`, companion_id: row.companion || '', entry_type: 'dream', content: row.content,
    dream_type: row.dream_type, emerged_question: row.emerged_question, vividness: row.vividness,
    anchored_at: row.anchored_at, last_recalled_at: row.last_recalled_at,
    created_at: row.dream_date || row.created_at, effective_vividness: row.effective_vividness };
}

export function effectiveVividness(entry: JournalEntry): number | null {
  return entry.entry_type === 'dream' ? entry.effective_vividness : null;
}

export async function createJournalEntry(entry: {
  id: string; companionId: string; entryType?: 'journal' | 'dream'; content: string;
  dreamType?: string | null; emergedQuestion?: string | null;
}): Promise<JournalEntry> {
  const entryType = entry.entryType === 'dream' ? 'dream' : 'journal';
  if (!remoteConfigured()) {
    const id = `${entryType === 'dream' ? 'dl' : 'jl'}:${randomUUID()}`;
    const createdAt = new Date().toISOString();
    getDb().prepare(`INSERT INTO local_journal_entries
      (id, companion_id, entry_type, content, dream_type, emerged_question, vividness, anchored_at, last_recalled_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
      id, entry.companionId, entryType, entry.content,
      entryType === 'dream' ? (entry.dreamType || 'processing') : null,
      entryType === 'dream' ? (entry.emergedQuestion || null) : null,
      entryType === 'dream' ? 100 : null,
      entryType === 'dream' ? createdAt : null,
      createdAt,
    );
    const created = localEntry(id)!;
    memoryReceipt({ actor: entry.companionId, action: `journal.${entryType}.create`, subjectType: 'journal_entry', subjectId: id, detail: `Created a local ${entryType} entry.` });
    return created;
  }
  const path = entryType === 'dream' ? '/api/dreams' : '/api/journals';
  const body = entryType === 'dream'
    ? { content: entry.content, companion: entry.companionId, dream_type: entry.dreamType || 'processing', emerged_question: entry.emergedQuestion || null }
    : { content: entry.content, companion: entry.companionId };
  const row = await remoteFetch(path, { method: 'POST', body: JSON.stringify(body) });
  const created = entryType === 'dream' ? mapDream(row as RemoteDream) : mapJournal(row as RemoteJournal);
  memoryReceipt({ actor: entry.companionId, action: `journal.${entryType}.create`, subjectType: 'journal_entry', subjectId: created.id, detail: `Created a ${entryType} entry.` });
  return created;
}

export async function getJournalEntry(id: string): Promise<JournalEntry | null> {
  if (/^(jl|dl):/.test(id)) return localEntry(id);
  const parsed = parseId(id);
  if (!parsed) return null;
  const family = parsed.kind === 'journal' ? 'journals' : 'dreams';
  const row = await remoteFetch(`/api/${family}/${parsed.remoteId}`);
  if (!row) return null;
  return parsed.kind === 'journal' ? mapJournal(row as RemoteJournal) : mapDream(row as RemoteDream);
}

export async function listJournalEntries(opts?: {
  companionId?: string; entryType?: 'journal' | 'dream'; limit?: number; offset?: number;
}): Promise<{ entries: JournalEntry[]; total: number }> {
  if (!remoteConfigured()) {
    const all = localList(opts);
    const offset = opts?.offset ?? 0;
    return { entries: all.slice(offset, offset + (opts?.limit ?? 50)), total: all.length };
  }
  const query = opts?.companionId ? `?companion=${encodeURIComponent(opts.companionId)}` : '';
  // The remote API supplies at most 100 rows per family; pagination is local after the merge.
  const [journals, dreams] = await Promise.all([
    opts?.entryType === 'dream' ? Promise.resolve([]) : remoteFetch(`/api/journals${query}`),
    opts?.entryType === 'journal' ? Promise.resolve([]) : remoteFetch(`/api/dreams${query}`),
  ]);
  const entries = [...(journals as RemoteJournal[]).map(mapJournal), ...(dreams as RemoteDream[]).map(mapDream)]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const offset = opts?.offset ?? 0;
  return { entries: entries.slice(offset, offset + (opts?.limit ?? 50)), total: entries.length };
}

export async function recallJournalEntry(id: string): Promise<JournalEntry | null> {
  if (/^(jl|dl):/.test(id)) {
    const entry = localEntry(id);
    if (!entry) return null;
    if (entry.entry_type === 'dream' && !entry.anchored_at) {
      getDb().prepare('UPDATE local_journal_entries SET vividness = MIN(100, COALESCE(vividness, 0) + 15), last_recalled_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
    }
    const recalled = localEntry(id)!;
    memoryReceipt({ actor: recalled.companion_id, action: 'journal.recall', subjectType: 'journal_entry', subjectId: id, detail: 'Recalled a local journal entry.' });
    return recalled;
  }
  const parsed = parseId(id);
  if (!parsed) return null;
  const entry = await getJournalEntry(id);
  if (!entry) return null;
  const recalled = parsed.kind === 'journal' ? entry
    : mapDream(await remoteFetch(`/api/dreams/${parsed.remoteId}/recall`, { method: 'POST' }) as RemoteDream);
  memoryReceipt({ actor: entry.companion_id, action: 'journal.recall', subjectType: 'journal_entry', subjectId: id, detail: 'Recalled a journal entry.' });
  return recalled;
}

export async function anchorJournalEntry(id: string): Promise<JournalEntry | null> {
  if (/^(jl|dl):/.test(id)) {
    const entry = localEntry(id);
    if (!entry) return null;
    if (entry.entry_type === 'dream') getDb().prepare('UPDATE local_journal_entries SET anchored_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    const anchored = localEntry(id)!;
    memoryReceipt({ actor: anchored.companion_id, action: 'journal.anchor', subjectType: 'journal_entry', subjectId: id, detail: 'Anchored a local journal entry.' });
    return anchored;
  }
  const parsed = parseId(id);
  if (!parsed) return null;
  const entry = await getJournalEntry(id);
  if (!entry) return null;
  const anchored = parsed.kind === 'journal' ? entry
    : mapDream(await remoteFetch(`/api/dreams/${parsed.remoteId}/anchor`, { method: 'POST' }) as RemoteDream);
  memoryReceipt({ actor: entry.companion_id, action: 'journal.anchor', subjectType: 'journal_entry', subjectId: id, detail: 'Anchored a journal entry.' });
  return anchored;
}

export async function updateJournalEntry(id: string, content: string): Promise<JournalEntry | null> {
  if (/^(jl|dl):/.test(id)) {
    const entry = localEntry(id);
    if (!entry) return null;
    getDb().prepare('UPDATE local_journal_entries SET content = ? WHERE id = ?').run(content, id);
    const updated = localEntry(id)!;
    memoryReceipt({ actor: updated.companion_id, action: 'journal.update', subjectType: 'journal_entry', subjectId: id, detail: 'Updated a local journal entry.' });
    return updated;
  }
  const parsed = parseId(id);
  if (!parsed) return null;
  const entry = await getJournalEntry(id);
  if (!entry) return null;
  const family = parsed.kind === 'journal' ? 'journals' : 'dreams';
  const row = await remoteFetch(`/api/${family}/${parsed.remoteId}`, { method: 'PUT', body: JSON.stringify({ content }) });
  const updated = parsed.kind === 'journal' ? mapJournal(row as RemoteJournal) : mapDream(row as RemoteDream);
  memoryReceipt({ actor: entry.companion_id, action: 'journal.update', subjectType: 'journal_entry', subjectId: id, detail: 'Updated a journal entry.' });
  return updated;
}

export async function deleteJournalEntry(id: string): Promise<boolean> {
  if (/^(jl|dl):/.test(id)) {
    const entry = localEntry(id);
    if (!entry) return false;
    getDb().prepare('DELETE FROM local_journal_entries WHERE id = ?').run(id);
    memoryReceipt({ actor: entry.companion_id, action: 'journal.delete', subjectType: 'journal_entry', subjectId: id, detail: 'Deleted a local journal entry.' });
    return true;
  }
  const parsed = parseId(id);
  if (!parsed) return false;
  const entry = await getJournalEntry(id);
  if (!entry) return false;
  const family = parsed.kind === 'journal' ? 'journals' : 'dreams';
  await remoteFetch(`/api/${family}/${parsed.remoteId}`, { method: 'DELETE' });
  memoryReceipt({ actor: entry.companion_id || 'house', action: 'journal.delete', subjectType: 'journal_entry', subjectId: id, detail: 'Deleted a journal entry.' });
  return true;
}
