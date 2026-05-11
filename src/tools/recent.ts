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

type ZoteroItem = Awaited<ReturnType<ZoteroClient["listItems"]>>[number];

const sortOptions = {
	sort: "dateModified",
	direction: "desc",
} as const;

function modifiedAt(item: ZoteroItem): Date | undefined {
	const dateModified = (item as Record<string, unknown>).dateModified;
	if (typeof dateModified !== "string") return undefined;

	const date = new Date(dateModified);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

async function listItemsSince(client: ZoteroClient, limit: number, sinceDate: Date) {
	const items: ZoteroItem[] = [];
	let start = 0;
	let reachedCutoff = false;

	while (items.length < limit && !reachedCutoff) {
		const page = await client.listItems({
			...sortOptions,
			limit,
			start,
		});

		if (page.length === 0) break;

		for (const item of page) {
			const dateModified = modifiedAt(item);
			if (!dateModified) continue;

			if (dateModified < sinceDate) {
				reachedCutoff = true;
				break;
			}

			items.push(item);
			if (items.length >= limit) break;
		}

		if (page.length < limit) break;
		start += limit;
	}

	return items;
}

export async function handler(client: ZoteroClient, args: unknown) {
	const parsed = schema.safeParse(args);
	if (!parsed.success) {
		return {
			content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
			isError: true,
		};
	}

	const { limit = 10, since } = parsed.data;
	const sinceDate = since ? new Date(since) : undefined;
	const filtered = sinceDate
		? await listItemsSince(client, limit, sinceDate)
		: await client.listItems({
				...sortOptions,
				limit,
			});

	if (filtered.length === 0) {
		return { content: [{ type: "text" as const, text: "No recent items found." }] };
	}

	const summaries = filtered.map(formatItemSummary);
	const text = `Recent items (${filtered.length}):\n\n${summaries.join("\n\n")}`;
	return { content: [{ type: "text" as const, text }] };
}
