# Adversarial Code Review

Scope: `src/`, `scripts/`, `.github/workflows/`. Findings ranked by severity.

## Critical

### 1. `recent` tool's `since` filter silently drops data
`src/tools/recent.ts:39-51`

Fetches top-N items sorted by `dateModified`, then filters in-memory by `since`. If the user asks for "items since last week" and the library has 1000 items, only the top-N enter the filter — older items in that window dominate, and matches beyond N are invisible. Returns fewer than requested or empty when more recent matches exist past the page boundary.

Fix: use Zotero's native `since=<libraryVersion>` query param, or paginate until the dateModified cutoff is crossed.

### 2. `createItem` skips schema validation and retry
`src/zotero/client.ts:262-284`

Returns raw `any` from `res.json()` — no zod parse. Inconsistent with every other method, which routes through `request<T>`. Also uses `fetchOnce` directly, so 429 / 5xx responses are not retried on writes.

Fix: validate the response with a `zoteroWriteResponseSchema`; route through `fetchWithRetry` (POST `/items` is safe to retry).

### 3. `Retry-After` HTTP-date crashes into a tight loop
`src/zotero/client.ts:86-88`

`Number(retryAfter)` returns `NaN` for the RFC HTTP-date form (`"Wed, 21 Oct 2015 07:28:00 GMT"`). `setTimeout(r, NaN)` fires immediately → three back-to-back retries hammer Zotero.

Fix: validate `Number.isFinite`, fall back to backoff otherwise. Optionally parse the HTTP-date.

### 4. No upper clamp on `Retry-After`
`src/zotero/client.ts:87`

If Zotero ever returns `Retry-After: 86400`, the client sleeps a day. MCP client times out long before that.

Fix: clamp to ~30s.

## High

### 5. `paginate` follows `Link: next` to any host with the API key attached
`src/zotero/client.ts:142-185`

`new URL(nextUrl, requestUrl)` accepts an absolute URL pointing anywhere. The next request carries `Authorization: Bearer <api-key>`. A malicious or compromised upstream could exfiltrate the key by emitting a cross-origin `Link` header.

Fix: verify `nextUrl.host === baseUrl.host` before following.

### 6. `paginate` is dead code
No tool calls it. Either wire it into `recent`, `listCollections`, `listTags`, `getCollectionItems` (replacing the current `limit/start` plumbing), or delete.

### 7. Shutdown drops in-flight responses
`src/index.ts:135-140`

`shutdown` calls `process.exit(0)` immediately. No `transport.close()` or `server.close()`, no await for in-flight handlers. Pending tool responses are lost; the client sees an abrupt disconnect.

### 8. Tool error vs. dispatch error inconsistency
`src/index.ts:63-78`

Handler errors return `{ content, isError: true }`. The "unknown tool" path throws → propagates as a JSON-RPC error. Pick one convention.

### 9. `getItemFulltext` silent 5000-char truncation
`src/tools/getFulltext.ts:47-52`

No way for the caller to fetch the rest. Content beyond char 5000 is unrecoverable through this tool.

Fix: expose `offset` / `length` params, or return total length so the caller can decide.

### 10. `createItem` `passthrough()` allows write-conflict fields
`src/tools/createItem.ts:127`

User can pass `key` / `version` / `itemKey`. Zotero either rejects or, worse, attempts a wrong write.

Fix: strip server-assigned fields before POST, or replace `passthrough()` with a curated allowlist via `.strict()`.

## Medium

### 11. `recent.since` schema is too strict
`src/tools/recent.ts:26`

`z.string().datetime()` rejects `"2024-01-01"`. Doc says "ISO date string" — relax to `z.coerce.date()` or accept date-only.

### 12. `getItemChildren` HTML scrub doesn't decode entities
`src/tools/getItemChildren.ts:47`

`&amp;` renders verbatim. Notes display garbled.

### 13. `getItemChildren` always appends `...`
`src/tools/getItemChildren.ts:47`

`noteText.slice(0, 200) + "..."` runs unconditionally — false truncation marker on short notes.

### 14. `--version` / `--help` write to stderr
`src/index.ts:18, 23, 41`

Convention is stdout. Breaks `zotero-mcp --version | cat`. Stdio MCP reserves stdout for protocol, but these run before the transport binds, so stdout is safe here.

### 15. `baseUrl` only strips one trailing slash
`src/zotero/client.ts:57, 61`

`replace(/\/$/, "")` should be `replace(/\/+$/, "")`.

### 16. Cumulative retry delay can blow MCP timeout
Worst case: 3 retries × ~10–30s + initial > common MCP client timeouts (30–60s). Surface a clear error sooner or shrink the retry budget.

### 17. `createItem` returns the raw Zotero envelope
`src/tools/createItem.ts:138-145`

Caller has to dig out `result.successful["0"].key`. Surface the new item key on the first line of the response.

## Low

### 18. `parentCollection: union([string, boolean])`
`src/zotero/schemas.ts:49`

Zotero returns `false` for top-level collections. Currently `false` and missing are indistinguishable to a caller that does `if (col.parentCollection)`. Transform to `null` after parse.

### 19. `release.yml` notarize step is a stub
`.github/workflows/release.yml:84-99`

Shipped TODO. Releases get unnotarized macOS binaries. Either implement now or document Gatekeeper bypass.

### 20. Release artifact retention is 1 day
If notarize ever fails after the release job, the originals are gone. Bump to 7+ days.

### 21. CI uses `bun-version: latest`
Non-reproducible. Pin.

### 22. `linkHeaderUrlForRel` regex tolerates mismatched quotes
`src/zotero/client.ts:18`

`/^rel="?([^"]+)"?$/` accepts `rel="next` (open quote, no close). Not exploitable, but tighten.

### 23. No `ListResourcesRequestSchema` handler
`src/index.ts:80`

Only `ListResourceTemplatesRequestSchema` is registered. Clients that probe `resources/list` get a protocol error. Add an empty-list handler.

### 24. `logger.currentLevel` is module-global mutable state
Fine for a one-process CLI; flag if ever embedded.

### 25. `helpers.formatItemDetail` uses unnecessary casts
`src/tools/helpers.ts:45-46`

`abstractNote` and `url` are already in the schema. Drop the `Record<string, unknown>` casts and access them through the typed `Item`.

## Nits

- `tools/index.ts` re-exports modules via `* as` — works only because every module's `{name, description, inputSchema, handler}` shape matches. Fragile vs. explicit named imports.
- `formatCreators` joins `"" + " " + ""` → stray spaces when both names are empty.
- `schemas.ts` union order works because `zoteroItemDataSchema` requires `itemType` (which the wire envelope lacks at root). Add a comment or refactor to a discriminated union — this invariant is easy to break.

## Not bugs (but verified)

- `.env` correctly gitignored, not tracked.
- `tsconfig.json` enables `noUncheckedIndexedAccess` and `strict`.

## Recommended order of fixes

1. #1 `recent.since` — silent data loss, user-visible.
2. #5 `paginate` Link-header origin check — credential leak vector.
3. #2, #3, #4 — retry / write-path correctness.
4. #10 — input sanitization.
5. #7, #9 — protocol / UX.
