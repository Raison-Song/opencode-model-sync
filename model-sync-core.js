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
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LOG_PREFIX = '[opencode-model-sync]';
const DEFAULT_ENDPOINT = '/models';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SYNC_MODE = 'append';
const DUPLICATE_LOAD_KEY = Symbol.for('opencode-model-sync.loaded');

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
 * @returns {boolean}
 */
export function claimDuplicateGuard() {
  if (globalThis[DUPLICATE_LOAD_KEY]) {
    return false;
  }

  globalThis[DUPLICATE_LOAD_KEY] = true;
  return true;
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
 * @returns {Promise<Record<string, {type?: string, key?: unknown}>|null>}
 */
async function readOpencodeAuth() {
  const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
  if (!(await fileExists(authPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    warn(`Failed to read OpenCode auth.json: ${String(err)}`);
    return null;
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
    for (const filename of ['opencode.json', 'opencode.jsonc']) {
      const candidate = path.join(cursor, filename);
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  for (const filename of ['opencode.json', 'opencode.jsonc']) {
    const globalConfig = path.join(os.homedir(), '.config', 'opencode', filename);
    if (await fileExists(globalConfig)) {
      return globalConfig;
    }
  }

  return null;
}

/**
 * @param {string} source
 * @returns {string}
 */
function removeTrailingCommas(source) {
  let output = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < source.length) {
    const char = source[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < source.length && /\s/.test(source[lookahead])) {
        lookahead += 1;
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        index += 1;
        continue;
      }
    }

    output += char;
    index += 1;
  }

  return output;
}

/**
 * Strip JSONC comments and trailing commas for JSON.parse.
 *
 * @param {string} source
 * @returns {string}
 */
function normalizeJsonc(source) {
  let output = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        output += '  ';
        index += 2;
      }
      continue;
    }

    output += char;
    index += 1;
  }

  return removeTrailingCommas(output);
}

/**
 * @param {string} source
 * @returns {any}
 */
export function parseJsoncConfig(source) {
  return JSON.parse(normalizeJsonc(source));
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
 * @param {string} providerName
 * @param {{ apiKey?: unknown }} options
 * @returns {Promise<string>}
 */
export async function resolveProviderApiKey(providerName, options = {}) {
  const direct = resolveEnvValue(options.apiKey);
  if (direct) {
    return direct;
  }

  const auth = await readOpencodeAuth();
  const credential = auth?.[providerName];
  if (credential?.type === 'api' && typeof credential.key === 'string' && credential.key.trim()) {
    return credential.key.trim();
  }

  return '';
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
 * @param {string} source
 * @param {number} index
 * @returns {number}
 */
function skipWhitespaceAndComments(source, index) {
  let cursor = index;
  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor])) {
      cursor += 1;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < source.length && source[cursor] !== '\n') {
        cursor += 1;
      }
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      cursor += 2;
      while (cursor < source.length && !(source[cursor] === '*' && source[cursor + 1] === '/')) {
        cursor += 1;
      }
      cursor = Math.min(cursor + 2, source.length);
      continue;
    }
    return cursor;
  }
}

/**
 * @param {string} source
 * @param {number} start
 * @returns {{ value: string, end: number }}
 */
function readJsonString(source, start) {
  let cursor = start + 1;
  let escaped = false;
  while (cursor < source.length) {
    const char = source[cursor];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return { value: JSON.parse(source.slice(start, cursor + 1)), end: cursor + 1 };
    }
    cursor += 1;
  }
  throw new Error('Unterminated JSON string.');
}

/**
 * @param {string} source
 * @param {number} start
 * @returns {number}
 */
function findMatchingContainerEnd(source, start) {
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let cursor = start;

  while (cursor < source.length) {
    cursor = skipWhitespaceAndComments(source, cursor);
    const char = source[cursor];
    if (char === '"') {
      cursor = readJsonString(source, cursor).end;
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }

  throw new Error(`Unterminated JSON container starting at ${start}.`);
}

/**
 * @param {string} source
 * @param {number} start
 * @returns {number}
 */
function findValueEnd(source, start) {
  const cursor = skipWhitespaceAndComments(source, start);
  const char = source[cursor];
  if (char === '{' || char === '[') {
    return findMatchingContainerEnd(source, cursor);
  }
  if (char === '"') {
    return readJsonString(source, cursor).end;
  }

  let end = cursor;
  while (end < source.length && source[end] !== ',' && source[end] !== '}' && source[end] !== ']') {
    end += 1;
  }
  return end;
}

/**
 * @param {string} source
 * @param {number} objectStart
 * @param {string} propName
 * @returns {{keyStart: number, valueStart: number, valueEnd: number}|null}
 */
function findPropertyInObject(source, objectStart, propName) {
  if (source[objectStart] !== '{') {
    return null;
  }

  const objectEnd = findMatchingContainerEnd(source, objectStart) - 1;
  let cursor = objectStart + 1;
  while (cursor < objectEnd) {
    cursor = skipWhitespaceAndComments(source, cursor);
    if (source[cursor] === ',') {
      cursor += 1;
      continue;
    }
    if (source[cursor] !== '"') {
      cursor += 1;
      continue;
    }

    const keyStart = cursor;
    const key = readJsonString(source, cursor);
    cursor = skipWhitespaceAndComments(source, key.end);
    if (source[cursor] !== ':') {
      continue;
    }

    const valueStart = skipWhitespaceAndComments(source, cursor + 1);
    const valueEnd = findValueEnd(source, valueStart);
    if (key.value === propName) {
      return { keyStart, valueStart, valueEnd };
    }
    cursor = valueEnd;
  }

  return null;
}

/**
 * @param {string} source
 * @param {number} index
 * @returns {string}
 */
function lineIndentAt(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const match = source.slice(lineStart, index).match(/^\s*/);
  return match ? match[0] : '';
}

/**
 * @param {Record<string, unknown>} models
 * @param {string} indent
 * @returns {string}
 */
function stringifyModelsValue(models, indent) {
  return JSON.stringify(models, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join('\n');
}

/**
 * @param {string} source
 * @param {number} objectStart
 * @returns {boolean}
 */
function objectNeedsCommaBeforeInsert(source, objectStart) {
  let cursor = findMatchingContainerEnd(source, objectStart) - 2;
  while (cursor > objectStart && /\s/.test(source[cursor])) {
    cursor -= 1;
  }
  return source[cursor] !== '{' && source[cursor] !== ',';
}

/**
 * Best-effort JSONC-preserving update for provider.<name>.models.
 *
 * @param {string} originalText
 * @param {Record<string, any>} config
 * @param {string[]} providerNames
 * @returns {string|null}
 */
function updateConfigTextModels(originalText, config, providerNames) {
  const rootStart = skipWhitespaceAndComments(originalText, 0);
  if (originalText[rootStart] !== '{') {
    return null;
  }

  const providerProp = findPropertyInObject(originalText, rootStart, 'provider');
  if (!providerProp || originalText[providerProp.valueStart] !== '{') {
    return null;
  }

  const replacements = [];
  for (const providerName of providerNames) {
    const providerEntry = findPropertyInObject(originalText, providerProp.valueStart, providerName);
    if (!providerEntry || originalText[providerEntry.valueStart] !== '{') {
      return null;
    }

    const models = config.provider?.[providerName]?.models;
    if (!models || typeof models !== 'object') {
      continue;
    }

    const providerObjectStart = providerEntry.valueStart;
    const modelsProp = findPropertyInObject(originalText, providerObjectStart, 'models');
    if (modelsProp) {
      const indent = lineIndentAt(originalText, modelsProp.keyStart);
      replacements.push({
        start: modelsProp.valueStart,
        end: modelsProp.valueEnd,
        text: stringifyModelsValue(models, indent),
      });
      continue;
    }

    const objectEnd = findMatchingContainerEnd(originalText, providerObjectStart) - 1;
    const closeIndent = lineIndentAt(originalText, objectEnd);
    const propIndent = `${closeIndent}  `;
    const comma = objectNeedsCommaBeforeInsert(originalText, providerObjectStart) ? ',' : '';
    replacements.push({
      start: objectEnd,
      end: objectEnd,
      text: `${comma}\n${propIndent}"models": ${stringifyModelsValue(models, propIndent)}\n${closeIndent}`,
    });
  }

  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce((text, replacement) => (
      `${text.slice(0, replacement.start)}${replacement.text}${text.slice(replacement.end)}`
    ), originalText);
}

/**
 * @param {string} configPath
 * @returns {Promise<string>}
 */
export async function backupConfig(configPath) {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupDir = path.join(path.dirname(configPath), 'backups');
  const backupPath = path.join(backupDir, `${path.basename(configPath)}.bak.${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(configPath, backupPath);
  return backupPath;
}

/**
 * Atomic write: write temp file then rename.
 *
 * @param {string} configPath
 * @param {unknown} data
 * @param {{originalText?: string, changedProviderNames?: string[]}} options
 * @returns {Promise<void>}
 */
export async function writeConfig(configPath, data, options = {}) {
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  let payload = `${JSON.stringify(data, null, 2)}\n`;
  if (
    options.originalText
    && Array.isArray(options.changedProviderNames)
    && options.changedProviderNames.length > 0
  ) {
    const patched = updateConfigTextModels(
      options.originalText,
      /** @type {Record<string, any>} */ (data),
      options.changedProviderNames,
    );
    if (patched) {
      payload = patched;
    }
  }
  await fs.writeFile(tempPath, payload, 'utf8');
  await fs.rename(tempPath, configPath);
}

/**
 * Sync one provider's remote models into local models map.
 *
 * @param {string} providerName
 * @param {Record<string, any>} providerConfig
 * @returns {Promise<{providerName: string, remoteCount: number, localCount: number, added: string[], removed: string[], dryRun: boolean, mode: string, changed: boolean}>}
 */
export async function syncProviderModels(providerName, providerConfig) {
  const options = providerConfig?.options ?? {};
  const modelSync = options.modelSync ?? {};
  const endpoint = modelSync.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = Number.isFinite(modelSync.timeoutMs) ? Number(modelSync.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const dryRun = Boolean(modelSync.dryRun);
  const mode = modelSync.mode === 'replace' ? 'replace' : DEFAULT_SYNC_MODE;

  const apiKey = await resolveProviderApiKey(providerName, options);
  const modelsUrl = buildModelsUrl(options.baseURL, endpoint);

  const payload = await fetchRemoteModels(modelsUrl, apiKey, timeoutMs);
  const extracted = extractModelIds(payload);
  const filtered = filterModelIds(extracted, modelSync.includeRegex ?? null, modelSync.excludeRegex ?? null);

  const localModels = providerConfig.models && typeof providerConfig.models === 'object' ? providerConfig.models : {};
  const localIds = new Set(Object.keys(localModels));
  const added = filtered.filter((id) => !localIds.has(id));
  const remoteIds = new Set(filtered);
  const removed = mode === 'replace' ? [...localIds].filter((id) => !remoteIds.has(id)) : [];
  const nextModels = Object.fromEntries(filtered.map((id) => [id, { name: id }]));
  const changed = mode === 'replace'
    ? JSON.stringify(localModels) !== JSON.stringify(nextModels)
    : added.length > 0;

  if (!dryRun) {
    if (mode === 'replace') {
      providerConfig.models = nextModels;
    } else {
      if (!providerConfig.models || typeof providerConfig.models !== 'object') {
        providerConfig.models = {};
      }
      for (const id of added) {
        providerConfig.models[id] = { name: id };
      }
    }
  }

  return {
    providerName,
    remoteCount: filtered.length,
    localCount: localIds.size,
    added,
    removed,
    dryRun,
    mode,
    changed,
  };
}

/**
 * OpenCode plugin entrypoint.
 *
 * @param {{client?: unknown, app?: unknown, $?: unknown}} _ctx
 * @returns {Promise<Record<string, never>>}
 */
export async function runModelSyncPlugin(_ctx) {
  if (!claimDuplicateGuard()) {
    warn('Plugin already initialized in this process. Skipping duplicate load.');
    return {};
  }

  const configPath = await resolveConfigPath();
  if (!configPath) {
    warn('No opencode.json found. Skipping model sync.');
    return {};
  }

  log(`Config found: ${configPath}`);

  const rawConfig = await fs.readFile(configPath, 'utf8');
  /** @type {Record<string, any>} */
  let config;
  try {
    config = parseJsoncConfig(rawConfig);
  } catch (err) {
    error(`Failed to read/parse config JSON/JSONC: ${String(err)}`);
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
  let totalRemoved = 0;
  const changedProviderNames = [];

  for (const providerName of providerNames) {
    try {
      const provider = providers[providerName];
      const result = await syncProviderModels(providerName, provider);
      totalAdded += result.added.length;
      totalRemoved += result.removed.length;

      log(
        `${providerName}: remote=${result.remoteCount}, local=${result.localCount}, added=${result.added.length}, removed=${result.removed.length}, mode=${result.mode}, dryRun=${result.dryRun}`,
      );

      if (result.added.length > 0) {
        log(`${providerName}: new models => ${result.added.join(', ')}`);
      }
      if (result.removed.length > 0) {
        log(`${providerName}: removed models => ${result.removed.join(', ')}`);
      }
      if (result.changed && !result.dryRun) {
        changed = true;
        changedProviderNames.push(providerName);
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
    if (totalAdded > 0 || totalRemoved > 0) {
      log('All model changes were dry-run only.');
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
    await writeConfig(configPath, config, { originalText: rawConfig, changedProviderNames });
    log(`Config updated successfully: ${configPath}`);
    log(`已同步 ${totalAdded} 个模型，移除 ${totalRemoved} 个模型，请重启 OpenCode 以刷新模型选择器。`);
  } catch (err) {
    error(`Failed to write config atomically: ${String(err)}`);
  }

  return {};
}

export const __internal = {
  DUPLICATE_LOAD_KEY,
  LOG_PREFIX,
  DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SYNC_MODE,
  claimDuplicateGuard,
  pathToFileURL,
};
