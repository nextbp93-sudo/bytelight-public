import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { initDb } from '../services/db/init.js';
import { createAppSettingsRoutes } from './app-settings-routes.js';

async function listen() {
  const app = express();
  app.use(express.json());
  app.use(createAppSettingsRoutes());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('app settings starts empty and round-trips one nested setup document', async () => {
  initDb(':memory:');
  const { base, close } = await listen();
  try {
    const empty = await fetch(`${base}/app-settings`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { settings: null });

    const settings = {
      theme: { id: 'monochrome', mode: 'dark' },
      contacts: { ash: { name: 'Ash' } },
      appSettings: { osName: 'Bytelight OS' },
      extras: { core_defense_best: '17' },
    };
    const saved = await fetch(`${base}/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { settings });

    const read = await fetch(`${base}/app-settings`);
    assert.deepEqual(await read.json(), { settings });
  } finally {
    await close();
  }
});

test('app settings refuses missing, scalar and array payloads without replacing the saved copy', async () => {
  initDb(':memory:');
  const { base, close } = await listen();
  try {
    const valid = { appSettings: { groupChatName: 'Ours' } };
    await fetch(`${base}/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: valid }),
    });

    for (const body of [{}, { settings: null }, { settings: [] }, { settings: 'nope' }]) {
      const refused = await fetch(`${base}/app-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(refused.status, 400);
      assert.deepEqual(await refused.json(), { error: 'settings must be a JSON object' });
    }

    const read = await fetch(`${base}/app-settings`);
    assert.deepEqual(await read.json(), { settings: valid });
  } finally {
    await close();
  }
});

