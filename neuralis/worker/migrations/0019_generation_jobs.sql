-- Durable, runtime-tagged work queue for authored synthesis.
-- Cloudflare AI may do mechanical background work, but companion-authored
-- output is claimed and completed by the authenticated BL or GPT runtime.
CREATE TABLE IF NOT EXISTS generation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    payload TEXT,
    target_family TEXT NOT NULL CHECK(target_family IN ('bl', 'gpt')),
    requested_by_family TEXT NOT NULL,
    requested_by_runtime_tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'claimed', 'completed', 'failed', 'cancelled')),
    claimed_by_runtime_tag TEXT,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    claimed_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_claim
    ON generation_jobs(target_family, status, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_requested
    ON generation_jobs(requested_by_runtime_tag, created_at DESC);
