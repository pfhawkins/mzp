import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";

export const name = "zotero_get_fulltext";

export const description = "Fetch indexed full-text content for a Zotero item.";

export const inputSchema = {
	type: "object" as const,
	properties: {
		itemKey: { type: "string", description: "Zotero item key" },
		offset: {
			type: "integer",
			description: "Zero-based character offset to start reading from",
			minimum: 0,
		},
		length: {
			type: "integer",
			description: "Maximum number of characters to return",
			minimum: 1,
			maximum: 20000,
		},
	},
	required: ["itemKey"],
};

const schema = z.object({
	itemKey: z.string().min(1),
	offset: z.number().int().nonnegative().default(0),
	length: z.number().int().min(1).max(20000).default(5000),
});

export async function handler(client: ZoteroClient, args: unknown) {
	const parsed = schema.safeParse(args);
	if (!parsed.success) {
		return {
			content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
			isError: true,
		};
	}

	const fulltext = await client.getItemFulltext(parsed.data.itemKey);

	if (!fulltext.content) {
		return {
			content: [
				{
					type: "text" as const,
					text: `No full-text content indexed for item ${parsed.data.itemKey}.`,
				},
			],
		};
	}

	const totalChars = fulltext.content.length;
	const start = parsed.data.offset;
	const end = Math.min(start + parsed.data.length, totalChars);
	const page = fulltext.content.slice(start, end);

	if (start >= totalChars) {
		return {
			content: [
				{
					type: "text" as const,
					text: [
						`Full-text for item ${parsed.data.itemKey}:`,
						`Indexed pages: ${fulltext.indexedPages ?? "unknown"}`,
						`Indexed chars: ${fulltext.indexedChars ?? "unknown"}`,
						`Available chars: ${totalChars}`,
						`Requested offset ${start} is past the available content.`,
					].join("\n"),
				},
			],
		};
	}

	const lines = [
		`Full-text for item ${parsed.data.itemKey}:`,
		`Indexed pages: ${fulltext.indexedPages ?? "unknown"}`,
		`Indexed chars: ${fulltext.indexedChars ?? "unknown"}`,
		`Available chars: ${totalChars}`,
		`Showing chars ${start}-${end} of ${totalChars}`,
		"",
		page,
	];

	if (end < totalChars) {
		lines.push("", `More content available. Next offset: ${end}`);
	}

	return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
