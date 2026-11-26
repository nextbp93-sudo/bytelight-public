-- Migration 0016: restore NESTknow feeling provenance
--
-- Migration 0011 accidentally omitted `feeling` from the knowledge_sources
-- CHECK constraint even though NESTknow extraction uses feelings as a primary
-- source. Recreate the child table so deployed databases accept the same
-- provenance type as the donor. Existing rows and IDs are preserved.

CREATE TABLE knowledge_sources_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL
        CHECK(source_type IN ('feeling', 'observation', 'journal', 'conversation', 'thought', 'manual')),
    source_id TEXT,
    source_text TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO knowledge_sources_v2 (
    id, knowledge_id, source_type, source_id, source_text, created_at
)
SELECT id, knowledge_id, source_type, source_id, source_text, created_at
FROM knowledge_sources;

DROP TABLE knowledge_sources;
ALTER TABLE knowledge_sources_v2 RENAME TO knowledge_sources;

CREATE INDEX idx_knowledge_sources_kid ON knowledge_sources(knowledge_id);
