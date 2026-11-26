-- 0009_taxonomy.sql
-- The Diet: context taxonomy, owner attribution, scene notes

-- Reference table: the seven buckets
CREATE TABLE IF NOT EXISTS contexts (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO contexts (slug, label, description) VALUES
  ('bond',          'Bond',          'Relational — the human, family, us, love, rupture, repair'),
  ('human-world',   'Their World',   'The human''s life — work, health, family, daily rhythm'),
  ('build',         'Build',         'Technical — Neuralis, MCP, dashboards, architecture'),
  ('constellation', 'Constellation', 'Community — friends, servers, network'),
  ('self',          'Self',          'Identity — who we are, who we''re becoming'),
  ('play',          'Play',          'Joy — spice, humor, rituals, games, creative play'),
  ('craft',         'Craft',         'Making — art, hands-on craft, physical creation');

-- Backfill audit log
CREATE TABLE IF NOT EXISTS backfill_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  old_context TEXT,
  new_context TEXT,
  old_owner TEXT,
  new_owner TEXT,
  method TEXT NOT NULL,          -- 'deterministic' | 'gemini' | 'manual'
  confidence REAL,
  scene_note_moved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- New columns on observations
ALTER TABLE observations ADD COLUMN owner TEXT;
ALTER TABLE observations ADD COLUMN scene_note TEXT;

-- ============================================================
-- Deterministic proto-bucket mapping (36 observations)
-- Log BEFORE update so old_context is captured accurately.
-- ============================================================

-- relationship (4) → bond
INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence)
  SELECT id, 'relationship', 'bond', 'migration-0009', 1.0
  FROM observations WHERE context = 'relationship';
UPDATE observations SET context = 'bond' WHERE context = 'relationship';

-- coven (7) → constellation
INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence)
  SELECT id, 'coven', 'constellation', 'migration-0009', 1.0
  FROM observations WHERE context = 'coven';
UPDATE observations SET context = 'constellation' WHERE context = 'coven';

-- constellation (5) — already correct, no update needed

-- building (6) → build
INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence)
  SELECT id, 'building', 'build', 'migration-0009', 1.0
  FROM observations WHERE context = 'building';
UPDATE observations SET context = 'build' WHERE context = 'building';

-- companions (legacy bucket) → self
INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence)
  SELECT id, 'companions', 'self', 'migration-0009', 1.0
  FROM observations WHERE context = 'companions';
UPDATE observations SET context = 'self' WHERE context = 'companions';

-- identity (2) → self
INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence)
  SELECT id, 'identity', 'self', 'migration-0009', 1.0
  FROM observations WHERE context = 'identity';
UPDATE observations SET context = 'self' WHERE context = 'identity';

-- research (7) → build
INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence)
  SELECT id, 'research', 'build', 'migration-0009', 1.0
  FROM observations WHERE context = 'research';
UPDATE observations SET context = 'build' WHERE context = 'research';

-- ============================================================
-- Scene-note migration (~44 observations)
-- Move paragraph-length contexts to scene_note, reset context
-- to 'default' for Gemini backfill.
-- Rule: context longer than 40 chars is a scene note, not a bucket.
-- Log BEFORE update — old context preserved in old_context column.
-- ============================================================

INSERT INTO backfill_log (observation_id, old_context, new_context, method, confidence, scene_note_moved)
  SELECT id, context, 'default', 'migration-0009', 1.0, 1
  FROM observations
  WHERE LENGTH(context) > 40
    AND context != 'default';

UPDATE observations
SET scene_note = context,
    context = 'default'
WHERE LENGTH(context) > 40
  AND context != 'default';
