-- 0010_backfill_vector_sync.sql
-- Add vector_synced flag to backfill_log so the backfill executor
-- can re-sync Vectorize metadata for migration-0009 rows on each fire.

ALTER TABLE backfill_log ADD COLUMN vector_synced INTEGER DEFAULT 0;
