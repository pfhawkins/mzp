import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";
import { formatItemSummary } from "./helpers.js";

export const name = "zotero_recent";

export const description =
	"Fetch recently added or modified Zotero items. Optionally filter to items changed since a specific date.";

export const inputSchema = {
	type: "object" as const,
	properties: {
		limit: {
			type: "number",
			description: "Maximum results (1-50, default 10)",
		},
		since: {
			type: "string",
			description: "ISO date string to filter items modified since this date",
		},
	},
};

const schema = z.object({
	limit: z.number().min(1).max(50).optional(),
	since: z.string().datetime().optional(),
});

export async function handler(client: ZoteroClient, args: unknown) {
	const parsed = schema.safeParse(args);
	if (!parsed.success) {
		return {
			content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
			isError: true,
		};
	}

	const { limit = 10, since } = parsed.data;
	const items = await client.listItems({
		sort: "dateModified",
		direction: "desc",
		limit,
	});

	const sinceDate = since ? new Date(since) : undefined;
	const filtered = sinceDate
		? items.filter((item) => {
				const dm = (item as Record<string, unknown>).dateModified as string | undefined;
				return dm ? new Date(dm) >= sinceDate : false;
			})
		: items;

	if (filtered.length === 0) {
		return { content: [{ type: "text" as const, text: "No recent items found." }] };
	}

	const summaries = filtered.map(formatItemSummary);
	const text = `Recent items (${filtered.length}):\n\n${summaries.join("\n\n")}`;
	return { content: [{ type: "text" as const, text }] };
}
