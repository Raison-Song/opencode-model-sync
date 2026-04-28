# Npm Plugin Install Design

## Goal

Make `opencode-model-sync` installable as an npm plugin through OpenCode's `plugin` config field, while preserving a local plugin workflow for repository development and manual loading.

## Current State

- The package is marked `private`, so it cannot be published to npm.
- The only plugin entrypoint lives at `.opencode/plugin/model-sync.js`.
- Tests and scripts import that local path directly.
- The README documents only the local-copy workflow and uses the older singular `plugin/` directory name.

## Requirements

### Packaging

- Publish the repository as a standard ESM npm package named `opencode-model-sync`.
- Expose a stable package entrypoint from the repository root.
- Keep runtime dependencies at zero unless a concrete packaging need appears.

### OpenCode Loading

- Support npm loading through `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-model-sync"]
}
```

- Keep a local plugin file for repository development under the official `.opencode/plugins/` directory.
- Preserve compatibility with the legacy `.opencode/plugin/` path used in the current repository.

### Duplicate Safety

- If both the npm plugin and a local shim are loaded in the same OpenCode process, only one plugin instance should run.
- Duplicate detection should be process-wide, not path-based, so two copies of the same package still dedupe.

### Docs And Examples

- README should present npm config installation as the primary workflow.
- README should keep local plugin loading as a secondary development/manual option.
- Example config should include the `plugin` array and the provider-specific `modelSync` options.

### Verification

- Tests must move to the package entrypoint.
- Add coverage for the local shim and duplicate-load guard.
- Validate publish contents with `npm pack --dry-run`.

## Design

### Source Of Truth

Move the real plugin implementation to `index.js` at the repository root. This becomes the canonical source used by both npm consumers and local shims.

### Local Shims

Create thin re-export files at:

- `.opencode/plugins/model-sync.js`
- `.opencode/plugin/model-sync.js`

Each shim should re-export the root module so the implementation stays single-sourced.

### Duplicate Guard

Use a `Symbol.for("opencode-model-sync.loaded")` key on `globalThis`. The plugin entrypoint claims the key on first initialization and logs a warning on later attempts, returning an empty hook object without doing work.

### Package Metadata

Update `package.json` to:

- remove `private`
- add `main`
- add `exports`
- add `files`
- add repository metadata
- keep `type: module`

### Test Updates

- Change existing tests and helper scripts to import `../index.js`.
- Add a test that the plural local shim exposes the same exports as the package entrypoint.
- Add a test that the duplicate guard only allows the first initialization claim.

## Out Of Scope

- Changing the sync algorithm itself.
- Adding new provider options beyond packaging/install concerns.
- Publishing to npm or creating a git commit in this session.

## Risks

- Some users may still follow the old `.opencode/plugin/` path; keeping the legacy shim avoids breaking them.
- OpenCode may load both npm and local plugins if a user configures both; the duplicate guard prevents duplicate writes and duplicate logs.
- The npm package should not accidentally publish tests or `.opencode` internals; `files` must be explicit.
