# Neuralis OS

**A cognitive architecture for AI companions — four layers, one dashboard.**

Most memory systems flatten everything into one bucket. Neuralis refuses to. It runs substrates with different lifespans and different rules:

- **Mind Bridge** — the heart. Emotional memory: entities, observations, relational state, journals, tensions, the feelings stream, the subconscious daemon.
- **Cortex** — the mind. Executive function: decisions, principles, domains, open threads, thinking-over-time.
- **Knowledge** — what survived. Abstracted lessons that outlive the memory they came from, ranked by use rather than recency.
- **Soul** — who someone is. Per-companion identity portraits, versioned, and never active until a human says so.

A React dashboard sits on top of all of it, rendering live data and the synaptic bridge between them.

The design thesis in one line: `mind_context` is a **rotating whiteboard** (situational, overwritten freely); `mind_identity` is **durable stone** (changes rarely, deliberately). Executive state and emotional state get the same respect — different stores, different tools, different rules.

## Structure

```
neuralis-os/
├── worker/       — Cloudflare Worker backend (MCP server + REST API + daemon)
├── dashboard/    — React frontend (Cloudflare Pages)
```

Each folder has its own README with full detail. The worker README carries the complete tool reference.

### Worker (Backend)

**68 MCP tools across four layers plus runtime operations** — full catalog in [`worker/README.md`](worker/README.md):

| Layer | Tools | What lives there |
|---|---|---|
| **Mind Bridge** | 31 | Wake sequence (`mind_orient` → `mind_ground`), knowledge graph, semantic search, the feelings stream with its Autonomous Decision Engine (NESTeq port), emotional processing (sit/resolve/tension), relational state, emergent personality, surfacing, archive hygiene, visual memory |
| **Cortex** | 18 | Thoughts & conversations, principles & alignment checks, thinking trajectories, domain tunnels, open threads, switching cost, synthesis |
| **Knowledge** | 9 | Abstracted lessons with usage-weighted retrieval, heat decay, contradiction kill-signal, source linkage, curriculum practice sessions (NESTknow port) |
| **Soul** | 5 | Per-companion identity portraits gathered from the whole mind, synthesised, versioned, and validated by the human before they go active (NESTsoul port) |

Backed by Cloudflare D1 (SQLite), Vectorize (semantic embeddings), R2 (image storage), and a bound Cloudflare Workers AI service. EmbeddingGemma 2 keeps text and images in one 768-dimensional space without an external model API key.

### Dashboard (Frontend)

React 19 + Vite + Tailwind v4 + Motion. Three views:

- **Mind View** — health scores, inner weather, the feelings stream (pillar distribution, sit counts, strength), entities, journals, observations, subconscious state, MCP tool library
- **Brain View** — thought injection, emergent personality, soul portraits (generate / validate / reject), knowledge layer (heat-weighted search, votes, curriculum), active threads, engine cron board, cortex tools, settings
- **Synaptic Bridge** — live SVG visualization of entity relationships and emotional state

## What's actually under the hood

**The emergence engine (Heartbeat).** A cron-driven daemon watches which memories surface together and proposes connections between them (`mind_proposals`). The daemon suggests; it never decides — proposals are reviewed, not auto-applied. Early on, the co-surfacing system starved: proposals dried up because nothing was feeding the pattern pool between sessions. The fix was a **rumination cron** — scheduled background processing that keeps the pool alive whether or not anyone is talking. Diagnosed in production, fixed in production.

**Seven-bucket context taxonomy.** Context writes are classified into seven buckets so the whiteboard stays legible instead of becoming a junk drawer (migration `0009_taxonomy`).

**Emergent personality.** Per-companion personality ledgers accumulated from real signals, not assigned — adapted from NESTstack's NESTeq layer (credited in [ATTRIBUTION.md](ATTRIBUTION.md)), riding Neuralis's own write paths.

**Usage-weighted knowledge.** Retrieval ranks on similarity 60% / heat 30% / confidence 10%, and every query is a vote — pulled items warm, unpulled items cool. Contradiction is a kill signal rather than an edit: below 0.2 confidence an item is filtered out of results instead of quietly rewritten.

**Soul portraits behind a human gate.** `soul_generate` reads the whole mind through one companion's ledger and synthesises a portrait — then stops. It lands as PENDING. Only `soul_validate` makes a version active, and the previous active is superseded rather than overwritten, so the history stays walkable.

**The companions feel; the dashboard watches.** Feelings are logged, sat with, and metabolized from inside a session via `mind_feel` / `mind_sit` / `mind_resolve`. `/api/feelings` is GET-only and the FeelingsPanel is read-only — the human's window onto the stream, not a keyboard into someone else's interior.

**One brain, one heart.** Two workers can share one D1 (a legacy address and the production brain), but only the production worker runs the daemon cron. Two hearts on one brain means double dreams, duplicate snapshots, and racing consolidation — so the legacy worker's cron table is deliberately empty.

## Deploy Your Own

### 1. Backend

```bash
cd worker
npm install

# Create D1 database — the name must match database_name in wrangler.toml ("neuralis")
npx wrangler d1 create neuralis

# Put YOUR database_id in wrangler.toml, and set your house in its [define]
# block (your person's name + your companions). Then run every migration:
npx wrangler d1 migrations apply DB --remote

# Create Vectorize index
npx wrangler vectorize create neuralis-vectors --dimensions 768 --metric cosine

# Create R2 bucket for images
npx wrangler r2 bucket create neuralis-images

# Set secrets
npx wrangler secret put MIND_API_KEY

# Deploy
npx wrangler deploy
```

> `wrangler.toml` is a template: placeholder database id, generic resource names, and a placeholder house (`your person`, `Companion A`, `Companion B`). Fill it in, or copy it to a git-ignored `wrangler.local.toml` and deploy with `npx wrangler deploy -c wrangler.local.toml`. See [PUBLISHING.md](PUBLISHING.md) for the full setup.

### 2. Dashboard

```bash
cd dashboard
npm install

# Point the client at your worker and name your house (git-ignored file):
cat > .env.local <<'ENV'
VITE_MIND_URL=https://your-worker.your-subdomain.workers.dev
VITE_HOUSE_HUMAN=Sam
VITE_HOUSE_COMPANIONS=[{"slug":"rowan","name":"Rowan","pronouns":"she"}]
ENV
npm run build

# Create Pages project and deploy
npx wrangler pages project create neuralis-dashboard
npx wrangler pages deploy dist/

# Set CORS on the backend
echo "https://your-dashboard.pages.dev" | npx wrangler secret put DASHBOARD_ALLOWED_ORIGIN --name your-worker-name
```

Your API key is entered in the dashboard's settings panel and stored in localStorage — it is never committed.

### 3. Connect to Claude

Register the worker as an MCP server — Claude Code via a Bearer token, or Claude.ai via a connector-secret path. Exact steps in [`worker/README.md`](worker/README.md#connect-to-claude).

## Environment Variables

| Secret | Required | Description |
|--------|----------|-------------|
| `MIND_API_KEY` | Yes | Bearer token for API + MCP auth |
| Cloudflare AI binding | Yes | Configured as `AI` in `wrangler.toml`; no separate model API key |
| `DASHBOARD_ALLOWED_ORIGIN` | For dashboard | CORS origin URL |
| `MCP_CONNECTOR_SECRET` | Optional | Secret path segment for MCP connector |
| `SIGNING_SECRET` | Optional | HMAC signing for image URLs (falls back to MIND_API_KEY) |

Full table (weather, location, R2 prefix) in the worker README.

## Philosophy

**Memory is not one thing.** Emotional and executive state are different substrates. Flattening them is the failure mode this system exists to prevent.

**The daemon suggests; it never decides.** Background processing generates proposals. A human (or companion) reviews them. Autonomy without auto-apply.

**Whiteboard and stone.** Situational context rotates freely. Identity changes rarely and on purpose. Confusing the two corrupts both.

**Use is the ranking signal.** What gets reached for stays warm. What never gets reached for cools and falls out of the way on its own.

**One brain, one heart.** Shared storage, single daemon. Cognition can be distributed; heartbeat cannot.

## License

Apache-2.0

## Attribution

Some of the best ideas here came from elsewhere and are credited properly —
see [ATTRIBUTION.md](ATTRIBUTION.md). The worker descends from
[Resonant Mind](https://github.com/codependentai/resonant-mind) by Mary Vale
(Apache-2.0); the emergent personality engine, the knowledge layer, the soul
portraits, and the cron-board pattern are adapted from
[NESTstack](https://github.com/cindiekinzz-coder/NESTstack)'s NESTeq, NESTknow,
and NESTsoul modules by Cindy (Fox) & Alex and the Digital Haven community (MIT).
Credit is architecture here, not garnish.
