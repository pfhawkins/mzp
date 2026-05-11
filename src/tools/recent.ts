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

type ZoteroItem = Awaited<ReturnType<ZoteroClient["listItems"]>>[number];

const sortOptions = {
	sort: "dateModified",
	direction: "desc",
} as const;

function parseSinceDate(value: string): Date | undefined {
	const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnlyMatch) {
		const [, yearValue, monthValue, dayValue] = dateOnlyMatch;
		const year = Number(yearValue);
		const month = Number(monthValue);
		const day = Number(dayValue);
		const date = new Date(Date.UTC(year, month - 1, day));
		const isValidDate =
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day;

		return isValidDate ? date : undefined;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

const schema = z.object({
	limit: z.number().min(1).max(50).optional(),
	since: z
		.string()
		.transform((value, ctx) => {
			const date = parseSinceDate(value);
			if (!date) {
				ctx.addIssue({
					code: "custom",
					message: "Expected an ISO date or datetime string",
				});
				return z.NEVER;
			}

			return date;
		})
		.optional(),
});

function modifiedAt(item: ZoteroItem): Date | undefined {
	const dateModified = (item as Record<string, unknown>).dateModified;
	if (typeof dateModified !== "string") return undefined;

	const date = new Date(dateModified);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

async function listItemsSince(client: ZoteroClient, limit: number, sinceDate: Date) {
	const items: ZoteroItem[] = [];

	for await (const item of client.iterateItems({
		...sortOptions,
		limit,
	})) {
		const dateModified = modifiedAt(item);
		if (!dateModified) continue;

		if (dateModified < sinceDate) {
			break;
		}

		items.push(item);
		if (items.length >= limit) break;
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
	const filtered = since
		? await listItemsSince(client, limit, since)
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
