import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";
import { formatItemSummary } from "./helpers.js";

export const name = "zotero_search";

export const description =
	"Search Zotero items by full-text/keyword query. Supports filtering by item type and tag.";

export const inputSchema = {
	type: "object" as const,
	properties: {
		query: { type: "string", description: "Search query" },
		limit: {
			type: "number",
			description: "Maximum results (1-50, default 10)",
		},
		itemType: { type: "string", description: "Filter by item type (e.g. journalArticle, book)" },
		tag: { type: "string", description: "Filter by a single tag" },
	},
	required: ["query"],
};

const schema = z.object({
	query: z.string().min(1),
	limit: z.number().min(1).max(50).optional(),
	itemType: z.string().optional(),
	tag: z.string().optional(),
});

export async function handler(client: ZoteroClient, args: unknown) {
	const parsed = schema.safeParse(args);
	if (!parsed.success) {
		return {
			content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
			isError: true,
		};
	}

	const { query, limit = 10, itemType, tag } = parsed.data;
	const items = await client.listItems({
		q: query,
		qmode: "everything",
		limit,
		itemType,
		tag: tag ? [tag] : undefined,
	});

	if (items.length === 0) {
		return { content: [{ type: "text" as const, text: "No items found." }] };
	}

	const summaries = items.map(formatItemSummary);
	const text = `Found ${items.length} item(s):\n\n${summaries.join("\n\n")}`;
	return { content: [{ type: "text" as const, text }] };
}
