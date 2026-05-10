import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";

export const name = "zotero_list_tags";

export const description = "List tags in the Zotero library.";

export const inputSchema = {
	type: "object" as const,
	properties: {
		limit: { type: "number", description: "Maximum results (default 25)" },
		start: { type: "number", description: "Pagination offset (default 0)" },
	},
};

const schema = z.object({
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

	const { limit = 25, start = 0 } = parsed.data;
	const tags = await client.listTags({ limit, start });

	if (tags.length === 0) {
		return { content: [{ type: "text" as const, text: "No tags found." }] };
	}

	const lines = tags.map((t) => `- ${t.tag}`);
	const text = `Tags (${tags.length}):\n${lines.join("\n")}`;
	return { content: [{ type: "text" as const, text }] };
}
