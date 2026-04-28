/**
 * MIT License
 *
 * Copyright (c) 2026 opencode-model-sync contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const LOG_PREFIX = '[opencode-model-sync]';
const DEFAULT_ENDPOINT = '/models';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * @param {string} message
 */
function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`${LOG_PREFIX} ${message}`);
}

/**
 * @param {string} message
 */
function error(message) {
  console.error(`${LOG_PREFIX} ${message}`);
}

/**
 * @param {string} candidate
 * @returns {Promise<boolean>}
 */
async function fileExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve opencode.json by priority:
 * 1) OPENCODE_CONFIG
 * 2) upward search from cwd
 * 3) ~/.config/opencode/opencode.json
 *
 * @returns {Promise<string|null>}
 */
export async function resolveConfigPath() {
  const explicit = process.env.OPENCODE_CONFIG;
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (await fileExists(resolved)) {
      return resolved;
    }
    warn(`OPENCODE_CONFIG is set but file does not exist: ${resolved}`);
  }

  let cursor = process.cwd();
  for (;;) {
    const candidate = path.join(cursor, 'opencode.json');
    if (await fileExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  const globalConfig = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  if (await fileExists(globalConfig)) {
    return globalConfig;
  }

  return null;
}

/**
 * Resolve env placeholder string in format "{env:VAR_NAME}".
 *
 * @param {unknown} value
 * @returns {string}
 */
export function resolveEnvValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const match = value.match(/^\{env:([A-Z0-9_]+)\}$/i);
  if (!match) {
    return value;
  }

  const envName = match[1];
  const resolved = process.env[envName] ?? '';
  if (!resolved) {
    warn(`Environment variable ${envName} is not set or empty.`);
  }
  return resolved;
}

/**
 * Build the full models URL from baseURL + endpoint, while avoiding bad slash joins.
 *
 * @param {string} baseURL
 * @param {string} endpoint
 * @returns {string}
 */
export function buildModelsUrl(baseURL, endpoint = DEFAULT_ENDPOINT) {
  const trimmedEndpoint = typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : DEFAULT_ENDPOINT;
  if (/^https?:\/\//i.test(trimmedEndpoint)) {
    return trimmedEndpoint;
  }

  if (!baseURL || typeof baseURL !== 'string') {
    throw new Error('baseURL is required when endpoint is not absolute URL.');
  }

  const sanitizedBase = baseURL.replace(/\/+$/, '');
  const sanitizedEndpoint = trimmedEndpoint.replace(/^\/+/, '');
  return `${sanitizedBase}/${sanitizedEndpoint}`;
}

/**
 * Fetch remote model payload.
 *
 * @param {string} url
 * @param {string} apiKey
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
export async function fetchRemoteModels(url, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    /** @type {Record<string,string>} */
    const headers = { Accept: 'application/json' };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    try {
      return await response.json();
    } catch (parseErr) {
      throw new Error(`Invalid JSON payload: ${String(parseErr)}`);
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract model IDs from OpenAI-compatible and gateway payloads.
 *
 * @param {unknown} payload
 * @returns {string[]}
 */
export function extractModelIds(payload) {
  /** @type {unknown[]} */
  let list = [];

  if (Array.isArray(payload)) {
    list = payload;
  } else if (payload && typeof payload === 'object') {
    const maybeRecord = /** @type {Record<string, unknown>} */ (payload);
    if (Array.isArray(maybeRecord.data)) {
      list = maybeRecord.data;
    } else if (Array.isArray(maybeRecord.models)) {
      list = maybeRecord.models;
    }
  }

  const ids = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) {
      ids.push(item.trim());
      continue;
    }

    if (item && typeof item === 'object') {
      const modelObj = /** @type {Record<string, unknown>} */ (item);
      const candidate = modelObj.id ?? modelObj.name ?? modelObj.model;
      if (typeof candidate === 'string' && candidate.trim()) {
        ids.push(candidate.trim());
      }
    }
  }

  return [...new Set(ids)];
}

/**
 * @param {string[]} ids
 * @param {string|null|undefined} includeRegex
 * @param {string|null|undefined} excludeRegex
 * @returns {string[]}
 */
export function filterModelIds(ids, includeRegex, excludeRegex) {
  let includeRe = null;
  let excludeRe = null;

  if (includeRegex) {
    includeRe = new RegExp(includeRegex, 'i');
  }
  if (excludeRegex) {
    excludeRe = new RegExp(excludeRegex, 'i');
  }

  return ids.filter((id) => {
    if (includeRe && !includeRe.test(id)) {
      return false;
    }
    if (excludeRe && excludeRe.test(id)) {
      return false;
    }
    return true;
  });
}

/**
 * @param {string} configPath
 * @returns {Promise<string>}
 */
export async function backupConfig(configPath) {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = `${configPath}.bak.${stamp}`;
  await fs.copyFile(configPath, backupPath);
  return backupPath;
}

/**
 * Atomic write: write temp file then rename.
 *
 * @param {string} configPath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
export async function writeConfig(configPath, data) {
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, 'utf8');
  await fs.rename(tempPath, configPath);
}

/**
 * Sync one provider's remote models into local models map.
 *
 * @param {string} providerName
 * @param {Record<string, any>} providerConfig
 * @returns {Promise<{providerName: string, remoteCount: number, localCount: number, added: string[], dryRun: boolean}>}
 */
export async function syncProviderModels(providerName, providerConfig) {
  const options = providerConfig?.options ?? {};
  const modelSync = options.modelSync ?? {};
  const endpoint = modelSync.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = Number.isFinite(modelSync.timeoutMs) ? Number(modelSync.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const dryRun = Boolean(modelSync.dryRun);

  const apiKey = resolveEnvValue(options.apiKey);
  const modelsUrl = buildModelsUrl(options.baseURL, endpoint);

  const payload = await fetchRemoteModels(modelsUrl, apiKey, timeoutMs);
  const extracted = extractModelIds(payload);
  const filtered = filterModelIds(extracted, modelSync.includeRegex ?? null, modelSync.excludeRegex ?? null);

  if (!providerConfig.models || typeof providerConfig.models !== 'object') {
    providerConfig.models = {};
  }

  const localModels = providerConfig.models;
  const localIds = new Set(Object.keys(localModels));
  const added = filtered.filter((id) => !localIds.has(id));

  if (!dryRun) {
    for (const id of added) {
      localModels[id] = { name: id };
    }
  }

  return {
    providerName,
    remoteCount: filtered.length,
    localCount: localIds.size,
    added,
    dryRun,
  };
}

/**
 * OpenCode local plugin entrypoint.
 *
 * @param {{client?: unknown, app?: unknown, $?: unknown}} _ctx
 * @returns {Promise<Record<string, never>>}
 */
export const ModelSyncPlugin = async (_ctx) => {
  const configPath = await resolveConfigPath();
  if (!configPath) {
    warn('No opencode.json found. Skipping model sync.');
    return {};
  }

  log(`Config found: ${configPath}`);

  /** @type {Record<string, any>} */
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (err) {
    error(`Failed to read/parse config JSON: ${String(err)}`);
    return {};
  }

  const providers = config.provider ?? {};
  const providerNames = Object.keys(providers).filter((name) => providers?.[name]?.options?.modelSync?.enabled === true);

  if (providerNames.length === 0) {
    log('No providers with options.modelSync.enabled === true. Nothing to do.');
    return {};
  }

  log(`Providers to check: ${providerNames.join(', ')}`);

  let changed = false;
  let hasFailure = false;
  let totalAdded = 0;

  for (const providerName of providerNames) {
    try {
      const provider = providers[providerName];
      const result = await syncProviderModels(providerName, provider);
      totalAdded += result.added.length;

      log(
        `${providerName}: remote=${result.remoteCount}, local=${result.localCount}, added=${result.added.length}, dryRun=${result.dryRun}`,
      );

      if (result.added.length > 0) {
        log(`${providerName}: new models => ${result.added.join(', ')}`);
        if (!result.dryRun) {
          changed = true;
        }
      }
    } catch (err) {
      hasFailure = true;
      error(`${providerName}: sync failed: ${String(err)}`);
    }
  }

  if (hasFailure) {
    warn('At least one provider failed. For safety, config file will not be written.');
    return {};
  }

  if (!changed) {
    log('No config changes to write.');
    if (totalAdded > 0) {
      log('All additions were dry-run only.');
    }
    return {};
  }

  let backupPath;
  try {
    backupPath = await backupConfig(configPath);
    log(`Backup created: ${backupPath}`);
  } catch (err) {
    error(`Failed to backup config. Abort writing: ${String(err)}`);
    return {};
  }

  try {
    await writeConfig(configPath, config);
    log(`Config updated successfully: ${configPath}`);
    log(`已同步 ${totalAdded} 个模型，请重启 OpenCode 以刷新模型选择器。`);
  } catch (err) {
    error(`Failed to write config atomically: ${String(err)}`);
  }

  return {};
};

export default ModelSyncPlugin;

// Optional utility for tests and local diagnostics.
export const __internal = {
  LOG_PREFIX,
  DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  pathToFileURL,
};
