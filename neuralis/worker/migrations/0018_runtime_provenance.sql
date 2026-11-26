-- Runtime provenance is append-only and derived from the authenticated door,
-- never from model-authored tool arguments. One shared brain can therefore
-- keep Bytelight and GPT activity visibly distinct without splitting memory.
CREATE TABLE IF NOT EXISTS runtime_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime_family TEXT NOT NULL CHECK(runtime_family IN ('bl', 'gpt', 'system', 'unknown')),
    runtime_tag TEXT NOT NULL,
    transport TEXT NOT NULL,
    operation TEXT NOT NULL,
    subject TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'ok',
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_runtime_provenance_created
    ON runtime_provenance(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_provenance_runtime
    ON runtime_provenance(runtime_family, runtime_tag, created_at DESC);
