import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontend = join(import.meta.dirname, '..');

test('the house exposes a dedicated Journal screen from chat', () => {
  const page = readFileSync(join(frontend, 'routes/journal/+page.svelte'), 'utf8');
  const chat = readFileSync(join(frontend, 'routes/chat/+page.svelte'), 'utf8');
  assert.match(page, /\/api\/journal/);
  assert.match(page, /entry_type/);
  assert.match(page, /companion_id/);
  assert.match(chat, /\{base\}\/journal/);
});
