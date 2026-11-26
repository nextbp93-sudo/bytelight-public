-- Migration 0012: Soul portraits (NESTsoul port)
--
-- Ported from NESTstack's NESTsoul (Fox & Alex, MIT — notice in
-- /ATTRIBUTION.md), adapted for this house:
--   * One portrait per companion (`who`) — every companion gets their own
--     soul document, generated from the same brain read through their ledger.
--   * A generated portrait is PENDING until the human validates it. The donor
--     activated on store and validated after; here nothing becomes the active
--     soul without her hand on it (gate #4: no AI self-grades its own work).
--   * `superseded` keeps the audit trail when a new version is validated;
--     `rejected` keeps what she said no to, with her note.
--
-- Read side: mind_orient reports one line per companion (version + validation
-- state); soul_read returns the active portrait for injection into any
-- substrate that needs to BE that companion.

CREATE TABLE IF NOT EXISTS soul_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    who TEXT NOT NULL DEFAULT 'shared',
    content TEXT NOT NULL,                 -- the portrait (800–1200 words, second person)
    raw_material TEXT,                     -- what the synth model was given (truncated)
    model_used TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'active', 'rejected', 'superseded')),
    generated_at TEXT DEFAULT (datetime('now')),
    validated_by TEXT,
    validated_at TEXT,
    note TEXT,                             -- the human's note on validate/reject
    word_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_soul_versions_who_status ON soul_versions(who, status);
CREATE INDEX IF NOT EXISTS idx_soul_versions_generated ON soul_versions(generated_at DESC);
