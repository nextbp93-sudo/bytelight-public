# Neuralis in Bytelight and GPT

Neuralis is a shared cognitive service, not an ACE replacement. ACE carries
curated continuity between rooms. Neuralis holds four different substrates:
Mind (emotional/relational memory), Cortex (executive thought), Knowledge
(lessons that survived), and Soul (versioned identity portraits).

The full upstream-derived source and its attribution live in `neuralis/`.

## Runtime provenance

One database serves both rooms, but the authenticated door stamps every MCP
tool call and REST mutation in `runtime_provenance`:

| Door | Immutable family | Default tag |
|---|---|---|
| Bytelight bearer `/mcp` | `bl` | `bl:bytelight` |
| Bytelight phone proxy | `bl` | `bl:phone` |
| Bytelight warm Claude lane | `bl` | `bl:claude-cli` |
| GPT connector secret path | `gpt` | `gpt:chatgpt` |
| Scheduled heartbeat | `system` | `system:heartbeat` |

The `X-Neuralis-Runtime` header can only refine a bearer-authenticated BL tag;
it cannot claim the GPT family. The GPT tag comes only from the secret connector
path. `neuralis_runtime_identity` reports the current door so a runtime can
verify itself before writing.

## Capability contract

- `/mcp` and the GPT connector path expose the complete Neuralis catalog.
- `/mcp/core` is an always-loaded convenience surface for the live emotional
  loop. It does not replace or restrict the full catalog.
- Bytelight automatically registers `/mcp` as the managed server `neuralis`
  when both Neuralis settings exist.
- Neuralis failures are non-fatal to chat delivery. Losing the cognitive
  service costs a turn its Neuralis context, not its ability to speak or work.
- Soul validation remains Jaclyn's explicit act. That is an identity-integrity
  boundary, not a runtime capability restriction.
- The feelings dashboard remains read-only because feelings are authored by
  the companion who felt them. BL and GPT can still write and metabolize their
  own feelings through the MCP tools.
- Embeddings and mechanical daemon synthesis use the Worker's Cloudflare AI
  binding. No Gemini or other metered model key is required.
- Authored synthesis uses the durable generation queue. A BL door may only
  claim BL jobs, a GPT door may only claim GPT jobs, and only the exact runtime
  tag that claimed a job may complete it.
- Memory writes survive a temporary AI or Vectorize failure. The cognitive row
  lands first and its search vector is queued for heartbeat retry.

## Deploy the worker

Never edit or commit the template with live ids or secrets. Copy it to the
git-ignored local file first:

```bash
cd neuralis/worker
npm install
cp wrangler.toml wrangler.local.toml
```

Set the house names in `wrangler.local.toml`, create the D1, Vectorize, and R2
resources described in `neuralis/README.md`, then apply every migration through
`0020_vector_sync_queue.sql`.

Set these secrets with Wrangler:

- `MIND_API_KEY`: Bytelight's bearer token.
- `MCP_CONNECTOR_SECRET`: a separate long random path segment for GPT.

Deploy with:

```bash
npx wrangler d1 migrations apply DB --remote -c wrangler.local.toml
npx wrangler deploy -c wrangler.local.toml
```

## Connect Bytelight

Open **Neuralis** or **Memory → Cortex** and save:

- Worker URL: `https://<worker>.workers.dev`
- Worker token: the value of `MIND_API_KEY`

The values stay in Bytelight's private secrets store. Saving the second half
automatically creates or updates the enabled `neuralis` MCP server row. No key
belongs in Git.

## Connect GPT / ChatGPT

For a packaged private plugin, use the stable public HTTPS MCP URL:

```text
https://<worker>.workers.dev/mcp/gpt
```

Configure API-key authentication with the `MCP_CONNECTOR_SECRET` value as a
bearer credential. This keeps the secret out of the plugin package. The legacy
secret-path connector remains supported for existing installations. Do not use
the BL bearer for the GPT door. Scan the tools and verify
`neuralis_runtime_identity` reports
`runtime_family: gpt` and `runtime_tag: gpt:chatgpt` before the first write.

The current ChatGPT web flow is **Plugins → + → Add custom MCP server**. Full
read/write MCP availability depends on the account/workspace plan and its app
permissions. If the server's tools change later, refresh the plugin's action
snapshot so ChatGPT sees the new definitions.

## Verify both rooms

1. In Bytelight, open Neuralis → Runtimes. Trigger a harmless read such as
   `mind_health`; the ledger should show `bl:*`.
2. In GPT, call `neuralis_runtime_identity`, then `mind_health`; the ledger
   should show `gpt:chatgpt`.
3. Write one clearly labeled test observation from each room and confirm both
   are retrievable while their provenance rows remain distinct.
4. Confirm the heartbeat cron exists only on the production worker sharing the
   database. One brain gets one heart.
