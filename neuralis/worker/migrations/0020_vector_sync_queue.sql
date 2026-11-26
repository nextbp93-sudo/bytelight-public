-- Memory writes must survive a temporary Workers AI or Vectorize outage.
-- Failed text-vector sidecars wait here and are retried by the heartbeat.
CREATE TABLE IF NOT EXISTS vector_sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vector_id TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    source_id TEXT,
    text_content TEXT NOT NULL,
    metadata TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vector_sync_queue_created
    ON vector_sync_queue(created_at);
