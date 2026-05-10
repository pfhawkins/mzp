import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";
import { formatItemSummary } from "./helpers.js";

export const name = "zotero_get_collection_items";

export const description = "List items in a Zotero collection.";

export const inputSchema = {
	type: "object" as const,
	properties: {
		collectionKey: { type: "string", description: "Collection key" },
		limit: { type: "number", description: "Maximum results (1-50, default 25)" },
		start: { type: "number", description: "Pagination offset (default 0)" },
	},
	required: ["collectionKey"],
};

const schema = z.object({
	collectionKey: z.string().min(1),
	limit: z.number().min(1).max(50).optional(),
	start: z.number().min(0).optional(),
});

export async function handler(client: ZoteroClient, args: unknown) {
	const parsed = schema.safeParse(args);
	if (!parsed.success) {
		return {
			content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
			isError: true,
		};
	}

	const { collectionKey, limit = 25, start = 0 } = parsed.data;
	const items = await client.listCollectionItems(collectionKey, { limit, start });

	if (items.length === 0) {
		return { content: [{ type: "text" as const, text: "No items found in this collection." }] };
	}

	const summaries = items.map(formatItemSummary);
	const text = `Items in collection ${collectionKey} (${items.length}):\n\n${summaries.join("\n\n")}`;
	return { content: [{ type: "text" as const, text }] };
}
