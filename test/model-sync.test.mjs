import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ModelSyncPlugin,
} from '../index.js';
import * as pluralShim from '../.opencode/plugins/model-sync.js';
import {
  __internal,
  backupConfig,
  buildModelsUrl,
  extractModelIds,
  filterModelIds,
  fetchRemoteModels,
  resolveProviderApiKey,
  syncProviderModels,
  writeConfig,
} from '../model-sync-core.js';

test('buildModelsUrl normalizes slashes', () => {
  assert.equal(buildModelsUrl('https://example.com/v1/', '/models'), 'https://example.com/v1/models');
  assert.equal(buildModelsUrl('https://example.com/v1', 'models'), 'https://example.com/v1/models');
  assert.equal(buildModelsUrl('https://example.com/v1', 'https://another/models'), 'https://another/models');
});

test('extractModelIds supports multiple payload formats', () => {
  assert.deepEqual(extractModelIds({ object: 'list', data: [{ id: 'a' }, { name: 'b' }] }), ['a', 'b']);
  assert.deepEqual(extractModelIds([{ model: 'c' }, 'd']), ['c', 'd']);
  assert.deepEqual(extractModelIds({ models: [{ id: 'e' }] }), ['e']);
});

test('filterModelIds applies include and exclude regex', () => {
  const input = ['gpt-4.1', 'text-embedding-3-large', 'coder-pro'];
  const output = filterModelIds(input, 'gpt|coder', 'embedding');
  assert.deepEqual(output, ['gpt-4.1', 'coder-pro']);
});

test('fetchRemoteModels + syncProviderModels with local mock endpoint', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model' }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseURL = `http://127.0.0.1:${address.port}/v1`;

  try {
    const payload = await fetchRemoteModels(`${baseURL}/models`, '', 5000);
    assert.deepEqual(payload, { object: 'list', data: [{ id: 'test-model' }] });

    const providerConfig = {
      options: {
        baseURL,
        modelSync: {
          enabled: true,
          endpoint: '/models',
          excludeRegex: null,
          includeRegex: null,
          timeoutMs: 5000,
          dryRun: false,
        },
      },
      models: {},
    };

    const result = await syncProviderModels('mock', providerConfig);
    assert.equal(result.added.length, 1);
    assert.deepEqual(result.added, ['test-model']);
    assert.deepEqual(providerConfig.models['test-model'], { name: 'test-model' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('writeConfig writes JSON atomically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-sync-test-'));
  const configPath = path.join(dir, 'opencode.json');
  await writeConfig(configPath, { provider: { demo: { models: { a: { name: 'a' } } } } });
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.provider.demo.models.a.name, 'a');
});

test('backupConfig writes backups into sibling backups directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-dir-test-'));
  const configPath = path.join(dir, 'opencode.json');
  await fs.writeFile(configPath, '{}\n', 'utf8');

  const backupPath = await backupConfig(configPath);

  assert.equal(path.dirname(backupPath), path.join(dir, 'backups'));
  assert.equal(path.basename(backupPath).startsWith('opencode.json.bak.'), true);
});

test('plural local shim re-exports package entrypoint', () => {
  assert.equal(pluralShim.default, ModelSyncPlugin);
  assert.deepEqual(Object.keys(pluralShim).sort(), ['ModelSyncPlugin', 'default']);
});

test('duplicate guard only allows first claim', (t) => {
  delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  t.after(() => {
    delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  });

  assert.equal(__internal.claimDuplicateGuard(), true);
  assert.equal(__internal.claimDuplicateGuard(), false);
});

test('resolveProviderApiKey falls back to OpenCode auth.json api credentials', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'model-sync-home-'));
  const authDir = path.join(home, '.local', 'share', 'opencode');
  await fs.mkdir(authDir, { recursive: true });
  await fs.writeFile(
    path.join(authDir, 'auth.json'),
    JSON.stringify({ example: { type: 'api', key: 'test-auth-key' } }, null, 2),
    'utf8',
  );

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  try {
    const apiKey = await resolveProviderApiKey('example', { apiKey: undefined });
    assert.equal(apiKey, 'test-auth-key');
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  }
});
