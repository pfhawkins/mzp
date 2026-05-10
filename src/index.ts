import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { tools } from "./tools/index.js";
import { ZoteroClient } from "./zotero/client.js";

const config = loadConfig();
const client = new ZoteroClient(config);

const server = new Server(
	{ name: "zotero-mcp", version: "0.1.0" },
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
		throw new Error(`Unknown tool: ${request.params.name}`);
	}
	try {
		return await tool.handler(client, request.params.arguments ?? {});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: "text" as const, text: `Error: ${message}` }],
			isError: true,
		};
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

const transport = new StdioServerTransport();
await server.connect(transport);
