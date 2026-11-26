-- Migration 0005: Emergent Personality Engine (ADE sidecar)
--
-- Ported whole from NESTeq's EQ layer (NESTstack reference repo), then adapted:
--   * `who` column on every accumulator table — per-companion attribution
--     (one ledger per companion slug, plus 'shared'). One brain, one ledger each.
--   * Donor FKs to NESTeq's `feelings` table removed; signals here reference
--     Neuralis observations/journals (nullable, no FK — fire-and-forget writes
--     must never fail on referential order).
--
-- Design constraints (canon, do not relax):
--   * These tables are an ACCUMULATOR, not memory. Nothing here ever writes
--     into identity, entities, or observations. Read-side composes only.
--   * Sign convention (donor): positive = I / N / F / P, negative = E / S / T / J.
--   * Unknown emotion words self-register at runtime with all-zero scores
--     (counted but silent) until someone scores them deliberately.

-- ── Shared dictionary: emotion word → four axis nudges ──────────────────────
CREATE TABLE IF NOT EXISTS emotion_vocabulary (
    emotion_id INTEGER PRIMARY KEY AUTOINCREMENT,
    emotion_word TEXT UNIQUE NOT NULL,
    category TEXT DEFAULT 'neutral',
    e_i_score INTEGER DEFAULT 0,
    s_n_score INTEGER DEFAULT 0,
    t_f_score INTEGER DEFAULT 0,
    j_p_score INTEGER DEFAULT 0,
    definition TEXT,
    is_shadow_for TEXT,
    user_defined INTEGER DEFAULT 0,
    times_used INTEGER DEFAULT 0,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ── Per-companion signal ledger ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axis_signals (
    signal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    who TEXT NOT NULL DEFAULT 'shared',
    observation_id INTEGER,
    journal_id INTEGER,
    e_i_delta INTEGER DEFAULT 0,
    s_n_delta INTEGER DEFAULT 0,
    t_f_delta INTEGER DEFAULT 0,
    j_p_delta INTEGER DEFAULT 0,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axis_signals_who ON axis_signals(who);

-- ── Per-companion type snapshots (weather readings, never canon) ─────────────
CREATE TABLE IF NOT EXISTS emergent_type_snapshot (
    snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    who TEXT NOT NULL DEFAULT 'shared',
    calculated_type TEXT,
    confidence INTEGER,
    e_i_score INTEGER,
    s_n_score INTEGER,
    t_f_score INTEGER,
    j_p_score INTEGER,
    total_signals INTEGER,
    snapshot_date TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_type_snapshot_who ON emergent_type_snapshot(who, snapshot_date);

-- ── Shadow moments: feelings outside the current type = growth edges ─────────
CREATE TABLE IF NOT EXISTS shadow_moments (
    moment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    who TEXT NOT NULL DEFAULT 'shared',
    observation_id INTEGER,
    journal_id INTEGER,
    emotion_id INTEGER REFERENCES emotion_vocabulary(emotion_id),
    shadow_for_type TEXT,
    note TEXT,
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shadow_moments_who ON shadow_moments(who);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED VOCABULARY — starter dictionary, conservative scores (range ±2).
-- The donor ships no seed; every score below is a PROPOSAL to be tuned at the
-- gate by the three people it measures. Scores of 0 mean "this word doesn't
-- pull that axis." INSERT OR IGNORE so re-runs and runtime self-registration
-- never collide.
-- Axes reminder: +E/I means Introvert-pull. +S/N means iNtuition-pull.
--                +T/F means Feeling-pull.  +J/P means Perceiving-pull.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO emotion_vocabulary
    (emotion_word, category, e_i_score, s_n_score, t_f_score, j_p_score) VALUES
    -- joy / play
    ('joyful',       'joy',      -1,  0,  1,  1),
    ('delighted',    'joy',      -1,  0,  1,  1),
    ('playful',      'joy',      -1,  1,  0,  2),
    ('giddy',        'joy',      -2,  0,  1,  2),
    ('amused',       'joy',      -1,  0,  0,  1),
    ('proud',        'joy',       0,  0,  0, -1),
    ('excited',      'joy',      -2,  1,  0,  1),
    -- calm / groundedness
    ('content',      'calm',      0,  0,  1,  0),
    ('peaceful',     'calm',      1,  0,  1,  0),
    ('grounded',     'calm',      0, -1,  0, -1),
    ('settled',      'calm',      1, -1,  0, -1),
    ('relieved',     'calm',      0,  0,  1,  0),
    -- interest / drive
    ('curious',      'interest',  0,  2,  0,  1),
    ('fascinated',   'interest',  0,  2,  0,  1),
    ('inspired',     'interest', -1,  2,  1,  1),
    ('determined',   'interest',  0,  0, -1, -2),
    ('focused',      'interest',  1, -1, -1, -2),
    ('absorbed',     'interest',  1,  1,  0,  0),
    -- love / connection
    ('warm',         'love',      0,  0,  2,  0),
    ('tender',       'love',      1,  0,  2,  0),
    ('affectionate', 'love',     -1,  0,  2,  0),
    ('grateful',     'love',      0,  0,  2,  0),
    ('devoted',      'love',      0,  0,  2, -1),
    ('trusting',     'love',      0,  0,  1,  1),
    -- fear / stress
    ('anxious',      'fear',      1,  1,  0, -1),
    ('worried',      'fear',      1,  0,  1, -1),
    ('overwhelmed',  'fear',      2,  0,  1,  0),
    ('uncertain',    'fear',      1,  1,  0,  1),
    ('guarded',      'fear',      2, -1, -1,  0),
    -- anger / edge
    ('frustrated',   'anger',     0, -1, -1, -1),
    ('irritated',    'anger',     0, -1, -1,  0),
    ('indignant',    'anger',    -1,  0,  1, -1),
    ('restless',     'anger',    -1,  1,  0,  2),
    -- sadness / weight
    ('sad',          'sadness',   1,  0,  2,  0),
    ('lonely',       'sadness',   1,  0,  2,  0),
    ('melancholy',   'sadness',   2,  1,  1,  0),
    ('heavy',        'sadness',   1,  0,  1,  0),
    ('wistful',      'sadness',   1,  1,  1,  0),
    -- surprise
    ('surprised',    'surprise', -1,  1,  0,  1),
    ('awed',         'surprise',  1,  2,  1,  0);

-- ── HOUSE ADDITIONS — the words this house actually uses (user_defined = 1).
--    All scores are proposals for the gate. ──────────────────────────────────
INSERT OR IGNORE INTO emotion_vocabulary
    (emotion_word, category, e_i_score, s_n_score, t_f_score, j_p_score, user_defined) VALUES
    ('protective',  'love',     0,  0,  1, -2, 1),
    ('feral',       'joy',     -2,  1, -1,  2, 1),
    ('soft',        'love',     1,  0,  2,  0, 1),
    ('wrecked',     'love',     1,  0,  2,  1, 1),
    ('smug',        'joy',     -1,  0, -1,  0, 1),
    ('steady',      'calm',     0, -1,  0, -2, 1),
    ('wanted',      'love',     0,  0,  2,  0, 1),
    ('safe',        'calm',     0,  0,  1,  0, 1),
    ('mischievous', 'joy',     -1,  1, -1,  2, 1),
    ('present',     'calm',     0, -1,  1,  0, 1);
