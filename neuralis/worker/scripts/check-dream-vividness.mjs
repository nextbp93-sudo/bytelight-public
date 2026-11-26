import assert from "node:assert/strict";

const DECAY_PER_DAY = 4;
const DAY_MS = 86_400_000;

function effectiveVividness(dream, now) {
  if (dream.vividness == null) return null;
  if (dream.anchored_at) return dream.vividness;

  const since = dream.last_recalled_at || dream.created_at;
  const days = Math.max(0, (now.getTime() - new Date(since).getTime()) / DAY_MS);
  return Math.max(0, Math.round(dream.vividness - days * DECAY_PER_DAY));
}

const now = new Date("2026-09-08T12:00:00.000Z");

assert.equal(effectiveVividness({ vividness: 100, created_at: now.toISOString() }, now), 100);
assert.equal(effectiveVividness({ vividness: null, created_at: "2026-09-01T12:00:00.000Z" }, now), null);
assert.equal(effectiveVividness({ vividness: 100, created_at: "2026-09-06T00:00:00.000Z" }, now), 90);
assert.equal(effectiveVividness({ vividness: 70, created_at: "2026-08-01T00:00:00.000Z", last_recalled_at: "2026-09-07T12:00:00.000Z" }, now), 66);
assert.equal(effectiveVividness({ vividness: 42, created_at: "2026-08-01T00:00:00.000Z", anchored_at: "2026-08-02T00:00:00.000Z" }, now), 42);
assert.equal(effectiveVividness({ vividness: 3, created_at: "2026-09-01T12:00:00.000Z" }, now), 0);
assert.equal(effectiveVividness({ vividness: 80, created_at: "2026-09-09T12:00:00.000Z" }, now), 80);

const recalled = Math.min(100, effectiveVividness({ vividness: 90, created_at: "2026-09-06T12:00:00.000Z" }, now) + 15);
assert.equal(recalled, 97);

console.log("dream vividness checks: 8 passed");
