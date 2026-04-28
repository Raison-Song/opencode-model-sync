# Npm Plugin Backups Design

## Goal

Finalize `opencode-model-sync` as a proper npm-installable OpenCode plugin, store future backup files under a dedicated `backups/` directory next to the target config file, and prepare the branch for commit and pull request creation.

## Current State

- The branch already contains work to expose the plugin as an npm package.
- The runtime backup behavior still writes `opencode.json.bak.*` beside the config file.
- The local machine fix proved that OpenCode credentials for `mingie` live in OpenCode's `auth.json`, not in environment variables.
- Existing scattered `.bak.*` files already exist locally, but the user explicitly does not want them migrated.

## Requirements

### Backup Layout

- All future backups should be written to a `backups/` subdirectory next to the resolved config file.
- Existing `.bak.*` files must stay where they are.
- Backup naming should remain recognizable and collision-safe.

### Packaging

- The repository should remain consumable as a normal npm package.
- The exported npm entrypoint must only expose OpenCode plugin functions, so OpenCode does not try to treat helper exports as separate plugins.
- Helper logic should stay accessible to tests without polluting the plugin entrypoint.

### Authentication

- When `options.apiKey` is not provided, the plugin should fall back to OpenCode's stored `auth.json` API credentials for the current provider.
- This fallback should only read API credentials and should not alter the user's auth files.

### Documentation

- README should document npm installation as the primary path.
- README should mention the `backups/` directory behavior.
- README should explain the `auth.json` fallback so users understand why explicit env vars are optional for already-authenticated providers.

### Release Flow

- Verify tests and npm package contents before commit.
- Create a non-amended commit on the feature branch.
- Push the branch and open a PR against `main`.

## Design

### File Boundaries

- `index.js`: package entrypoint for npm consumers; exports only plugin functions.
- `model-sync-core.js`: all reusable logic used by tests and shims.
- `.opencode/plugins/model-sync.js`: official local shim.
- `.opencode/plugin/model-sync.js`: legacy compatibility shim.

### Backup Directory Behavior

- `backupConfig(configPath)` derives `path.dirname(configPath)`.
- It creates `path.join(configDir, 'backups')` recursively.
- It writes the backup file there using the existing timestamp format.
- No runtime migration step is added.

### Credential Resolution

- Resolve API key in this order:
  1. explicit `options.apiKey` / `{env:...}` resolution
  2. OpenCode `auth.json` provider entry with `type: 'api'`
- This keeps explicit config highest priority while making existing OpenCode logins usable.

### Verification

- Keep node tests as the regression net.
- Add a test for `auth.json` fallback.
- Run `npm.cmd pack --dry-run` on Windows to avoid PowerShell execution-policy failures.

## Out Of Scope

- Migrating existing backup files.
- Publishing to npm registry.
- Editing the user's credential storage.

## Risks

- OpenCode may still load local `.opencode` plugins when validating from this repository root; shims must remain clean and minimal.
- If OpenCode changes the format of `auth.json`, the fallback may need adjustment later.
- Backup directories can grow over time; that is acceptable for now because cleanup policy is not part of this change.
