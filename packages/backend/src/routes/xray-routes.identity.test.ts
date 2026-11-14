import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { createXrayRoutes } from './xray-routes.js';

test('identity editor reads and writes the configured document, not process.cwd()', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bytelight-identity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const identityPath = join(dir, 'AGENTS.md');
  writeFileSync(identityPath, 'Ash identity v1\n', 'utf8');

  const app = express();
  app.use(express.json());
  app.use(createXrayRoutes({ identityPath }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const readResponse = await fetch(`${base}/xray/identity`);
  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), {
    content: 'Ash identity v1\n',
    path: identityPath,
    name: 'AGENTS.md',
  });

  const writeResponse = await fetch(`${base}/xray/identity`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Ash identity v2\n' }),
  });
  assert.equal(writeResponse.status, 200);
  assert.equal(readFileSync(identityPath, 'utf8'), 'Ash identity v2\n');
  assert.equal(readFileSync(`${identityPath}.backup`, 'utf8'), 'Ash identity v1\n');
});
