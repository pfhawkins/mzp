# Zotero MCP Server — Implementation Plan

A phased plan for building an MCP (Model Context Protocol) server for Zotero in TypeScript, distributed as a single self-contained binary via `bun build --compile`.

This document is written to be executed by any LLM-based coding harness. Each phase has explicit goals, deliverables, and acceptance criteria. Do not skip phases. Do not merge phases. Mark each phase complete only when its acceptance criteria pass.

---

## Project goals

1. Provide a useful MCP server that exposes Zotero library data (items, collections, tags, notes, attachments, fulltext) to MCP clients.
2. Distribute as a **single executable per platform** (macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64). No Python, no Node, no `npm install` on the user's machine.
3. Be simple to install: download a binary, set an env var with a Zotero API key, point an MCP client at it.
4. Work via **stdio transport** (primary). Optionally add HTTP/SSE later.

## Non-goals

- Re-implementing Zotero's local database access. Use the Zotero Web API only (v3, JSON).
- Editing the Zotero application or syncing.
- A full GUI or web UI.

---

## Tech stack (fixed — do not change without explicit user approval)

- **Runtime / build**: Bun (latest stable). Use `bun build --compile` for binaries.
- **Language**: TypeScript with `strict: true`.
- **MCP SDK**: `@modelcontextprotocol/sdk` (the official TypeScript SDK).
- **HTTP client**: built-in `fetch` (Bun ships it).
- **Schema validation**: `zod` (the MCP TS SDK already uses it for tool schemas).
- **Tests**: `bun test` (built in).
- **Lint/format**: `biome` (single tool, fast, minimal config) or fall back to `eslint` + `prettier` if biome blocks for any reason.
- **Package manager**: Bun (`bun install`).

The plan assumes the executor has Bun installed. If not, install via `curl -fsSL https://bun.sh/install | bash`.

---

## Phase 0 — Project bootstrap

**Goal:** Empty but working Bun + TS project with MCP SDK wired up.

**Steps:**
1. Run `bun init -y` in the project root.
2. Set `package.json` `name` to `zotero-mcp`, add a `bin` entry pointing at the built binary path, set `type: "module"`.
3. Add dependencies: `bun add @modelcontextprotocol/sdk zod`.
4. Add dev dependencies: `bun add -d @types/bun typescript biome` (or eslint/prettier fallback).
5. Create `tsconfig.json` with: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`.
6. Create `src/index.ts` containing a minimal MCP server with one stub tool (`ping` → returns `"pong"`) registered against the stdio transport.
7. Add `biome.json` (or `.eslintrc` + `.prettierrc`) with sensible defaults.
8. Add `.gitignore` covering `node_modules/`, `dist/`, `*.log`, `.env`, `.DS_Store`.
9. Add scripts to `package.json`:
   - `dev`: `bun run --watch src/index.ts`
   - `build`: `bun build --compile --minify --sourcemap src/index.ts --outfile dist/zotero-mcp`
   - `typecheck`: `tsc --noEmit`
   - `lint`: `biome check .` (or eslint equivalent)
   - `test`: `bun test`

**Acceptance criteria:**
- `bun run typecheck` passes with zero errors.
- `bun run dev` starts without crashing and waits on stdio.
- Sending a valid MCP `initialize` request followed by `tools/list` over stdin returns the `ping` tool. (Use a small handwritten test client, see Phase 5.)
- `bun run build` produces `dist/zotero-mcp` and the binary runs (`./dist/zotero-mcp` should not crash on launch).

---

## Phase 1 — Zotero API client

**Goal:** Typed, tested wrapper around the Zotero Web API v3.

**Reference:** https://www.zotero.org/support/dev/web_api/v3/start

**Steps:**
1. Create `src/zotero/client.ts` exporting a `ZoteroClient` class.
2. Constructor accepts: `{ apiKey: string; userId?: string; groupId?: string; baseUrl?: string }`. Default `baseUrl` to `https://api.zotero.org`. Exactly one of `userId` or `groupId` must be set; throw on misconfiguration.
3. Read configuration from environment variables in `src/config.ts`:
   - `ZOTERO_API_KEY` (required)
   - `ZOTERO_USER_ID` or `ZOTERO_GROUP_ID` (exactly one required)
   - `ZOTERO_BASE_URL` (optional)
4. Implement these methods on `ZoteroClient` (all return typed results, all use the v3 JSON API and send the `Zotero-API-Version: 3` header plus `Authorization: Bearer <key>`):
   - `listItems(opts?: { q?: string; tag?: string | string[]; itemType?: string; collection?: string; limit?: number; start?: number; sort?: string; direction?: 'asc' | 'desc' })`
   - `getItem(itemKey: string)`
   - `getItemChildren(itemKey: string)` (notes + attachments)
   - `listCollections(opts?: { limit?: number; start?: number })`
   - `getCollection(collectionKey: string)`
   - `listCollectionItems(collectionKey: string, opts?)`
   - `listTags(opts?)`
   - `searchFulltext(q: string, opts?)` — uses `/items?q=...&qmode=everything`
   - `getItemFulltext(itemKey: string)` — `/items/{key}/fulltext`
5. Define Zod schemas for Zotero response shapes in `src/zotero/schemas.ts`. Validate responses at the client boundary; surface validation failures with a clear error.
6. Implement a small pagination helper (`async *paginate(...)`) that follows `Link: rel="next"` headers.
7. Add retry-with-backoff for `429` and `5xx` (max 3 retries, exponential backoff, jitter). Honor the `Retry-After` header when present.
8. Centralize all error handling: throw a `ZoteroApiError` with `{ status, code, message, requestId }`.

**Acceptance criteria:**
- All methods are typed end-to-end (no `any` leaking out of the module).
- A live smoke-test script `scripts/smoke-zotero.ts` reads the API key from env, lists 5 items, and prints them. Document that the executor must have a Zotero account to run it; mark this script as non-blocking for CI.
- Unit tests (Phase 5) cover pagination, retry, and error mapping using mocked `fetch`.

---

## Phase 2 — MCP tool surface

**Goal:** Expose the Zotero client as MCP tools that an LLM client can call.

**Tools to register (use Zod schemas for inputs, return MCP `TextContent` or structured JSON):**

1. `zotero_search` — full-text/keyword search. Inputs: `query`, `limit?`, `itemType?`, `tag?`. Returns: list of items with `key`, `title`, `creators`, `date`, `itemType`, `tags`.
2. `zotero_get_item` — fetch a single item by key. Inputs: `itemKey`. Returns: full item JSON plus a human-readable summary.
3. `zotero_get_item_children` — notes + attachments for an item. Inputs: `itemKey`.
4. `zotero_list_collections` — list collections. Inputs: `limit?`, `start?`.
5. `zotero_get_collection_items` — items in a collection. Inputs: `collectionKey`, `limit?`, `start?`.
6. `zotero_list_tags` — list tags. Inputs: `limit?`, `start?`.
7. `zotero_get_fulltext` — fetch indexed fulltext for an item. Inputs: `itemKey`.
8. `zotero_recent` — most recently added/modified items. Inputs: `limit?`, `since?` (ISO date).

**Steps:**
1. Create `src/tools/` with one file per tool. Each file exports `{ name, description, inputSchema, handler }`.
2. Create `src/tools/index.ts` that aggregates and registers all tools on the MCP server.
3. Each handler:
   - Validates input via Zod.
   - Calls the appropriate `ZoteroClient` method.
   - Formats output as a concise text block + structured JSON (use MCP's structured content where appropriate). Truncate large item arrays sensibly (e.g. cap at 50 items per response, expose pagination cursors).
   - Maps errors to MCP error responses with helpful messages.
4. Add an MCP **resource** (not tool) for `zotero://item/{key}` and `zotero://collection/{key}` so clients can browse without a tool call. Optional but recommended.

**Acceptance criteria:**
- All tools registered and visible via `tools/list`.
- Each tool's input schema is rejected when malformed, with a clear error.
- Manual exercise via the test client (Phase 5) confirms each tool returns sane output against a real Zotero account.

---

## Phase 3 — Configuration, logging, and errors

**Goal:** Production-quality runtime ergonomics.

**Steps:**
1. `src/config.ts`: load + validate env vars at startup. Fail fast with a clear message naming any missing/invalid var. Never log the API key.
2. Logging: stderr only (stdout is reserved for the MCP protocol on stdio transport — this is critical, do not log to stdout). Use a tiny logger (no extra dep, ~30 lines) with levels `debug | info | warn | error` controlled by `LOG_LEVEL` env var (default `info`).
3. Wrap the top-level server bootstrap in try/catch. On fatal error, log to stderr and exit with code 1.
4. Handle `SIGINT` / `SIGTERM` cleanly: stop accepting new requests, flush logs, exit 0.
5. Add a `--version` flag that prints the version from `package.json` and exits.
6. Add a `--help` flag listing required env vars and a one-line usage example.

**Acceptance criteria:**
- Running the binary with no env vars prints a clear error to stderr and exits non-zero.
- `./dist/zotero-mcp --version` prints the version.
- No `console.log` calls anywhere in `src/` (grep should return zero hits in non-test code). Only `console.error` or the logger.

---

## Phase 4 — Single-binary build & cross-compilation

**Goal:** Reproducible cross-platform binaries.

**Steps:**
1. Add a `scripts/build-all.ts` that runs `bun build --compile --minify --sourcemap --target <target> src/index.ts --outfile dist/<name>` for each of:
   - `bun-darwin-arm64` → `dist/zotero-mcp-darwin-arm64`
   - `bun-darwin-x64` → `dist/zotero-mcp-darwin-x64`
   - `bun-linux-x64` → `dist/zotero-mcp-linux-x64`
   - `bun-linux-arm64` → `dist/zotero-mcp-linux-arm64`
   - `bun-windows-x64` → `dist/zotero-mcp-windows-x64.exe`
2. Add a `bun run build:all` script in `package.json`.
3. Generate SHA256 checksums for each artifact into `dist/SHA256SUMS`.
4. Test that the host-platform binary runs end-to-end against a real Zotero account.
5. Document expected binary size (will be ~50–100 MB; the Bun runtime is embedded — this is normal). Don't try to shrink below what `--minify` produces.

**Acceptance criteria:**
- `bun run build:all` produces all five artifacts plus `SHA256SUMS`.
- The host-platform binary runs and serves at least one tool call successfully.

---

## Phase 5 — Testing

**Goal:** Confidence the server behaves correctly without a live Zotero account.

**Steps:**
1. **Unit tests** in `src/**/__tests__/*.test.ts`:
   - `ZoteroClient`: pagination, retry/backoff, error mapping, header construction. Mock `fetch` via Bun's mock helpers.
   - Each tool handler: input validation (good + bad), output formatting, error propagation.
2. **Integration test** in `tests/mcp-protocol.test.ts`: spawn the built binary as a subprocess, send `initialize`, `tools/list`, and one tool call, assert the responses. Mock the Zotero API by overriding `ZOTERO_BASE_URL` to a local test server fixture (start with `Bun.serve` in the test).
3. Aim for >80% line coverage on `src/zotero/` and `src/tools/`. Use `bun test --coverage`.

**Acceptance criteria:**
- `bun test` passes.
- Integration test exercises the full MCP handshake against the compiled binary.

---

## Phase 6 — Documentation

**Goal:** A user can install and configure the server in under five minutes.

**Steps:**
1. Write `README.md` with these sections, in order:
   - One-paragraph description.
   - Quick install: download from releases, `chmod +x`, run.
   - macOS Gatekeeper note: explain `xattr -d com.apple.quarantine zotero-mcp-darwin-arm64` until binaries are notarized.
   - Configuration: list env vars, show how to find your Zotero `userID` and create an API key.
   - MCP client setup: include a copy-pasteable JSON snippet for adding the server to Claude Desktop, and a generic `mcpServers` JSON example for any compliant client. Do not assume Claude-specific tooling.
   - Tools reference: one short description per tool with example inputs.
   - Troubleshooting: common errors (bad key, wrong userID, rate limits).
   - Building from source.
2. Add `LICENSE` (MIT unless the user specifies otherwise — flag this and ask before finalizing).
3. Add `CHANGELOG.md` with an initial `0.1.0` entry.

**Acceptance criteria:**
- A reader unfamiliar with the project can install and run the server using only the README.
- All env var names in the README match `src/config.ts`.

---

## Phase 7 — Release automation (optional, can be deferred)

**Goal:** `git tag v0.1.0 && git push --tags` produces signed binaries on GitHub Releases.

**Steps:**
1. Add `.github/workflows/release.yml` triggered on tag push matching `v*`. The workflow runs on `ubuntu-latest`, installs Bun, runs `bun run build:all`, uploads artifacts + `SHA256SUMS` to a GitHub Release.
2. (Stretch) Add macOS notarization. Requires the user to provide an Apple Developer ID; do **not** attempt this unprompted. Document the env vars needed (`APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`) and gate the step on their presence.
3. Add a CI workflow `ci.yml` that runs `bun run typecheck`, `bun run lint`, `bun test` on every push.

**Acceptance criteria:**
- Pushing a `v*` tag creates a draft GitHub Release with all five binaries and a checksum file attached.
- CI runs typecheck, lint, and tests on every PR.

---

## Execution rules for the LLM/harness

- Implement phases in order. Do not start phase N+1 before phase N's acceptance criteria pass.
- After each phase, run `bun run typecheck && bun run lint && bun test` and only proceed if all pass.
- If a step is ambiguous, prefer the smallest correct implementation and leave a `TODO(human):` comment listing the open question. Do not invent product requirements.
- Never log or print the Zotero API key. Never write it to disk outside the user's environment.
- Never call `console.log` from `src/` — stdout is the MCP transport. Use `console.error` or the logger.
- Do not add dependencies beyond those listed in "Tech stack" without flagging it. New deps must be justified in one sentence in the commit message.
- Commit at phase boundaries with messages like `phase 2: mcp tool surface`. One commit per phase is fine; do not squash phases.
- When an acceptance criterion cannot be met (e.g. no Zotero account available for live tests), say so explicitly and mark it `BLOCKED: <reason>` in the phase status rather than silently skipping.

## Status tracker

Update this table as phases complete.

| Phase | Status | Notes |
|------|--------|-------|
| 0 — Bootstrap | complete | |
| 1 — Zotero client | complete | |
| 2 — MCP tools | complete | |
| 3 — Config/logging | complete | |
| 4 — Build | complete | End-to-end tool call test passed with live Zotero credentials. All acceptance criteria pass: 5 artifacts + SHA256SUMS generated, host binary runs, version/help work, missing-env error is clear. |
| 5 — Tests | complete | 63 tests, 95%+ coverage. Integration test spawns compiled binary and exercises full MCP handshake + tool calls against a mocked Zotero API server. |
| 6 — Docs | complete | README, LICENSE (MIT), and CHANGELOG added. All env var names match src/config.ts. |
| 7 — Release (optional) | not started | |
