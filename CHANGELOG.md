# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-10

### Added

- Initial release of the Zotero MCP server.
- Zotero Web API v3 client with typed responses, pagination, and retry/backoff.
- Eight MCP tools: `zotero_search`, `zotero_get_item`, `zotero_get_item_children`, `zotero_list_collections`, `zotero_get_collection_items`, `zotero_list_tags`, `zotero_get_fulltext`, `zotero_recent`.
- MCP resources: `zotero://item/{key}` and `zotero://collection/{key}`.
- Configuration validation with fast failure and clear error messages.
- Structured logging to stderr with `LOG_LEVEL` control.
- Single-binary distribution via `bun build --compile` for macOS (arm64, x64), Linux (x64, arm64), and Windows (x64).
- Cross-compilation script with SHA256 checksum generation.
- Full test suite with mocked Zotero API and an integration test against the compiled binary.
