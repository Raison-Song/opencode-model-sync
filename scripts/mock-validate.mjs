#!/usr/bin/env node
import http from 'node:http';
import { syncProviderModels } from '../model-sync-core.js';

const server = http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model' }] }));
});

server.listen(0, async () => {
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}/v1`;

  const providerConfig = {
    options: {
      baseURL,
      modelSync: {
        enabled: true,
        endpoint: '/models',
        timeoutMs: 3000,
        dryRun: true,
      },
    },
    models: {},
  };

  try {
    const result = await syncProviderModels('mock', providerConfig);
    console.log('Mock validate result:', result);
    console.log('Dry-run should keep models empty =>', providerConfig.models);
  } finally {
    server.close();
  }
});
