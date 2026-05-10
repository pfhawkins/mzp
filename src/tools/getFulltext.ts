import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";

export const name = "zotero_get_fulltext";

export const description = "Fetch indexed full-text content for a Zotero item.";

export const inputSchema = {
	type: "object" as const,
	properties: {
		itemKey: { type: "string", description: "Zotero item key" },
	},
	required: ["itemKey"],
};

const schema = z.object({
	itemKey: z.string().min(1),
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

	const lines = [
		`Full-text for item ${parsed.data.itemKey}:`,
		`Indexed pages: ${fulltext.indexedPages ?? "unknown"}`,
		`Indexed chars: ${fulltext.indexedChars ?? "unknown"}`,
		"",
		fulltext.content.slice(0, 5000),
	];

	if (fulltext.content.length > 5000) {
		lines.push("\n... (truncated)");
	}

	return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
