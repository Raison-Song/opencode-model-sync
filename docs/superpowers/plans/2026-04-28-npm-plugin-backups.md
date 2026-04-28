# Npm Plugin Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `opencode-model-sync` as a proper npm-installable OpenCode plugin, write future backups into a `backups/` directory, and prepare the branch for commit and PR.

**Architecture:** Keep a narrow plugin entrypoint and move reusable logic into `model-sync-core.js`. Local shims re-export the root entrypoint, backup writes target a sibling `backups/` directory, and provider API keys fall back to OpenCode's `auth.json` when explicit config is absent.

**Tech Stack:** Node.js ESM, node:test, OpenCode plugin conventions, npm packaging metadata, GitHub CLI

---

### Task 1: Lock backup and auth fallback behavior with tests

**Files:**
- Modify: `test/model-sync.test.mjs`

- [ ] **Step 1: Add failing tests for backup directory placement and `auth.json` credential fallback**

```js
test('backupConfig writes backups into sibling backups directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-dir-test-'));
  const configPath = path.join(dir, 'opencode.json');
  await fs.writeFile(configPath, '{}\n', 'utf8');

  const backupPath = await backupConfig(configPath);

  assert.equal(path.dirname(backupPath), path.join(dir, 'backups'));
  assert.equal(path.basename(backupPath).startsWith('opencode.json.bak.'), true);
});

test('resolveProviderApiKey falls back to OpenCode auth.json api credentials', async () => {
  // temp HOME + auth.json with mingie api key
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail for the expected missing behavior**

Run: `node --test test/model-sync.test.mjs`
Expected: FAIL because backup path still points beside the config file and/or auth fallback is missing

### Task 2: Finalize runtime structure

**Files:**
- Create: `index.js`
- Create: `model-sync-core.js`
- Create: `.opencode/plugins/model-sync.js`
- Modify: `.opencode/plugin/model-sync.js`
- Modify: `scripts/mock-validate.mjs`

- [ ] **Step 1: Keep the root package entrypoint plugin-only and move reusable helpers into `model-sync-core.js`**

```js
import { runModelSyncPlugin } from './model-sync-core.js';

export const ModelSyncPlugin = runModelSyncPlugin;
export default ModelSyncPlugin;
```

- [ ] **Step 2: Update core logic so backups go into `backups/` and API keys fall back to OpenCode `auth.json`**

```js
const backupDir = path.join(path.dirname(configPath), 'backups');
await fs.mkdir(backupDir, { recursive: true });

const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
```

- [ ] **Step 3: Add and update local shims so both official and legacy local plugin paths re-export the root entrypoint**

```js
export * from '../../index.js';
export { default } from '../../index.js';
```

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run: `node --test test/model-sync.test.mjs`
Expected: PASS

### Task 3: Finish npm package metadata and docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `examples/opencode.example.jsonc`

- [ ] **Step 1: Ensure package metadata matches a publishable npm plugin package**

```json
{
  "main": "./index.js",
  "exports": {
    ".": "./index.js"
  },
  "files": ["index.js", "model-sync-core.js", "README.md", "LICENSE", "CHANGELOG.md"]
}
```

- [ ] **Step 2: Update README and example config to document npm install, auth fallback, and `backups/` behavior**

Run: no command
Expected: README mentions `plugin`, `backups/`, and reuse of OpenCode-stored API credentials

### Task 4: Verify packaging and OpenCode behavior

**Files:**
- Modify as needed based on verification output

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 2: Verify npm package contents**

Run: `npm.cmd pack --dry-run`
Expected: tarball contains package entry files and docs, without test files or `.opencode` internals

- [ ] **Step 3: Verify OpenCode can load the local plugin and perform a mock sync**

Run: `node scripts/verify-local-opencode-plugin.mjs D:/Projects/Temp/Life/opencode-model-sync/.worktrees/npm-plugin-install`
Expected: PASS with `HAS_MODEL=true`

### Task 5: Commit and create pull request

**Files:**
- Modify none; use git and GitHub CLI

- [ ] **Step 1: Review git status, diff, and recent commit style**

Run: `git status --short`, `git diff --stat`, `git log -5 --oneline`
Expected: only intended branch changes are present

- [ ] **Step 2: Commit the branch changes with a message matching repo style**

Run: `git add ...` then `git commit -m "feat: package plugin for npm install"`
Expected: commit succeeds without amend

- [ ] **Step 3: Push branch and create PR against `main`**

Run: `git push -u origin feat/npm-plugin-install` then `gh pr create ...`
Expected: PR URL returned
