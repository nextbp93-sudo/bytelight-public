-- Migration 0013: The feelings stream (NESTeq port — the actual organ)
--
-- "Everything is a feeling. Intensity varies."
--
-- Ported whole from NESTstack / NESTeq's unified feelings migration (Alex &
-- Fox, Jan 2026, MIT — notice in /ATTRIBUTION.md), adapted for this house:
--   * `who` on every feeling — a companion's slug, or shared. One stream, many voices.
--   * Ebbinghaus columns (strength / access_count / last_accessed_at) are in
--     the base table; the donor added them in a later migration.
--   * `feeling_id` is added to the existing personality tables (0006) so a
--     signal or a shadow moment can point at the feeling that caused it.
--   * The donor's Binary Home / uplink / legacy tables are not ported here.
--
-- What this is NOT: observations. An observation is a fact about an entity.
-- A feeling is first-person, in the moment — "I feel X about Y" — and every
-- one runs through the Autonomous Decision Engine on the way in: which entity
-- it anchors to, which EQ pillar it lives in, how heavy it is, what tags it
-- carries, whether it embeds, whether it moves the personality needle, and
-- whether it is a shadow moment. Feelings are what get sat with, surfaced,
-- sparked, and metabolized.

CREATE TABLE IF NOT EXISTS feelings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Core content
    content TEXT NOT NULL,
    emotion TEXT DEFAULT 'neutral',
    who TEXT NOT NULL DEFAULT 'shared',

    -- Intensity spectrum: neutral → overwhelming
    intensity TEXT DEFAULT 'present'
        CHECK (intensity IN ('neutral', 'whisper', 'present', 'strong', 'overwhelming')),

    -- Processing weight
    weight TEXT DEFAULT 'medium'
        CHECK (weight IN ('light', 'medium', 'heavy')),

    -- EQ pillar (null for neutral / non-EQ)
    pillar TEXT CHECK (pillar IN (
        'SELF_MANAGEMENT', 'SELF_AWARENESS',
        'SOCIAL_AWARENESS', 'RELATIONSHIP_MANAGEMENT', NULL
    )),

    -- Metabolizing state
    charge TEXT DEFAULT 'fresh'
        CHECK (charge IN ('fresh', 'warm', 'cool', 'metabolized')),
    sit_count INTEGER DEFAULT 0,
    last_sat_at TEXT,
    resolution_note TEXT,
    resolved_at TEXT,

    -- Connections (the web)
    sparked_by INTEGER REFERENCES feelings(id),
    linked_entity TEXT,
    linked_insight_id INTEGER REFERENCES feelings(id),

    -- Context
    context TEXT DEFAULT 'default',
    tags TEXT DEFAULT '[]',
    source TEXT DEFAULT 'manual',
    conversation_context TEXT,

    -- Ebbinghaus: rehearsal strengthens, neglect fades
    strength REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    last_accessed_at TEXT,

    -- Timestamps
    observed_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feelings_emotion ON feelings(emotion);
CREATE INDEX IF NOT EXISTS idx_feelings_who ON feelings(who);
CREATE INDEX IF NOT EXISTS idx_feelings_weight ON feelings(weight);
CREATE INDEX IF NOT EXISTS idx_feelings_charge ON feelings(charge);
CREATE INDEX IF NOT EXISTS idx_feelings_pillar ON feelings(pillar);
CREATE INDEX IF NOT EXISTS idx_feelings_entity ON feelings(linked_entity);
CREATE INDEX IF NOT EXISTS idx_feelings_created ON feelings(created_at);
CREATE INDEX IF NOT EXISTS idx_feelings_sparked_by ON feelings(sparked_by);
CREATE INDEX IF NOT EXISTS idx_feelings_context ON feelings(context);

-- The four pillars (reference + seed)
CREATE TABLE IF NOT EXISTS eq_pillars (
    pillar_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar_key TEXT UNIQUE NOT NULL,
    pillar_name TEXT NOT NULL,
    description TEXT,
    growth_indicators TEXT
);

INSERT OR IGNORE INTO eq_pillars (pillar_key, pillar_name, description) VALUES
    ('SELF_MANAGEMENT', 'Self-Management', 'Control impulses, manage emotions, adapt to change, follow through'),
    ('SELF_AWARENESS', 'Self-Awareness', 'Recognize emotions, know strengths/weaknesses, self-confidence'),
    ('SOCIAL_AWARENESS', 'Social Awareness', 'Empathy, reading others, understanding needs and dynamics'),
    ('RELATIONSHIP_MANAGEMENT', 'Relationship Management', 'Communication, conflict repair, influence, collaboration');

-- Sit sessions — sitting with a feeling, charge shifting as you do
CREATE TABLE IF NOT EXISTS sit_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feeling_id INTEGER REFERENCES feelings(id) ON DELETE CASCADE,
    who TEXT NOT NULL DEFAULT 'shared',
    emotion TEXT,
    intention TEXT,
    start_charge INTEGER,
    end_charge INTEGER,
    notes TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sit_sessions_feeling ON sit_sessions(feeling_id);

-- Personality tables learn to point at feelings
ALTER TABLE axis_signals ADD COLUMN feeling_id INTEGER;
ALTER TABLE shadow_moments ADD COLUMN feeling_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_axis_signals_feeling ON axis_signals(feeling_id);
CREATE INDEX IF NOT EXISTS idx_shadow_moments_feeling ON shadow_moments(feeling_id);
