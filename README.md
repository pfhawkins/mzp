# Zotero MCP Server

A Model Context Protocol (MCP) server that exposes your Zotero library (items, collections, tags, notes, attachments, and full-text) to any MCP-compatible client. Distribute as a single self-contained binary — no Python, Node, or `npm install` required.

## Quick install

1. Download the latest binary for your platform from the [releases page](https://github.com/pfhawkins/mzp/releases) (or build it yourself — see [Building from source](#building-from-source)).
2. Make it executable (macOS / Linux):
   ```bash
   chmod +x zotero-mcp-darwin-arm64   # or your platform binary
   ```
3. Run it with your Zotero credentials:
   ```bash
   ZOTERO_API_KEY=your_key ZOTERO_USER_ID=your_user_id ./zotero-mcp-darwin-arm64
   ```

## macOS Gatekeeper note

macOS may block unsigned binaries downloaded from the internet. If you see a security warning, remove the quarantine attribute:

```bash
xattr -d com.apple.quarantine zotero-mcp-darwin-arm64
```

(Apple notarization is not yet enabled; this step is required until binaries are signed.)

## Configuration

Set these environment variables before starting the server:

| Variable | Required? | Description |
|----------|-----------|-------------|
| `ZOTERO_API_KEY` | **Yes** | Your Zotero API key. Create one at [https://www.zotero.org/settings/keys](https://www.zotero.org/settings/keys). |
| `ZOTERO_USER_ID` | **Yes** *(or `ZOTERO_GROUP_ID`)* | Your numeric Zotero user ID. Find it on the [Feeds/API settings page](https://www.zotero.org/settings/keys). |
| `ZOTERO_GROUP_ID` | **Yes** *(or `ZOTERO_USER_ID`)* | A Zotero group/library ID. Use this instead of `ZOTERO_USER_ID` to access a group library. |
| `ZOTERO_BASE_URL` | No | API base URL. Default: `https://api.zotero.org`. Only change this if you are self-hosting or proxying the API. |
| `LOG_LEVEL` | No | Log verbosity: `debug`, `info`, `warn`, `error`. Default: `info`. |

> **Important:** Exactly one of `ZOTERO_USER_ID` or `ZOTERO_GROUP_ID` must be set. Setting both or neither will cause the server to exit with an error.

### Finding your user ID and creating an API key

1. Sign in to [zotero.org](https://www.zotero.org) and go to **Settings → Feeds/API**.
2. Copy the numeric userID shown on that page.
3. Click **Create new private key**.
4. Give the key a name (e.g., "MCP Server") and ensure at least **Allow library access** is checked.
5. Copy the key and keep it secret.

## MCP client setup

### Claude Desktop

Add the server to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zotero": {
      "command": "/path/to/zotero-mcp-darwin-arm64",
      "env": {
        "ZOTERO_API_KEY": "your_api_key_here",
        "ZOTERO_USER_ID": "your_user_id_here"
      }
    }
  }
}
```

Replace the binary name with the one matching your platform (e.g., `zotero-mcp-linux-x64`, `zotero-mcp-windows-x64.exe`).

### Generic MCP client

Any client that supports MCP over stdio can use this server. Provide the binary path and required environment variables in your client's `mcpServers` configuration:

```json
{
  "mcpServers": {
    "zotero": {
      "command": "/absolute/path/to/zotero-mcp",
      "env": {
        "ZOTERO_API_KEY": "your_api_key_here",
        "ZOTERO_USER_ID": "your_user_id_here",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## Tools reference

| Tool | Description | Example input |
|------|-------------|---------------|
| `zotero_search` | Full-text/keyword search across your library. | `{ "query": "machine learning", "limit": 10 }` |
| `zotero_get_item` | Fetch a single item by its Zotero key. | `{ "itemKey": "ABCDE123" }` |
| `zotero_get_item_children` | List notes and attachments for an item. | `{ "itemKey": "ABCDE123" }` |
| `zotero_list_collections` | List top-level collections. | `{ "limit": 25 }` |
| `zotero_get_collection_items` | List items inside a collection. | `{ "collectionKey": "FGHIJ456", "limit": 25 }` |
| `zotero_list_tags` | List all tags in the library. | `{ "limit": 50 }` |
| `zotero_get_fulltext` | Retrieve indexed full-text content for an item. | `{ "itemKey": "ABCDE123" }` |
| `zotero_recent` | Fetch recently added or modified items. | `{ "limit": 10, "since": "2024-01-01T00:00:00Z" }` |

### Optional filters and parameters

- **`zotero_search`** supports `itemType` (e.g., `journalArticle`, `book`) and `tag` filters.
- **`zotero_recent`** accepts an ISO 8601 `since` date to only show items modified after that time.
- All list/search tools accept `limit` (max 50) and `start` (pagination offset) where applicable.

## Resources

In addition to tools, the server exposes MCP resources for direct browsing:

- `zotero://item/{key}` — Fetch the raw JSON for a Zotero item.
- `zotero://collection/{key}` — Fetch the raw JSON for a Zotero collection.

These can be read directly by MCP clients that support resource browsing.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Configuration error: missing required environment variable(s)` | Env vars not set or misspelled. | Double-check `ZOTERO_API_KEY` and exactly one of `ZOTERO_USER_ID` / `ZOTERO_GROUP_ID`. |
| `401 Unauthorized` or `403 Forbidden` | Invalid or expired API key. | Regenerate your key at [zotero.org/settings/keys](https://www.zotero.org/settings/keys). |
| `404 Not Found` | Wrong user/group ID, or the item/collection key does not exist. | Verify your numeric userID on the [Feeds/API settings page](https://www.zotero.org/settings/keys) and check the key spelling. |
| `429 Too Many Requests` | Hitting the Zotero API rate limit. | The server retries automatically with backoff, but very heavy usage may still be throttled. Wait a few seconds and retry. |
| Empty search results | Query too specific, or items not synced to the web library. | Check that your items are synced in the Zotero desktop app and visible on [zotero.org](https://www.zotero.org). |
| Binary will not run (macOS) | Gatekeeper quarantine. | Run `xattr -d com.apple.quarantine /path/to/binary`. |

## Building from source

You need [Bun](https://bun.sh) installed.

```bash
# Clone the repository
git clone https://github.com/pfhawkins/mzp.git
cd mzp

# Install dependencies
bun install

# Type-check, lint, and test
bun run typecheck
bun run lint
bun test

# Build the binary for the current platform
bun run build

# Build binaries for all platforms
bun run build:all
```

After `bun run build`, the host-platform binary will be at `dist/zotero-mcp`.
After `bun run build:all`, you will find five platform-specific binaries plus a `SHA256SUMS` file in `dist/`.

Binary sizes are typically 50–100 MB because the Bun runtime is embedded — this is normal for a self-contained executable.

## License

MIT — see [LICENSE](./LICENSE).
