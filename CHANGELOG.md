# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-28

### Added
- Initial release of `opencode-model-sync` local plugin.
- Automatic provider model discovery from remote `/models` endpoints.
- Safe write flow with backup + atomic rename.
- Support for `OPENCODE_CONFIG`, upward config lookup, and global fallback config path.
- Support for `{env:VAR_NAME}` API key placeholders.
- `dryRun` mode, include/exclude regex filtering, timeout control.
- README, JSONC configuration example, and Node built-in test suite.

### Changed
- Publish the plugin as a standard npm package entrypoint.
- Document `opencode.json.plugin` as the primary installation path.
- Add `.opencode/plugins/model-sync.js` and keep `.opencode/plugin/model-sync.js` as a compatibility shim.
- Add duplicate-load protection so npm and local shims do not run twice in one process.
- Write future config backups into a sibling `backups/` directory.
- Reuse OpenCode `auth.json` API credentials when `options.apiKey` is not explicitly configured.
- Read `opencode.jsonc` configs and preserve comments with targeted `models` updates where possible.
- Add `modelSync.mode` with `append` and `replace` sync behavior.
