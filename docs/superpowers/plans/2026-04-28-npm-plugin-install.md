# Npm Plugin Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `opencode-model-sync` loadable through OpenCode's npm plugin mechanism while keeping local plugin development and manual loading working.

**Architecture:** The root `index.js` file becomes the single implementation source. Two local shim files re-export that module for `.opencode/plugins/` and legacy `.opencode/plugin/` loading. Packaging metadata points npm consumers at the root entrypoint, and tests verify the entrypoint, shims, and duplicate guard.

**Tech Stack:** Node.js ESM, node:test, OpenCode plugin loading conventions, npm packaging metadata

---

### Task 1: Add entrypoint-focused tests

**Files:**
- Modify: `test/model-sync.test.mjs`

- [ ] **Step 1: Write failing tests for the new entrypoint and shim behavior**

```js
import {
  ModelSyncPlugin,
  __internal,
  buildModelsUrl,
} from '../index.js';
import * as localShim from '../.opencode/plugins/model-sync.js';

test('plural local shim re-exports package entrypoint', async () => {
  assert.equal(localShim.default, ModelSyncPlugin);
  assert.equal(localShim.buildModelsUrl, buildModelsUrl);
});

test('duplicate guard only allows first claim', () => {
  delete globalThis[__internal.DUPLICATE_LOAD_KEY];
  assert.equal(__internal.claimDuplicateGuard(), true);
  assert.equal(__internal.claimDuplicateGuard(), false);
});
```

- [ ] **Step 2: Run the targeted test file and verify it fails because `index.js` and the shim do not exist yet**

Run: `node --test test/model-sync.test.mjs`
Expected: FAIL with module resolution errors for `../index.js` or `../.opencode/plugins/model-sync.js`

### Task 2: Move implementation to the package root

**Files:**
- Create: `index.js`
- Modify: `test/model-sync.test.mjs`

- [ ] **Step 1: Create the root entrypoint by moving the existing plugin implementation into `index.js`**

```js
const DUPLICATE_LOAD_KEY = Symbol.for('opencode-model-sync.loaded');

function claimDuplicateGuard() {
  if (globalThis[DUPLICATE_LOAD_KEY]) {
    return false;
  }
  globalThis[DUPLICATE_LOAD_KEY] = true;
  return true;
}

export const ModelSyncPlugin = async (_ctx) => {
  if (!claimDuplicateGuard()) {
    warn('Plugin already initialized in this process. Skipping duplicate load.');
    return {};
  }
  // existing sync logic
};

export default ModelSyncPlugin;

export const __internal = {
  DUPLICATE_LOAD_KEY,
  claimDuplicateGuard,
};
```

- [ ] **Step 2: Run the focused test file and verify the new tests still fail only because the local shims are missing**

Run: `node --test test/model-sync.test.mjs`
Expected: FAIL with module resolution error for `../.opencode/plugins/model-sync.js`

### Task 3: Add local shim files

**Files:**
- Create: `.opencode/plugins/model-sync.js`
- Modify: `.opencode/plugin/model-sync.js`

- [ ] **Step 1: Add thin re-export shims that point to the root package entrypoint**

```js
export * from '../../index.js';
export { default } from '../../index.js';
```

- [ ] **Step 2: Run the focused test file and verify it passes**

Run: `node --test test/model-sync.test.mjs`
Expected: PASS

### Task 4: Update package metadata and docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `examples/opencode.example.jsonc`
- Modify: `scripts/mock-validate.mjs`

- [ ] **Step 1: Update `package.json` for npm publishing**

```json
{
  "name": "opencode-model-sync",
  "version": "0.1.0",
  "description": "OpenCode plugin that syncs remote provider models into opencode.json.",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js"
  },
  "files": [
    "index.js",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ]
}
```

- [ ] **Step 2: Update docs and examples to show npm config installation first and local plugin loading second**

Run: no command
Expected: README and example config mention `plugin: ["opencode-model-sync"]`, `.opencode/plugins/`, and the legacy singular path note

### Task 5: Full verification and packaging check

**Files:**
- Modify as needed based on verification output

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 2: Verify publish contents**

Run: `npm pack --dry-run`
Expected: tarball preview includes `index.js`, `README.md`, `LICENSE`, `CHANGELOG.md`, and `package.json`, without tests or `.opencode` plugin shims

- [ ] **Step 3: Review diff and summarize any follow-up risk**

Run: `git diff --stat`
Expected: only packaging, shim, tests, docs, and plan/spec files changed
