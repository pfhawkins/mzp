/**
 * Smoke test for ZoteroClient.
 * Requires a live Zotero account with env vars set.
 * Non-blocking for CI.
 */
import { loadConfig } from "../src/config.js";
import { ZoteroClient } from "../src/zotero/client.js";

const config = loadConfig();
const client = new ZoteroClient(config);

const items = await client.listItems({ limit: 5 });
console.error(JSON.stringify(items, null, 2));
