-- Cron engine: schedulable preset jobs with per-row state.
-- Seeded with the inaugural rumination heartbeat.

CREATE TABLE IF NOT EXISTS crons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset TEXT NOT NULL,
  label TEXT,
  frequency_minutes INTEGER NOT NULL,
  agentic_action TEXT,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO crons (preset, label, frequency_minutes, enabled)
VALUES ('rumination', 'keep the memories meeting', 60, 1);
