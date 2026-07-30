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
  extractModelInfo,
  filterModelIds,
  fetchRemoteModels,
  parseJsoncConfig,
  resolveProviderApiKey,
  syncProviderModels,
  writeConfig,
} from '../model-sync-core.js';

async function fileExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

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

test('extractModelInfo maps LiteLLM metadata to OpenCode model fields', () => {
  const info = extractModelInfo({ data: [{
    model_name: 'vision-coder',
    model_info: {
      mode: 'chat',
      max_input_tokens: 128000,
      max_output_tokens: '8192',
      supports_vision: true,
      supports_reasoning: false,
      supports_function_calling: true,
      input_cost_per_token: 0.000002,
      output_cost_per_token: '0.000006',
      cache_read_input_token_cost: 0.0000002,
    },
  }] });

  assert.deepEqual(info.get('vision-coder'), {
    name: 'vision-coder',
    mode: 'chat',
    limit: { context: 128000, output: 8192 },
    attachment: true,
    reasoning: false,
    tool_call: true,
    cost: { input: 2, output: 6, cache_read: 0.2 },
  });
});

test('syncProviderModels enriches models from an optional info endpoint', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/v1/model/info') {
      res.end(JSON.stringify({ data: [{ model_name: 'coder', model_info: {
        mode: 'chat', max_input_tokens: 32000, supports_function_calling: true,
      } }] }));
    } else {
      res.end(JSON.stringify({ data: [{ id: 'coder' }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const providerConfig = {
      options: { baseURL: `http://127.0.0.1:${address.port}/v1`, modelSync: {
        enabled: true, infoEndpoint: '/model/info',
      } },
      models: { coder: { name: 'My Coder' } },
    };
    const result = await syncProviderModels('litellm', providerConfig);
    assert.equal(result.changed, true);
    assert.deepEqual(providerConfig.models.coder, {
      name: 'My Coder', mode: 'chat', limit: { context: 32000 }, tool_call: true,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('filterModelIds applies include and exclude regex', () => {
  const input = ['gpt-4.1', 'text-embedding-3-large', 'coder-pro'];
  const output = filterModelIds(input, 'gpt|coder', 'embedding');
  assert.deepEqual(output, ['gpt-4.1', 'coder-pro']);
});

test('parseJsoncConfig supports comments and trailing commas without changing string values', () => {
  const parsed = parseJsoncConfig(`{
    // comment
    "url": "https://example.com/a,}",
    "items": [
      "one",
    ],
  }`);

  assert.equal(parsed.url, 'https://example.com/a,}');
  assert.deepEqual(parsed.items, ['one']);
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

test('syncProviderModels forwards custom provider headers and resolves environment values', async () => {
  const originalApiKey = process.env.NEWAPI_KEY;
  process.env.NEWAPI_KEY = 'newapi-secret';
  let receivedHeaders;
  const server = http.createServer((req, res) => {
    receivedHeaders = req.headers;
    if (req.headers['x-api-key'] === 'newapi-secret') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'authenticated-model' }] }));
      return;
    }
    res.writeHead(401).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const providerConfig = {
      options: {
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        apiKey: 'bearer-secret',
        headers: {
          'x-api-key': '{env:NEWAPI_KEY}',
          Authorization: 'Custom provider-token',
        },
        modelSync: { enabled: true },
      },
      models: {},
    };

    const result = await syncProviderModels('newapi', providerConfig);

    assert.deepEqual(result.added, ['authenticated-model']);
    assert.equal(receivedHeaders['x-api-key'], 'newapi-secret');
    assert.equal(receivedHeaders.authorization, 'Custom provider-token');
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.NEWAPI_KEY;
    } else {
      process.env.NEWAPI_KEY = originalApiKey;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test('syncProviderModels can replace local models from the remote list', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'remote-a' }, { id: 'remote-b' }] }));
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
    const providerConfig = {
      options: {
        baseURL,
        modelSync: {
          enabled: true,
          endpoint: '/models',
          mode: 'replace',
        },
      },
      models: {
        localOnly: { name: 'localOnly' },
        'remote-a': { name: 'custom name' },
      },
    };

    const result = await syncProviderModels('mock', providerConfig);

    assert.deepEqual(result.added, ['remote-b']);
    assert.deepEqual(result.removed, ['localOnly']);
    assert.deepEqual(Object.keys(providerConfig.models).sort(), ['remote-a', 'remote-b']);
    assert.deepEqual(providerConfig.models['remote-a'], { name: 'remote-a' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ModelSyncPlugin reads opencode.jsonc and preserves comments while writing the same file', async (t) => {
  delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  t.after(() => {
    delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'remote-a' }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonc-config-test-'));
  const configPath = path.join(dir, 'opencode.jsonc');
  const jsonPath = path.join(dir, 'opencode.json');

  await fs.writeFile(
    configPath,
    `{
  // keep root comment
  "provider": {
    "mock": {
      "options": {
        "baseURL": "${baseURL}",
        "modelSync": {
          "enabled": true,
          "endpoint": "/models",
        },
      },
      // keep models comment
      "models": {
        "local-a": { "name": "local-a" },
      },
    },
  },
}
`,
    'utf8',
  );

  const originalConfig = process.env.OPENCODE_CONFIG;
  process.env.OPENCODE_CONFIG = configPath;

  try {
    await ModelSyncPlugin({});

    assert.equal(await fileExists(jsonPath), false);
    const raw = await fs.readFile(configPath, 'utf8');
    assert.match(raw, /keep root comment/);
    assert.match(raw, /keep models comment/);

    const parsed = parseJsoncConfig(raw);
    assert.deepEqual(Object.keys(parsed.provider.mock.models).sort(), ['local-a', 'remote-a']);
  } finally {
    if (originalConfig === undefined) {
      delete process.env.OPENCODE_CONFIG;
    } else {
      process.env.OPENCODE_CONFIG = originalConfig;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ModelSyncPlugin writes successful providers when another provider is rate-limited', async (t) => {
  delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  t.after(() => {
    delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  });

  const server = http.createServer((req, res) => {
    if (req.url === '/working/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'new-model' }] }));
      return;
    }
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate limited' }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'partial-sync-test-'));
  const configPath = path.join(dir, 'opencode.json');
  const baseURL = `http://127.0.0.1:${address.port}`;
  await fs.writeFile(configPath, JSON.stringify({
    provider: {
      newapi: {
        options: { baseURL, modelSync: { enabled: true, endpoint: '/working/models' } },
        models: {},
      },
      mingie: {
        options: { baseURL, modelSync: { enabled: true, endpoint: '/limited/models' } },
        models: { 'existing-model': { name: 'existing-model' } },
      },
    },
  }, null, 2));

  const originalConfig = process.env.OPENCODE_CONFIG;
  process.env.OPENCODE_CONFIG = configPath;
  try {
    await ModelSyncPlugin({});
    const updated = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.deepEqual(updated.provider.newapi.models, { 'new-model': { name: 'new-model' } });
    assert.deepEqual(updated.provider.mingie.models, { 'existing-model': { name: 'existing-model' } });
  } finally {
    if (originalConfig === undefined) {
      delete process.env.OPENCODE_CONFIG;
    } else {
      process.env.OPENCODE_CONFIG = originalConfig;
    }
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
