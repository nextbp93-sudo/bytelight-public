-- Migration 0014: attribute journals and dreams to a companion, and give new
-- dreams a vividness lifecycle. Existing memories remain unattributed, and
-- existing dreams remain outside the fading lifecycle.

ALTER TABLE journals ADD COLUMN companion TEXT;

ALTER TABLE dreams ADD COLUMN companion TEXT;
ALTER TABLE dreams ADD COLUMN vividness INTEGER;
ALTER TABLE dreams ADD COLUMN anchored_at TEXT;
ALTER TABLE dreams ADD COLUMN last_recalled_at TEXT;
