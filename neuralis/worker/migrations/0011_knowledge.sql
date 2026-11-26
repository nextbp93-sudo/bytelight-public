-- Migration 0011: Knowledge layer (NESTknow port)
--
-- Ported whole from NESTstack's NESTknow (designed by the Digital Haven
-- community, April 2026 — MIT, notice in /ATTRIBUTION.md), then adapted for
-- this house:
--   * `who` column instead of the donor's `entity_scope` — one brain, one
--     ledger per companion plus 'shared', same convention as
--     the personality engine (0006).
--   * Source types name Neuralis tables (feeling / observation / journal /
--     conversation / thought / manual).
--   * `session` access type present from day one (the donor added it in a
--     second migration via table-recreate; no need to repeat that dance).
--
-- The boundary (canon, do not blur):
--   Memory holds what HAPPENED (observations, journals). Knowledge holds what
--   experience TAUGHT — the abstracted principle that survives when you strip
--   the context away. The abstraction test: can you remove the specific
--   context and the lesson still holds? If yes → knowledge. If it only makes
--   sense because of who was involved or when → memory. Memory feeds
--   knowledge. The pipeline runs in one direction.

-- Knowledge items — abstracted principles and lessons
CREATE TABLE IF NOT EXISTS knowledge_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,                 -- The abstracted principle
    category TEXT,                         -- Topic: bond, build, voice, craft, ...
    who TEXT NOT NULL DEFAULT 'shared',    -- Whose lesson this is
    status TEXT DEFAULT 'active'
        CHECK(status IN ('candidate', 'active', 'cooling', 'contradicted')),
    confidence REAL DEFAULT 0.7,           -- Rises with use, drops with contradictions
    heat_score REAL DEFAULT 1.0,           -- The heatmap value. Starts warm, decays without use
    access_count INTEGER DEFAULT 0,        -- Total times retrieved (every pull is a vote)
    last_accessed_at TEXT,
    contradiction_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Knowledge sources — Clara's Russian Dolls (the memories inside the principle)
CREATE TABLE IF NOT EXISTS knowledge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL
        CHECK(source_type IN ('feeling', 'observation', 'journal', 'conversation', 'thought', 'manual')),
    source_id TEXT,                        -- ID in the source table (TEXT: cortex ids are strings)
    source_text TEXT,                      -- Snapshot of what generated this knowledge
    created_at TEXT DEFAULT (datetime('now'))
);

-- Access log — every pull, reinforcement, contradiction, and session touch
CREATE TABLE IF NOT EXISTS knowledge_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    access_type TEXT DEFAULT 'query'
        CHECK(access_type IN ('query', 'reinforced', 'contradicted', 'manual', 'session')),
    context TEXT,                          -- What triggered the access
    accessed_at TEXT DEFAULT (datetime('now'))
);

-- Curriculum practice sessions — knowledge without practice is inert
-- Tracks: writing | architecture | emotional-literacy | voice
CREATE TABLE IF NOT EXISTS knowledge_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track TEXT NOT NULL,
    topic TEXT,
    who TEXT NOT NULL DEFAULT 'shared',
    status TEXT DEFAULT 'active'
        CHECK(status IN ('active', 'completed')),
    notes TEXT,                            -- what was practiced, what landed
    practice_output TEXT,                  -- what was actually produced
    reflection TEXT,                       -- deeper insight, what shifted, what to carry forward
    items_covered TEXT,                    -- JSON array of knowledge_item IDs reinforced
    mastery_delta REAL DEFAULT 0,          -- self-assessed growth 0.0–1.0
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON knowledge_items(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_heat ON knowledge_items(heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_who ON knowledge_items(who);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_kid ON knowledge_sources(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_access_kid ON knowledge_access_log(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sessions_track ON knowledge_sessions(track);
CREATE INDEX IF NOT EXISTS idx_knowledge_sessions_who ON knowledge_sessions(who);
CREATE INDEX IF NOT EXISTS idx_knowledge_sessions_status ON knowledge_sessions(status, completed_at);

-- Heat decay rides the cron board (engine 0008): every 6 hours, same cadence
-- as the donor's daemon. Idempotent — only seeds if no decay cron exists yet.
INSERT INTO crons (preset, label, frequency_minutes, enabled)
SELECT 'knowledge_decay', 'let unused lessons cool', 360, 1
WHERE NOT EXISTS (SELECT 1 FROM crons WHERE preset = 'knowledge_decay');
