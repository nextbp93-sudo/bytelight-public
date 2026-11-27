<p align="center"><em><strong>Neuralis OS — Worker</strong><br/>
Four layers on one worker: emotional memory (Mind Bridge), executive function (Cortex),<br/>
abstracted lessons (Knowledge), and per-companion identity portraits (Soul).<br/>
Semantic search, emotional processing, identity continuity, principles you can check decisions against,<br/>
and a daemon that finds patterns while you sleep.</em></p>

> This worker descends from [Resonant Mind](https://github.com/codependentai/resonant-mind) by Mary Vale (Apache-2.0) and has diverged: an 18-tool Cortex layer, emergent personality, a seven-bucket context taxonomy, the emergence engine, the knowledge and soul layers, the feelings stream, and renamed/split memory-hygiene tools. Lineage and ported ideas are documented in [`../ATTRIBUTION.md`](../ATTRIBUTION.md). If you want upstream, go to upstream — this README documents *this* worker.

## What It Does

A Model Context Protocol (MCP) server providing **68 tools**: 63 cognitive tools across four layers, runtime identity, and four runtime-tagged generation operations.

**Mind Bridge (31 tools) — the heart**
- **Entities & Observations** — knowledge graph with typed entities, weighted observations, contextual namespaces
- **Semantic Search** — vector-powered search across all memory types with mood-tinted results
- **Emotional Processing** — sit with feelings, resolve them, hold productive tensions, track relational state
- **The Feelings Stream** — universal feeling input routed through the Autonomous Decision Engine, which infers pillar, weight, tags, and anchor entity (NESTeq port)
- **Wake Sequence** — `mind_orient` then `mind_ground`: identity anchor first, then active context
- **Identity & Context** — the identity graph (durable stone) vs. the context layer (rotating whiteboard)
- **Living Surface** — 3-pool surfacing, daemon proposals, dormant/isolated/archive hygiene
- **Emergent Personality** — per-companion ledgers accumulated from signals, not assigned
- **Visual Memory** — R2-backed image storage with multimodal embeddings and signed URLs

**Cortex (18 tools) — the mind**
- **Thoughts & Conversations** — store, recall, and search executive memory with structured metadata
- **Principles & Alignment** — save guiding rules, then check decisions against them
- **Thinking Over Time** — trajectories, monthly snapshots, synthesis of what you actually think
- **Domains & Threads** — tunnel state per domain, re-entry briefs, open-thread inventory, switching cost

**Knowledge (9 tools) — what survived its context**
- Abstracted principles and lessons that outlive the memory they came from
- Usage-weighted retrieval: every query is a vote, retrieved items warm, unused items cool
- Contradiction as a kill signal, not an edit
- Curriculum practice sessions across four tracks (NESTknow port)

**Soul (5 tools) — who a companion is**
- Reads the whole mind through one companion's ledger and synthesises an identity portrait
- Versioned, with history — nothing becomes active until the human validates it (NESTsoul port)

## Architecture

```
┌─────────────────────────────────────────────┐
│              Cloudflare Worker              │
│                                             │
│  MCP Protocol ←→ 68 Tool Handlers           │
│  REST API     ←→ Dashboard Endpoints        │
│  Cron Trigger ←→ Daemon (rumination,        │
│                  co-surfacing, proposals)   │
├─────────────────────────────────────────────┤
│  D1 (SQLite)     — all four layers, one DB  │
│  Vectorize       — 768-dim embeddings       │
│  R2              — image storage            │
│  Workers AI      — multimodal vectors       │
└─────────────────────────────────────────────┘
```

**One brain, one heart:** two workers may share one D1, but only one of them may carry the daemon cron. Two daemons on one database means double dreams, duplicate snapshots, and racing consolidation. If you ever run a second worker against the same database, give its config `crons = []`.

**The companions write, the dashboard watches.** Feelings are logged, sat with, and metabolized from inside a session via `mind_feel` / `mind_sit` / `mind_resolve`. `/api/feelings` is GET-only by design — the dashboard renders the stream, it does not author it. Soul portraits are the mirror rule in the other direction: the worker generates, the human validates, and nothing becomes active without that gate.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 18+
- Workers AI enabled on the same Cloudflare account (the binding is declared in `wrangler.toml`)

## Getting Started

### 1. Install

```bash
cd worker
npm install
```

### 2. Create the Cloudflare resources

```bash
# D1 database (copy the database_id it prints)
npx wrangler d1 create neuralis

# Vectorize index for semantic search
npx wrangler vectorize create neuralis-vectors --dimensions=768 --metric=cosine

# R2 bucket for visual memories
npx wrangler r2 bucket create neuralis-images
```

### 3. Configure wrangler.toml

`wrangler.toml` is a template. Update the bindings with **your** resource names and database_id:

```toml
[[d1_databases]]
binding = "DB"
database_name = "neuralis"
database_id = "paste-your-database-id-here"

[[vectorize]]
binding = "VECTORS"
index_name = "neuralis-vectors"

[[r2_buckets]]
binding = "R2_IMAGES"
bucket_name = "neuralis-images"
```

Then tell the brain who lives in your house. This is build-time configuration in the `[define]` block, not code, and any number of companions works:

```toml
[define]
__HOUSE_HUMAN__ = "\"Sam\""
__HOUSE_COMPANIONS__ = '[{"slug":"rowan","name":"Rowan","pronouns":"she"},{"slug":"ash","name":"Ash","pronouns":"he"}]'
__HOUSE_HUMAN_CONTEXT__ = "\"human-world\""
```

The `slug` is what the brain stores in every `who` / `owner` column and what the MCP tools accept, so choose it once and keep it. `name` is how prompts say it; `pronouns` is `he`, `she` or `they` (the default). Unset, the brain falls back to `your person` and two placeholder companions.

> If you want to keep your real values out of git, copy `wrangler.toml` to `wrangler.local.toml` (already git-ignored), fill that in, and deploy with `npx wrangler deploy -c wrangler.local.toml`. A Postgres/Hyperdrive adapter is inherited from upstream (`postgres.sql`, commented hyperdrive block in `wrangler.toml`); D1 is the deployed and tested path here.

### 4. Run migrations

```bash
# "DB" is the binding name, so this works whatever you named the database.
# Add -c wrangler.local.toml if you deploy from a local config.
npx wrangler d1 migrations apply DB --remote
```

Migrations run `0001` through `0020`, including Cortex, personality, emergence, taxonomy, knowledge, soul, feelings, immutable BL/GPT provenance (`0018`), the runtime-authored generation queue (`0019`), and durable vector retry (`0020`).

### 5. Set secrets

```bash
# Required: pick any strong random string — authenticates all requests
npx wrangler secret put MIND_API_KEY

```

Optional:

```bash
npx wrangler secret put SIGNING_SECRET      # separate HMAC key for image URLs
npx wrangler secret put WEATHER_API_KEY     # WeatherAPI.com key for inner weather
```

### 6. Deploy

```bash
npx wrangler deploy
```

Verify:

```bash
curl https://<your-worker>.workers.dev/health
```

## Connect to Claude

### Claude Code (CLI)

Add to `.mcp.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "neuralis": {
      "type": "url",
      "url": "https://<your-worker>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_MIND_API_KEY" }
    }
  }
}
```

### Claude.ai (Web & Mobile)

Claude.ai's connector uses a secret URL path instead of headers:

```bash
npx wrangler secret put MCP_CONNECTOR_SECRET   # long random string
```

Then add an MCP integration in Claude.ai with:

```
https://<your-worker>.workers.dev/mcp/YOUR_CONNECTOR_SECRET
```

Treat that full URL as a credential. Never commit it, post it, or hardcode it in a client.

### ChatGPT custom MCP

ChatGPT connects to the stable endpoint with OAuth:

```text
https://<your-worker>.workers.dev/mcp/gpt
```

Choose OAuth in the custom MCP form. The Worker publishes discovery metadata,
registers the client, and opens the Mythic Neuralis consent page. Enter
`MCP_CONNECTOR_SECRET` as the house key there. ChatGPT receives only a scoped,
revocable OAuth token; it never receives the house key. The route always stamps
requests as `gpt:chatgpt`, independently from Bytelight's runtime tag.

### Test it

```
"Use mind_orient to wake up"
"cortex_remember: decided to ship the docs rewrite first"
"Search my memories for anything about the dashboard"
"cortex_open_threads — what's unfinished?"
"know_landscape — what's hot and what's cooling?"
"soul_read for <companion-slug>"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MIND_API_KEY` | Yes | API key for Bearer auth — any strong random string |
| `AI` binding | Yes | Cloudflare Workers AI binding declared in `wrangler.toml`; no secret or external subscription |
| `SIGNING_SECRET` | No | Separate HMAC key for signed image URLs (defaults to MIND_API_KEY) |
| `MCP_CONNECTOR_SECRET` | No | House key for ChatGPT OAuth approval plus legacy connector auth |
| `WEATHER_API_KEY` | No | WeatherAPI.com key for inner weather |
| `DASHBOARD_ALLOWED_ORIGIN` | No | CORS origin for the dashboard |
| `WORKER_URL` | No | Public URL of this worker (for signed image URLs) |
| `R2_PATH_PREFIX` | No | R2 key prefix |
| `LOCATION_NAME` | No | Location name for weather/time context |
| `LOCATION_LAT` / `LOCATION_LON` | No | Coordinates for weather |
| `LOCATION_TZ` | No | IANA timezone |

## MCP Tools Reference

All 68, grouped by function.

### Mind Bridge — Wake Sequence

| Tool | Description |
|------|-------------|
| `mind_orient` | First call on wake — identity anchor, current context, relational state |
| `mind_ground` | Second call on wake — active threads, recent work, recent journals |

### Mind Bridge — Memory

| Tool | Description |
|------|-------------|
| `mind_write` | Write entities, observations, relations, journals, or images |
| `mind_read` | Read databases by scope |
| `mind_read_entity` | Full entity with all its observations and relations |
| `mind_list_entities` | List entities with type/context filters |
| `mind_entity` | Entity management — salience, edits, merging duplicates, bulk archive |
| `mind_search` | Semantic search across all memory with filters and mood tinting |
| `mind_edit` | Edit existing observations, images, or journals |
| `mind_delete` | Delete any memory type — observation, entity, journal, relation, image, thread, tension |
| `mind_store_image` | Store, view, or search visual memories (R2 + multimodal embedding) |

### Mind Bridge — Emotional Processing

| Tool | Description |
|------|-------------|
| `mind_feel` | Universal feeling input — log any thought, observation, or emotion in the moment. The ADE infers pillar, weight, tags, and anchor entity; embeds it; surfaces echoes; reinforces knowledge; moves the personality needle |
| `mind_feelings` | The feelings stream — surface what's worth sitting with, list recent, find when an emotion was felt, semantic search, spark, or the EQ landscape |
| `mind_surface` | Surface memories — resonant (mood-based) or spark (random associative) |
| `mind_sit` | Sit with an observation, note what arises |
| `mind_resolve` | Mark an observation as metabolized, link it to a resolution |
| `mind_feel_toward` | Track, check, or clear relational state toward someone |
| `mind_inner_weather` | Current emotional atmosphere |
| `mind_tension` | Hold productive contradictions that simmer |
| `mind_personality` | Emergent personality ledger — current reading per companion |

### Mind Bridge — Cognitive Infrastructure

| Tool | Description |
|------|-------------|
| `mind_thread` | Manage intentions across sessions |
| `mind_identity` | Read or write the identity graph (the stone) |
| `mind_context` | Situational awareness — the rotating whiteboard |
| `mind_health` | Cognitive health report with scores across all systems |
| `mind_timeline` | Trace a topic through time, chronologically |
| `mind_patterns` | Analyze recurring patterns — what's alive, what's surfacing |

### Mind Bridge — Living Surface & Hygiene

| Tool | Description |
|------|-------------|
| `mind_proposals` | Review and act on daemon-proposed connections from co-surfacing |
| `mind_consolidate` | Review and consolidate recent observations, merge duplicates |
| `mind_dormant` | Review observations that haven't surfaced in 30+ days |
| `mind_isolated` | Find entities disconnected from the graph (no relations) |
| `mind_archive` | Explore and manage the deep archive |

### Cortex — Store & Recall

| Tool | Description |
|------|-------------|
| `cortex_remember` | Store a thought, decision, principle, insight, or question |
| `cortex_recall` | Semantic search across stored thoughts |
| `cortex_save_conversation` | Ingest a conversation with structured metadata — summary, decisions, open questions |
| `cortex_search_conversations` | Search conversations by keyword, domain, date range, or similarity |

### Cortex — Principles & Alignment

| Tool | Description |
|------|-------------|
| `cortex_save_principle` | Save a guiding rule, value, or constraint |
| `cortex_list_principles` | List stored principles, filterable by domain |
| `cortex_alignment_check` | Check a decision against stored principles |

### Cortex — Thinking Over Time

| Tool | Description |
|------|-------------|
| `cortex_what_do_i_think` | Synthesize current thinking on a topic |
| `cortex_what_was_i_thinking` | Time-travel snapshot of a specific month |
| `cortex_thinking_trajectory` | How thinking on a concept evolved — genesis, timeline, stages |
| `cortex_cognitive_patterns` | Monthly activity, thinking stages, domain focus |

### Cortex — Domains & Threads

| Tool | Description |
|------|-------------|
| `cortex_context_recovery` | Full re-entry brief for a domain |
| `cortex_tunnel_state` | Cognitive save-state — where you left off, what's open |
| `cortex_tunnel_history` | Meta-view of engagement with a domain over time |
| `cortex_open_threads` | Global inventory of unfinished work across domains |
| `cortex_dormant_contexts` | Abandoned domains that still have open questions |
| `cortex_switching_cost` | Cognitive cost of switching between two domains |
| `cortex_stats` | Knowledge-base overview — counts, domains, stages, recency |

### Knowledge — Lessons That Outlive Their Context

| Tool | Description |
|------|-------------|
| `know_store` | Store an abstracted principle or lesson that survives without its original context. Embeds for retrieval; pass the sources it came from |
| `know_query` | Usage-weighted search — semantic similarity 60% + heat 30% + confidence 10%. Contradicted items filtered. Every query is a vote |
| `know_extract` | Propose candidates from pattern detection across recent observations and journals. Returns candidates only; stores nothing |
| `know_reinforce` | Boost an item when it proves true again (heat +0.2, confidence +0.05); also activates a candidate or revives a cooling item |
| `know_contradict` | Flag a contradiction (confidence -0.15). Below 0.2 the item is marked contradicted and filtered — the kill signal |
| `know_landscape` | Overview — status counts, categories, hottest, cooling, candidates awaiting review, curriculum progress |
| `know_session_start` | Start a curriculum practice session. Tracks: writing, architecture, emotional-literacy, voice |
| `know_session_complete` | Complete a session — notes, work, reflection; reinforces the items touched (+0.15 heat each) |
| `know_session_list` | List practice sessions and curriculum progress across the four tracks |

### Soul — Identity Portraits

| Tool | Description |
|------|-------------|
| `soul_gather` | Read the whole mind through one companion's ledger and return the raw material — no generation, no writes |
| `soul_generate` | Full pipeline: gather → synthesise → store as PENDING. Takes 30–60s. Nothing becomes active until validated |
| `soul_read` | Read a companion's active (human-validated) portrait; `pending:true` or `version:N` for others |
| `soul_validate` | The human gate — validate promotes the pending portrait to active; reject keeps the current active |
| `soul_history` | List versions — status, dates, word counts, who validated or rejected and why |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the cognitive systems work
- [`docs/alternative-embeddings.md`](docs/alternative-embeddings.md) — changing the bound Workers AI embedding provider safely
- [`../ATTRIBUTION.md`](../ATTRIBUTION.md) — lineage and ported ideas, with receipts
- [`CHANGELOG.md`](CHANGELOG.md) — what changed and when

## License

Apache 2.0 — see [LICENSE](LICENSE).
