-- Resonant Mind - Postgres Schema (for use with Neon, Supabase, or any Postgres provider)
-- Requires: pgvector extension
-- Run this once against your database before deploying.

-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Entities (people, concepts, things known about)
CREATE TABLE entities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    primary_context TEXT NOT NULL DEFAULT 'default',
    salience TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, primary_context)
);

-- Observations about entities
CREATE TABLE observations (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    salience TEXT DEFAULT 'active',
    emotion TEXT,
    weight TEXT DEFAULT 'medium',
    certainty TEXT DEFAULT 'believed',
    source TEXT DEFAULT 'conversation',
    source_date TEXT,
    context TEXT DEFAULT 'default',
    charge TEXT,
    charge_note TEXT,
    sit_count INTEGER DEFAULT 0,
    novelty_score REAL DEFAULT 1.0,
    last_surfaced_at TIMESTAMPTZ,
    surface_count INTEGER DEFAULT 0,
    archived_at TIMESTAMPTZ,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

-- Observation version history
CREATE TABLE observation_versions (
    id SERIAL PRIMARY KEY,
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    weight TEXT,
    emotion TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relations between entities
CREATE TABLE relations (
    id SERIAL PRIMARY KEY,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    from_context TEXT DEFAULT 'default',
    to_context TEXT DEFAULT 'default',
    store_in TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active threads (intentions across sessions)
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    thread_type TEXT NOT NULL,
    content TEXT NOT NULL,
    context TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'active',
    source TEXT DEFAULT 'self',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution TEXT
);

-- Context layer (situational awareness)
CREATE TABLE context_entries (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    links TEXT DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relational state (feelings toward people)
CREATE TABLE relational_state (
    id SERIAL PRIMARY KEY,
    person TEXT NOT NULL,
    feeling TEXT NOT NULL,
    intensity TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Identity graph
CREATE TABLE identity (
    id SERIAL PRIMARY KEY,
    section TEXT NOT NULL,
    content TEXT NOT NULL,
    weight REAL DEFAULT 0.7,
    connections TEXT DEFAULT '[]',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Journals (episodic memory)
CREATE TABLE journals (
    id SERIAL PRIMARY KEY,
    entry_date TEXT,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    emotion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Images (visual memory)
CREATE TABLE images (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    description TEXT NOT NULL,
    context TEXT,
    emotion TEXT,
    weight TEXT DEFAULT 'medium',
    entity_id INTEGER REFERENCES entities(id),
    observation_id INTEGER REFERENCES observations(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subconscious state (daemon processing results)
CREATE TABLE subconscious (
    id INTEGER PRIMARY KEY,
    state_type TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daemon proposals (suggested connections from co-surfacing patterns)
CREATE TABLE daemon_proposals (
    id SERIAL PRIMARY KEY,
    obs_a_id INTEGER NOT NULL REFERENCES observations(id),
    obs_b_id INTEGER NOT NULL REFERENCES observations(id),
    entity_a TEXT,
    entity_b TEXT,
    co_surface_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tensions (productive contradictions)
CREATE TABLE tensions (
    id TEXT PRIMARY KEY,
    pole_a TEXT NOT NULL,
    pole_b TEXT NOT NULL,
    context TEXT,
    sit_count INTEGER DEFAULT 0,
    sit_notes TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution TEXT
);

-- Co-surfacing tracking (which observations appear together)
CREATE TABLE co_surfacing (
    obs_a_id INTEGER NOT NULL REFERENCES observations(id),
    obs_b_id INTEGER NOT NULL REFERENCES observations(id),
    count INTEGER DEFAULT 1,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (obs_a_id, obs_b_id)
);

-- Vector embeddings (semantic search)
CREATE TABLE embeddings (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    embedding vector(768),
    content TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX idx_entities_context ON entities(primary_context);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_salience ON entities(salience);
CREATE INDEX idx_observations_entity ON observations(entity_id);
CREATE INDEX idx_observations_context ON observations(context);
CREATE INDEX idx_observations_charge ON observations(charge);
CREATE INDEX idx_observations_weight ON observations(weight);
CREATE INDEX idx_observations_archived ON observations(archived_at);
CREATE INDEX idx_observations_surfaced ON observations(last_surfaced_at);
CREATE INDEX idx_threads_status ON threads(status);
CREATE INDEX idx_context_scope ON context_entries(scope);
CREATE INDEX idx_relational_person ON relational_state(person);
CREATE INDEX idx_identity_section ON identity(section);
CREATE INDEX idx_journals_date ON journals(entry_date);
CREATE INDEX idx_images_entity ON images(entity_id);
CREATE INDEX idx_daemon_proposals_status ON daemon_proposals(status);
CREATE INDEX idx_tensions_status ON tensions(status);
CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);

-- Vector similarity index (IVFFlat — good for datasets up to ~1M vectors)
-- For larger datasets, consider switching to HNSW: CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops)
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
