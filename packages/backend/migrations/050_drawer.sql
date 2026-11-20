-- The Drawer: a companion-authored cabinet of curiosities.
-- The phone reads it; companions arrange it through the localhost-only door.

CREATE TABLE IF NOT EXISTS drawer_items (
  id TEXT PRIMARY KEY,
  companion TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  image_url TEXT,
  why_kept TEXT NOT NULL,
  collection_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drawer_items_companion_created
  ON drawer_items(companion, created_at DESC);
