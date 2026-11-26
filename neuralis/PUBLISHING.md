# Sharing This Repo

This tree is safe to hand to a friend: it carries no secrets, no owner's
address, and no owner's people. Everything that makes a brain *yours*
lives in files git never sees. This page says what those files are, so a
friend can set up their own brain and the owner can keep deploying hers.

## What lives where

| What | Where | In git? |
|------|-------|---------|
| The code, migrations, docs | everything tracked | yes |
| A template deploy config | `worker/wrangler.toml` | yes, with placeholders |
| **Your** deploy config (database id, resource names, your house) | a local copy, e.g. `worker/wrangler.local.toml` | no, git-ignored |
| The dashboard's worker address and your house | `dashboard/.env.local` | no, git-ignored |
| API keys and the connector secret | Cloudflare's secret store (`wrangler secret put`) | never |

## Setting up your own brain

1. **Make your deploy config.** Copy `worker/wrangler.toml` to
   `worker/wrangler.local.toml`. In the copy:
   - put the `database_id` that `npx wrangler d1 create neuralis` printed;
   - change `name`, `database_name`, `index_name`, `bucket_name` if you
     want different names (create the resources with the same names);
   - fill in the `[define]` block with your house.

2. **Tell it who lives there.** The `[define]` block is read at build time.
   Values are JavaScript literals written as TOML strings, so a name keeps
   its own quotes inside:

   ```toml
   [define]
   __HOUSE_HUMAN__ = "\"Sam\""
   __HOUSE_COMPANIONS__ = '[{"slug":"rowan","name":"Rowan","pronouns":"she"},{"slug":"ash","name":"Ash","pronouns":"he"}]'
   __HOUSE_HUMAN_CONTEXT__ = "\"human-world\""
   ```

   - Any number of companions works: one, two, five.
   - `slug` is what the brain stores in its `who` / `owner` columns and what
     the MCP tools accept (`who: "rowan"`). Lowercase, and never change it
     once there is data, or that companion's rows are orphaned. `shared` and
     `all` are reserved.
   - `name` is how prompts and the soul portraits say it.
   - `pronouns` is `he`, `she` or `they` (the default).
   - `__HOUSE_HUMAN_CONTEXT__` names the context bucket for your person's
     own life. Leave it as `human-world` on a new brain.
   - Leave a value out and the brain falls back to generic placeholders
     (`your person`, `Companion A`, `Companion B`).

3. **Deploy from your config.**

   ```bash
   cd worker
   npx wrangler d1 migrations apply DB --remote -c wrangler.local.toml
   npx wrangler deploy -c wrangler.local.toml
   ```

4. **Point the dashboard at it.** Create `dashboard/.env.local`:

   ```
   VITE_MIND_URL=https://your-worker.your-subdomain.workers.dev
   VITE_HOUSE_HUMAN=Sam
   VITE_HOUSE_COMPANIONS=[{"slug":"rowan","name":"Rowan","pronouns":"she"},{"slug":"ash","name":"Ash","pronouns":"he"}]
   ```

   Use the same slugs as the worker. Companions get colours in order
   (cyan, purple, amber, emerald, rose, sky).

## Before you share your copy

- Your local `wrangler.*.toml` and `dashboard/.env.local` are git-ignored;
  keep it that way.
- Check nothing personal crept back in:
  `git grep -nIiE "your-name|your-worker-subdomain|your-database-id"`.
- Old commits are history: if anything personal was ever committed, it is
  still readable in earlier commits even after it is removed from the tree.
  Share a fresh copy (or a squashed export) if that matters.

## What is already safe

- No credentials anywhere in the tree: API keys, tokens and the connector
  secret path live in Cloudflare's secret store.
- Worker URLs sit behind an auth wall regardless of who knows them.
