import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const pluginPath = process.argv[2];

if (!pluginPath) {
  console.error('Usage: node scripts/verify-local-opencode-plugin.mjs <plugin-dir>');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model' }] }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

try {
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-plugin-check-'));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-home-'));
  const configPath = path.join(dir, 'opencode.json');

  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      mocksync: {
        name: 'mocksync',
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'test-key',
          modelSync: {
            enabled: true,
            endpoint: '/models',
            timeoutMs: 5000,
            dryRun: false,
          },
        },
        models: {},
      },
    },
  };

  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const child = spawn('opencode.cmd', ['models', 'mocksync', '--print-logs', '--log-level', 'DEBUG'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OPENCODE_CONFIG: configPath,
    },
    shell: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const updated = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const hasModel = Object.prototype.hasOwnProperty.call(updated.provider.mocksync.models, 'test-model');
  const backupDir = path.join(dir, 'backups');
  const backupEntries = await fs.readdir(backupDir);
  const hasBackup = backupEntries.some((entry) => entry.startsWith('opencode.json.bak.'));

  console.log(`EXIT=${exitCode}`);
  console.log('STDOUT_START');
  console.log(stdout.trim());
  console.log('STDOUT_END');
  console.log('STDERR_START');
  console.log(stderr.trim());
  console.log('STDERR_END');
  console.log(`HAS_MODEL=${hasModel}`);
  console.log(`HAS_BACKUP=${hasBackup}`);

  if (exitCode !== 0 || !hasModel || !hasBackup) {
    process.exit(1);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
