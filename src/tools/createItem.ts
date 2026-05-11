import { z } from "zod";
import type { ToolDefinition } from "./index.js";

export const name = "zotero_create_item";
export const description =
	"Create a new item in the Zotero library. Provide the item metadata as a JSON object. Common fields: itemType (e.g. journalArticle, preprint, book), title, creators (array of {creatorType, firstName, lastName}), abstractNote, url, date, tags (array of {tag}), collections (array of collection keys).";
export const inputSchema = {
	type: "object",
	properties: {
		itemType: {
			type: "string",
			description: "Zotero item type, e.g. journalArticle, preprint, conferencePaper, book",
		},
		title: { type: "string" },
		creators: {
			type: "array",
			items: {
				type: "object",
				properties: {
					creatorType: { type: "string" },
					firstName: { type: "string" },
					lastName: { type: "string" },
					name: { type: "string" },
				},
				additionalProperties: true,
			},
		},
		abstractNote: { type: "string" },
		url: { type: "string" },
		date: { type: "string" },
		publicationTitle: { type: "string" },
		volume: { type: "string" },
		issue: { type: "string" },
		pages: { type: "string" },
		DOI: { type: "string" },
		publisher: { type: "string" },
		ISBN: { type: "string" },
		language: { type: "string" },
		extra: { type: "string" },
		tags: {
			type: "array",
			items: {
				type: "object",
				properties: {
					tag: { type: "string" },
				},
				additionalProperties: true,
			},
		},
		collections: {
			type: "array",
			items: { type: "string" },
			description: "Array of collection keys to add the item to",
		},
	},
	required: ["itemType", "title"],
	additionalProperties: true,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatWriteFailure(failure: unknown): string {
	if (!isRecord(failure)) {
		return String(failure);
	}

	const message = typeof failure.message === "string" ? failure.message : undefined;
	const code =
		typeof failure.code === "number" || typeof failure.code === "string" ? failure.code : undefined;
	if (message && code !== undefined) {
		return `${message} (code: ${code})`;
	}
	if (message) {
		return message;
	}

	return JSON.stringify(failure);
}

function getWriteFailure(result: unknown): unknown | undefined {
	if (!isRecord(result) || !isRecord(result.failed)) {
		return undefined;
	}

	if (Object.hasOwn(result.failed, "0")) {
		return result.failed["0"];
	}

	const firstFailedKey = Object.keys(result.failed)[0];
	return firstFailedKey ? result.failed[firstFailedKey] : undefined;
}

export const handler: ToolDefinition["handler"] = async (client, args) => {
	const parsed = z
		.object({
			itemType: z.string(),
			title: z.string(),
			creators: z
				.array(
					z
						.object({
							creatorType: z.string(),
							firstName: z.string().optional(),
							lastName: z.string().optional(),
							name: z.string().optional(),
						})
						.passthrough(),
				)
				.optional(),
			abstractNote: z.string().optional(),
			url: z.string().optional(),
			date: z.string().optional(),
			publicationTitle: z.string().optional(),
			volume: z.string().optional(),
			issue: z.string().optional(),
			pages: z.string().optional(),
			DOI: z.string().optional(),
			publisher: z.string().optional(),
			ISBN: z.string().optional(),
			language: z.string().optional(),
			extra: z.string().optional(),
			tags: z.array(z.object({ tag: z.string() }).passthrough()).optional(),
			collections: z.array(z.string()).optional(),
		})
		.passthrough()
		.parse(args);

	const itemData = { ...parsed };

	const result = await client.createItem(itemData);
	const writeFailure = getWriteFailure(result);
	if (writeFailure !== undefined) {
		throw new Error(`Zotero item creation failed: ${formatWriteFailure(writeFailure)}`);
	}

	return {
		content: [
			{
				type: "text" as const,
				text: `Item created successfully.\n\n${JSON.stringify(result, null, 2)}`,
			},
		],
	};
};
