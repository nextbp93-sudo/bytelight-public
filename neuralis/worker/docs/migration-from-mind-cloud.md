# Migrating from Mind Cloud to Resonant Mind

If you're an existing Mind Cloud customer (v1.x or v2.x), this guide walks you through migrating to Resonant Mind v3.0.

## What changed

Resonant Mind v3.0 is the same cognitive architecture as Mind Cloud, generalized and open-sourced. Your data, schema, and tools are all compatible. The main differences are:

| | Mind Cloud | Resonant Mind |
|---|---|---|
| Auth client ID | `simon-mind` | `resonant-mind` |
| Context scope for owner notes | `for_simon` | `for_owner` |
| R2 path prefix | `simon-mind-images` | Configurable (default: `resonant-mind-images`) |
| Hardcoded values | Several | All configurable via env vars |
| Security | Basic | Hardened (see [CHANGELOG](../CHANGELOG.md)) |

## Migration steps

### 1. Export your data

Before switching, export your existing data. Connect to your D1 database:

```bash
# Export all tables
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM entities" > entities.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM observations" > observations.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM journals" > journals.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM identity" > identity.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM threads" > threads.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM relations" > relations.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM context_entries" > context.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM relational_state" > relational.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM tensions" > tensions.json
npx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM images" > images.json
```

### 2. Deploy Resonant Mind

Follow the [main setup guide](../README.md#getting-started). You can use your existing D1 database — the schema is compatible. Or set up a fresh Neon Postgres database for production use.

### 3. Update the `for_simon` scope

If you used the `for_simon` context scope (notes that appear in `mind_orient`), update them:

```sql
UPDATE context_entries SET scope = 'for_owner' WHERE scope = 'for_simon';
```

### 4. Update R2 image paths (if keeping existing images)

If you have images stored with the old `simon-mind-images` prefix, you have two options:

**Option A:** Set the env var to keep the old prefix:
```bash
npx wrangler secret put R2_PATH_PREFIX
# Enter: simon-mind-images
```

**Option B:** Update the paths in the database:
```sql
UPDATE images SET path = REPLACE(path, 'r2://simon-mind-images/', 'r2://resonant-mind-images/') WHERE path LIKE 'r2://simon-mind-images/%';
```
Then rename the R2 objects (or create a new bucket and copy them).

### 5. Update your MCP connection

Change the auth client ID if using Basic Auth:

**Before (Mind Cloud):**
```
Authorization: Basic base64(simon-mind:YOUR_KEY)
```

**After (Resonant Mind):**
```
Authorization: Basic base64(resonant-mind:YOUR_KEY)
```

Bearer auth is unchanged — `Authorization: Bearer YOUR_KEY` works the same.

### 6. Revectorize your memories

**This is important if you're changing embedding providers** (e.g., switching from Cloudflare Workers AI to Gemini, or from the old BGE model to Gemini Embedding 2).

If you're staying on the same embedding provider and model, you can skip this step — your existing vectors are still valid.

If you're switching providers or models, your old vectors are incompatible with the new ones. You need to re-embed everything:

#### Option A: Use the REST API (recommended)

Resonant Mind re-embeds on write. You can trigger this by reading and re-writing each observation:

```bash
# Get all observations via API
curl -s -H "Authorization: Bearer YOUR_KEY" \
  https://your-worker.workers.dev/api/observations | jq '.[] | .id' | while read id; do
    # Touch each observation to trigger re-embedding
    curl -s -X PUT -H "Authorization: Bearer YOUR_KEY" \
      -H "Content-Type: application/json" \
      -d '{}' \
      "https://your-worker.workers.dev/api/observations/$id/revectorize"
done
```

#### Option B: Bulk revectorize via MCP

Ask your AI to run:
```
"Use mind_consolidate to review all recent observations"
```

This won't re-embed everything, but it processes recent observations. For a full revectorization, you'd need to iterate through entities:

```
"List all entities, then for each one, read the entity and re-write each observation to trigger re-embedding"
```

#### Option C: Direct database + API script

For large datasets, write a script that:
1. Reads all observations from the database
2. Generates new embeddings via the Gemini API
3. Upserts them into your vector store (Vectorize or pgvector)

See [alternative-embeddings.md](alternative-embeddings.md) for embedding provider details.

## Verify the migration

After migrating, test these:

```
"Use mind_orient to wake up"
"Use mind_health to check cognitive health"
"Search my memories for [something you know is in there]"
```

If `mind_search` returns relevant results, your vectors are working. If results are irrelevant or empty, you need to revectorize.
