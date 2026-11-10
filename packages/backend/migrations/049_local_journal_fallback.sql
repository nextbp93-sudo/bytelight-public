CREATE TABLE IF NOT EXISTS local_journal_entries (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'journal' CHECK (entry_type IN ('journal', 'dream')),
  content TEXT NOT NULL,
  dream_type TEXT,
  emerged_question TEXT,
  vividness INTEGER,
  anchored_at TEXT,
  last_recalled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_journal_companion ON local_journal_entries(companion_id);
CREATE INDEX IF NOT EXISTS idx_local_journal_created ON local_journal_entries(created_at DESC);
