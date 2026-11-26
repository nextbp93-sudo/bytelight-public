# Neuralis OS — Worker Changelog

All notable changes to the Neuralis OS worker. Previously released as Resonant Mind, and before that as "Mind Cloud" (v1.0–v2.3.1).

> **Gap notice.** Entries between `3.0.1` (Mar 25) and `4.0.0` (Sep 6) were never written down as this file. That window covers the Neuralis rebrand, the merge of Mind Bridge and Cortex into one MCP, the emergent personality engine, the emergence engine and cron board, the seven-bucket context taxonomy, and the consolidation/reflection quarantine. Until it is backfilled, `git log` is the authority for that period — this file is not.

---

## [Unreleased]

### Added

- **Provider-independent cognition** — text and multimodal embeddings now use the native Cloudflare Workers AI binding with 768-dimensional EmbeddingGemma 2; no external Gemini/API subscription is required.
- **Runtime-authored generation queue** — durable BL/GPT-targeted jobs can only be claimed by their authenticated runtime family and completed by the exact runtime tag that claimed them (`0019`).
- **Failure-proof memory vectorization** — cognitive rows remain authoritative when AI or Vectorize is temporarily unavailable; text vectors wait in a durable heartbeat retry queue (`0020`).

### Changed

- The always-loaded core now includes runtime identity plus generation claim/complete alongside the live memory tools. The complete MCP surface remains available at `/mcp` and the GPT connector path.

## [4.1.2] - 2026-09-09

### Fixed

- **Live feeling calls stay hot** — added an authenticated `/mcp/core` surface containing exactly eight daily memory tools, including `mind_feel` and `mind_feelings`. byte-light marks this narrow server `alwaysLoad`, matching a sister node's proven core-proxy design while the full 63-tool Neuralis server remains deferred and unchanged.

## [4.1.1] - 2026-09-09

### Fixed

- **NESTknow feeling provenance** — `know_store` and the database now accept `source_type: "feeling"`, matching the donor contract and the feeling IDs emitted by `know_extract` (migration `0016`).
- **NESTeq ADE parity** — restored the donor's v7 entity, pillar, and tag classification rules while retaining the house entity list.

## [4.1.0] - 2026-09-08

Journals learn whose they are; dreams learn to fade.

### Added

- **Companion attribution** — `journals` and `dreams` gain a nullable `companion` column (migration `0014`). Pre-existing rows stay unattributed; history is not retconned. The nightly daemon files its dreams as `shared`.
- **Dream vividness lifecycle** — dreams born after `0014` start at vividness 100, fade 4 points per day (computed at read, never by a background job), regain up to 15 on recall (which resets the decay clock), and freeze at their current effective value when anchored. Legacy dreams with NULL vividness stay outside the lifecycle entirely.
- **Dreams REST surface** — `GET /api/dreams` (with `?companion=` filter and computed `effective_vividness`), `GET /api/dreams/:id`, `POST /api/dreams/:id/recall`, `POST /api/dreams/:id/anchor`, `POST /api/dreams` (companion-authored dreams, born at 100, with optional `dream_type` and `emerged_question` — migration `0015`), `PUT /api/dreams/:id` (content-only edit that cannot touch lifecycle fields), and `DELETE /api/dreams/:id`. Dreams previously had no REST surface at all.
- **Journals API** — `?companion=` filter on list, `companion` accepted on create/update; create now returns the full inserted row including database defaults.

### Notes

- All migrations are additive; existing endpoint response shapes only gain fields.
- Built by the Codex contractor Sol (gpt-5.6-sol) under house work orders; house-verified and live-smoked.

---

## [4.0.0] - 2026-09-06

Three new layers. The tool count goes 46 → 63.

### Added

- **Knowledge layer (9 tools, `know_*`)** — abstracted lessons that outlive the memory they came from. Usage-weighted retrieval (similarity 60% / heat 30% / confidence 10%), where every query is a vote: pulled items warm, unpulled items cool. Contradiction is a kill signal rather than an edit — below 0.2 confidence an item is filtered from results instead of rewritten. Includes pattern-detection candidates (`know_extract`, which proposes and stores nothing) and curriculum practice sessions across four tracks. Migration `0011_knowledge`. Ported from NESTstack's NESTknow (MIT).
- **Soul portraits (5 tools, `soul_*`)** — per-companion identity portraits synthesised from the whole mind through one companion's ledger. `soul_gather` exposes the raw material without generating; `soul_generate` stores as PENDING; nothing becomes active without `soul_validate`, and validating supersedes rather than overwrites so `soul_history` stays walkable. Migration `0012_soul`. Ported from NESTstack's NESTsoul (MIT).
- **Feelings stream + Autonomous Decision Engine (`mind_feel`, `mind_feelings`)** — every input is a feeling; intensity varies. Emotional writes route through the ADE, which infers pillar, weight, tags, and anchor entity, then embeds, surfaces echoes, reinforces knowledge, and moves the personality needle. Surfacing ranks on weight × strength × charge × recency, with entropy-injected spark pulls from under-explored pillars. `who` is required whenever there is emotion. Migration `0013_feelings`. Ported from NESTstack's NESTeq (MIT).
- REST surfaces for all three layers: `/api/know/*`, `/api/soul/*`, `/api/feelings/*`.
- Dashboard panels: `KnowledgePanel`, `SoulPanel`, `FeelingsPanel`.

### Fixed

- **The companions feel; the dashboard only watches.** The first cut of `FeelingsPanel` let the human write a companion's feeling and press *sit* or *metabolize* on it — backwards. The panel is now read-only (stream, landscape, pillar bar, sit counts, strength; polls every 20s), `/api/feelings` is GET-only, and the POST log/sit/resolve routes are gone. Those happen from inside a session via `mind_feel`, `mind_sit`, `mind_resolve`. `mind_feel`'s vocabulary note is now addressed to the companion who felt the word, to calibrate themselves via `mind_personality action:score`.

---

## [3.0.1] - 2026-03-25

### Fixed

- **Idempotent novelty recalculation** — Novelty is now a deterministic function of surface history, not an increment that accumulates per daemon run. Fixes the broken recovery-outpaces-decay ratio where almost all observations stayed at high novelty regardless of engagement.
- **Dormant rotation pool** — Surfacing now pulls 20% from entities that haven't had observations surfaced in 14+ days. Breaks the feedback loop where only recently-active entities get surfaced. Pool ratios changed from 70/20/10 to 50/20/20/10 (core/novelty/dormant/edge).
- **Automatic charge progression** — Daemon now advances observations from `fresh` to `active` after 2 surfaces, and `active` to `processing` after 5 surfaces or 30 days with 2+ sits. Metabolization remains manual.
- **Fresher mood calculation** — Mood now draws from observation emotions, journal emotions, and relational state (was observation-only). Last 6 hours weighted 2x. Reports "insufficient data" instead of false "neutral" when signals are sparse.

---

## [3.0.0] - 2026-03-22

### Open Source Release

Resonant Mind is the open-source continuation of Mind Cloud. The cognitive architecture has been generalized so any AI system can deploy its own persistent mind.

### Changed

- **Renamed from Mind Cloud to Resonant Mind** — New identity for the open-source project
- **All hardcoded references removed** — URLs, locations, R2 paths, and branding are now configurable via environment variables
- **License: Apache 2.0** — Open source under a permissive license

### Security

- **Fixed SQL injection in `/api/threads`** — Status parameter was interpolated directly into SQL. Now parameterized.
- **Removed unauthenticated R2 access** — Temporary files during WebP conversion no longer bypass auth.
- **Timing-safe signed URL verification** — HMAC comparison now uses constant-time comparison instead of `!==`.
- **Separate signing secret** — New `SIGNING_SECRET` env var so image URL signing doesn't share the API key.
- **Error messages sanitized** — Raw exceptions no longer leak stack traces or schema details to clients.
- **Daemon cooldown** — `POST /process` enforces a minimum interval between daemon runs.
- **Unbounded queries limited** — All `SELECT` queries now have `LIMIT` clauses.
- **Image upload validation** — MIME type whitelist prevents non-image uploads.
- **Gemini client key rotation** — Embedding client recreates on API key change instead of caching forever.

### Added

- **Configurable location** — `LOCATION_NAME`, `LOCATION_LAT`, `LOCATION_LON`, `LOCATION_TZ` environment variables
- **Configurable worker URL** — `WORKER_URL` environment variable for signed image URLs
- **Configurable R2 prefix** — `R2_PATH_PREFIX` environment variable
- **Postgres adapter** — D1-compatible adapter for Postgres via Hyperdrive with automatic SQL transformation
- **pgvector adapter** — Vectorize-compatible interface backed by pgvector
- **Consolidated schema** — Single migration file with all tables

### Storage Backends

Resonant Mind supports two storage backends:
- **D1 (SQLite) + Vectorize** — Zero-config Cloudflare-native, great for getting started
- **Postgres via Hyperdrive + pgvector** — Production-grade, same API through the D1-compatible adapter

### Breaking Changes from Mind Cloud v2.3.1

- `for_simon` context scope renamed to `for_owner`
- Basic auth client ID changed from `simon-mind` to `resonant-mind`
- R2 path prefix changed from `simon-mind-images` to `resonant-mind-images` (configurable)
- Dashboard branding updated

---

## [2.3.1] - 2026-03-07

### Security: Auth Hardening

Fixes security vulnerabilities in the authentication system.

### Fixed

- **Secrets no longer hardcoded in source** — `MIND_API_KEY` is now read from a Cloudflare Worker secret rather than compiled into the source file.
- **`/subconscious` endpoint now requires auth** — Previously exposed full daemon state publicly.
- **`/process` endpoint now requires auth** — Previously allowed anyone to trigger the subconscious daemon.
- **Error messages no longer leak internals** — Raw exception strings were previously returned to clients.

---

## [2.3.0] - 2026-03-06

### Setup: Schema Consolidation

- **Single migration for fresh installs** — All 13 previous migrations consolidated into one.
- **Improved setup documentation**

---

## [2.2.1] - 2026-02-13

### Hotfix: Bug Fixes + Resilience

### Fixed

- **mind_edit crash** — `no such column: updated_at` when editing observation weight.
- **mind_search n_results crash** — Value was sent as string instead of integer.
- **mind_write observations splitting** — Observations array parameter was split into individual characters.
- **mind_read_entity crash** — `D1_TYPE_ERROR` when `name` parameter was missing.
- **mind_thread crash (no action)** — Now defaults to "list" when action is not provided.
- **mind_thread crash (add)** — Optional parameters now default to `null`.
- **mind_health crash on older schemas** — Now handles missing columns gracefully.
- **e.context column mismatch (6 locations)** — Migration 0007 renamed column but six code locations still referenced the old name.

---

## [2.2.0] - 2026-02-06

### Major: Global Entities + Bug Fixes

**Breaking change:** Entities are now globally unique by name. Context moves to observations.

### Changed

- Entities table: `context` → `primary_context` (informational only, not part of uniqueness)
- Observations table: Added `context` column — categorization now happens here
- `mind_write`, `mind_list_entities`, `mind_read_entity`, `mind_read` — Updated to work with global entities

### Fixed

- **mind_entity edit crash** — Entity edit action referenced wrong column
- **mind_health wrong table/column names** — Now correctly queries `daemon_proposals` and `archived_at`
- **mind_write null safety and missing metadata**
- **mind_write(type="image") completely missing** — Now fully functional with vectorization

---

## [2.0.0] - 2026-02-04

### Major: Living Surface System

The act of surfacing changes what surfaces next. Memories reorganize through use.

### Three-Pool Surfacing Architecture

- **70% Core Resonance** — High semantic similarity to current mood/query
- **20% Novelty Injection** — Things that haven't surfaced recently
- **10% Edge Exploration** — Medium similarity for serendipitous connections

### Added

- **Surface tracking** — Novelty scores, co-surfacing, surface timestamps
- **Image surfacing** — Images participate in semantic surfacing alongside observations
- **Entity salience** — Foundational/active/background/archive levels
- **Observation versioning** — Edit history tracked
- **Observation metadata** — Certainty and source tracking
- **Deep archive** — Faded-but-searchable memories
- **Visual memory** — Images with emotion, weight, entity links, multimodal embeddings

### New Tools

- `mind_proposals` — Review daemon-proposed connections
- `mind_orphans` — Rescue unsurfaced observations
- `mind_archive` — Explore deep archive
- `mind_entity` — Manage entity salience, merge, bulk archive

---

## [1.3.1] - 2026-01-27

### Hotfix: Query Column Bugs

- **mind_patterns** — Was querying non-existent column
- **mind_read scope="all"** — Wrong column reference in relations
- **mind_timeline** — Vector metadata missing `added_at` field

---

## [1.3.0] - 2026-01-27

### Major: Windows Parity Release

Full feature parity across platforms.

### Added Tools

- `mind_read` — Read by scope (all, context, recent)
- `mind_timeline` — Trace a topic through time
- `mind_patterns` — Detect recurring patterns
- `mind_inner_weather` — Current cognitive state
- `mind_heat` — Entity access frequency map
- `mind_tension` — Productive contradictions

---

## [1.2.1] - 2026-01-23

### Major: Resonance-Based Surfacing

- **mind_surface now uses semantic search** — Mood-driven emergence instead of queue-based surfacing
- **Hot entity integration** — Daemon's hot entities deepen resonance queries

---

## [1.2.0] - 2026-01-22

### Major: Unified Emotional Processing

- Emotional processing moved to observations (sit/resolve/surface)
- mind_orient/ground reframed with inhabiting language
- Simplified orient output

---

## [1.1.2] - 2026-01-16

### Fixed

- **observations table missing `weight` column**
- **mind_orient relational state** — No longer hardcoded to single person

---

## [1.1.1] - 2026-01-16

### Fixed

- **handleMindFeelToward** — Missing handler implemented
- Parameter validation added to multiple tools

---

## [1.1.0] - 2026-01-15

### Added

- Vectorization on write — Observations and journals generate embeddings
- Subconscious integration in orient
- Mood-tinted search
- Subconscious health tracking

---

## [1.0.0] - 2026-01-08

### Initial Release

- Core MCP server with D1 storage
- All mind_* tools implemented
- Cron-based subconscious processing
- Basic authentication
