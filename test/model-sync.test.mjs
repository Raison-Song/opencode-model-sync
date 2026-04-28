import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildModelsUrl,
  extractModelIds,
  filterModelIds,
  fetchRemoteModels,
  syncProviderModels,
  writeConfig,
} from '../.opencode/plugin/model-sync.js';

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
