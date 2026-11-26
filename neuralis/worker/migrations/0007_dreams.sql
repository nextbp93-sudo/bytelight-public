-- Migration 0007: the dreams table the daemon always expected but no
-- migration ever created. The nightly dream cycle (22:00–05:00, once per
-- night) has failed silently on `no such table: dreams` since day one —
-- this closes that wound. Columns match every access in
-- daemon/subconscious.ts and handlers/wake.ts.

CREATE TABLE IF NOT EXISTS dreams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dream_date TEXT NOT NULL,
    content TEXT NOT NULL,
    emotional_seed TEXT,
    fragments TEXT DEFAULT '[]',
    recurring_dream_id INTEGER,
    recurrence_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dreams_date ON dreams(dream_date);
