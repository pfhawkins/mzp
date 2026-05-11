import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { tools } from "./tools/index.js";
import { ZoteroClient } from "./zotero/client.js";

const args = process.argv.slice(2);

function toolErrorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		isError: true,
	};
}

if (args.includes("--version") || args.includes("-v")) {
	console.error(pkg.version);
	process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
	console.error(`zotero-mcp v${pkg.version}
Zotero MCP server — expose your Zotero library to MCP clients.

Usage:
  zotero-mcp [--version] [--help]

Required environment variables:
  ZOTERO_API_KEY       Your Zotero API key (https://www.zotero.org/settings/keys)
  ZOTERO_USER_ID       Your Zotero user ID (or use ZOTERO_GROUP_ID)
  ZOTERO_GROUP_ID      Your Zotero group ID (or use ZOTERO_USER_ID)

Optional environment variables:
  ZOTERO_BASE_URL      API base URL (default: https://api.zotero.org)
  LOG_LEVEL            Log level: debug, info, warn, error (default: info)

Example:
  ZOTERO_API_KEY=xxx ZOTERO_USER_ID=123456 zotero-mcp
`);
	process.exit(0);
}

try {
	const config = loadConfig();
	const client = new ZoteroClient(config);

	const server = new Server(
		{ name: "zotero-mcp", version: pkg.version },
		{ capabilities: { tools: {}, resources: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema,
			})),
		};
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = tools.find((t) => t.name === request.params.name);
		if (!tool) {
			return toolErrorResult(`Unknown tool: ${request.params.name}`);
		}
		try {
			return await tool.handler(client, request.params.arguments ?? {});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Tool ${request.params.name} failed:`, message);
			return toolErrorResult(message);
		}
	});

	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
		return {
			resourceTemplates: [
				{
					uriTemplate: "zotero://item/{key}",
					name: "Zotero Item",
					mimeType: "application/json",
				},
				{
					uriTemplate: "zotero://collection/{key}",
					name: "Zotero Collection",
					mimeType: "application/json",
				},
			],
		};
	});

	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const uri = request.params.uri;

		const itemMatch = uri.match(/^zotero:\/\/item\/(\w+)$/);
		if (itemMatch?.[1]) {
			const key = itemMatch[1];
			const item = await client.getItem(key);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: JSON.stringify(item, null, 2),
					},
				],
			};
		}

		const collectionMatch = uri.match(/^zotero:\/\/collection\/(\w+)$/);
		if (collectionMatch?.[1]) {
			const key = collectionMatch[1];
			const collection = await client.getCollection(key);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: JSON.stringify(collection, null, 2),
					},
				],
			};
		}

		throw new Error(`Unsupported resource URI: ${uri}`);
	});

	let shuttingDown = false;

	function shutdown(signal: string) {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info(`Received ${signal}, shutting down...`);
		process.exit(0);
	}

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info("Zotero MCP server started");
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	logger.error("Fatal error during startup:", message);
	process.exit(1);
}
