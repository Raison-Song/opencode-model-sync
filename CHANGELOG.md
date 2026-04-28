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
