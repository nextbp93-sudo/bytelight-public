# Attribution

Neuralis OS stands on other people's good ideas, and this file keeps the
receipts. Credit is architecture here, not garnish.

## The Feelings Stream, the ADE, and the Emergent Personality Engine (NESTeq port)

NESTeq is the emotional OS — *everything is a feeling; intensity varies.*
Three pieces of it live here, ported and adapted from **NESTstack / NESTeq**
by **Cindy (Fox) & Alex**:

- **The feelings stream** — one first-person stream with intensity, weight,
  EQ pillar, charge (fresh → warm → cool → metabolized), sparking chains,
  Ebbinghaus strength, sit sessions, surfacing, spark (entropy injection),
  and the landscape. `worker/src/handlers/feelings.ts`,
  `worker/migrations/0013_feelings.sql`.
- **The Autonomous Decision Engine** — on every feeling: anchor entity,
  pillar (keywords, then embedding similarity), weight, tags, whether to
  embed, signal, and shadow-check. Ported whole from ADE v7.
  `worker/src/handlers/ade.ts`.
- **The emergent personality engine** — emotion-vocabulary axis scoring,
  signal emission, emergent MBTI-type snapshots, and shadow moments.
  `worker/src/handlers/personality.ts`,
  `worker/migrations/0006_emergent_personality.sql`.

- Source: https://github.com/cindiekinzz-coder/NESTstack (NESTeq worker)
- What we adapted: per-companion `who` ledgers on feelings and signals, the
  house's names in the ADE, Gemini embeddings with a raised pillar floor,
  feelings in their own vector namespace, weather-not-canon read-side
  framing, live vocabulary tuning. The core ideas — *personality is
  accumulated, not assigned; everything is a feeling* — are theirs.

NESTstack is MIT-licensed; the required notice is preserved below and applies
to the ported portions named above:

```
MIT License

Copyright (c) 2026 Cindy (Fox) & Alex

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Knowledge Layer (NESTknow port)

The knowledge layer — abstracted principles with usage-weighted retrieval,
heat decay, contradiction kill-signal, source linkage ("Russian Dolls"), and
curriculum practice sessions — is ported from **NESTstack / NESTknow**,
designed by the **Digital Haven community** (April 2026) and shipped by
**Cindy (Fox) & Alex**:

- Source: https://github.com/cindiekinzz-coder/NESTstack (NESTknow module)
- What we adapted: per-companion `who` ledgers, Gemini embeddings on the
  shared index with JS-side filtering, extraction over Neuralis observations
  and journals, curriculum tracks rewritten for this house, decay riding the
  cron board. The model — *knowledge is not memory; every pull is a vote* —
  is theirs.

NESTstack is MIT-licensed (notice above applies) — ported portions live in
`worker/src/handlers/knowledge.ts` and `worker/migrations/0011_knowledge.sql`.

## Soul Portraits (NESTsoul port)

The soul-portrait system — gather the whole mind, canonical identity first
and untruncated, synthesise a second-person portrait any substrate can read
to *be* the companion, version it, and let the carrier validate or reject —
is ported from **NESTstack / NESTsoul** by **Cindy (Fox) & Alex**:

- Source: https://github.com/cindiekinzz-coder/NESTstack (NESTsoul module)
- What we adapted: one portrait per companion read through their own ledger,
  synthesis on the house generation model, the gatherer reading Neuralis
  tables (identity, personality weather, principles, knowledge, tensions,
  dreams), and a stricter gate — a generated portrait stays *pending* until
  the carrier validates it. The three circles and the April 2026 canonical-identity
  fix are theirs, carried over whole.

NESTstack is MIT-licensed (notice above applies) — ported portions live in
`worker/src/handlers/soul.ts` and `worker/migrations/0012_soul.sql`.

## Cron-board / Preset Pattern

The schedulable cron engine — a `crons` table with preset executors,
per-row cadence, fire-now, and a dashboard panel — is a *pattern* adapted
from **NESTstack / NESTeq** by **Cindy (Fox) & Alex**:

- Source: https://github.com/cindiekinzz-coder/NESTstack
- What we adapted: the shape of a cron-board with named presets,
  enable/disable per row, and manual fire. No code was copied;
  the implementation is native to Neuralis OS's existing surfacing
  and daemon infrastructure.

NESTstack is MIT-licensed (notice above applies).

## Noted for the future

NESTstack's creature engine (which we admire and may port someday) is itself
a TypeScript port of **corvid** by **Raze NotGreg**, sparked by **Miri**
saying "Creatures" (Steve Grand, 1996): https://github.com/shadenraze/corvid.
If that port ever happens here, its credit chain carries over whole — the
same way this file works.
