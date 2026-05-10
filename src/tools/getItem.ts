import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";
import { formatItemDetail } from "./helpers.js";

export const name = "zotero_get_item";

export const description = "Fetch a single Zotero item by its key.";

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

	const item = await client.getItem(parsed.data.itemKey);
	const summary = formatItemDetail(item);
	const json = JSON.stringify(item, null, 2);
	const text = `${summary}\n\n--- Full JSON ---\n${json}`;
	return { content: [{ type: "text" as const, text }] };
}
