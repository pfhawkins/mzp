import { z } from "zod";
import type { ZoteroClient } from "../zotero/client.js";

export const name = "zotero_get_item_children";

export const description = "Fetch notes and attachments for a Zotero item.";

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

const namedHtmlEntities: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#\d+|#x[\da-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, value: string) => {
		if (value.startsWith("#x")) {
			const codePoint = Number.parseInt(value.slice(2), 16);
			return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
		}

		if (value.startsWith("#")) {
			const codePoint = Number.parseInt(value.slice(1), 10);
			return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
		}

		return namedHtmlEntities[value] ?? entity;
	});
}

function isValidCodePoint(codePoint: number): boolean {
	return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff;
}

function formatNoteText(noteText: string): string {
	return decodeHtmlEntities(noteText.replace(/<[^>]+>/g, "")).slice(0, 200);
}

export async function handler(client: ZoteroClient, args: unknown) {
	const parsed = schema.safeParse(args);
	if (!parsed.success) {
		return {
			content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
			isError: true,
		};
	}

	const children = await client.getItemChildren(parsed.data.itemKey);
	if (children.length === 0) {
		return {
			content: [{ type: "text" as const, text: "No children (notes or attachments) found." }],
		};
	}

	const notes = children.filter((c) => c.itemType === "note");
	const attachments = children.filter((c) => c.itemType === "attachment");

	const lines: string[] = [`Children for item ${parsed.data.itemKey}:`];

	if (notes.length > 0) {
		lines.push("", `Notes (${notes.length}):`);
		for (const note of notes) {
			const noteText = (note as Record<string, unknown>).note as string | undefined;
			const title = note.title ?? "Untitled Note";
			lines.push(`- ${title} (key: ${note.key})`);
			if (noteText) lines.push(`  ${formatNoteText(noteText)}...`);
		}
	}

	if (attachments.length > 0) {
		lines.push("", `Attachments (${attachments.length}):`);
		for (const att of attachments) {
			const filename = (att as Record<string, unknown>).filename as string | undefined;
			const url = (att as Record<string, unknown>).url as string | undefined;
			const linkMode = (att as Record<string, unknown>).linkMode as string | undefined;
			const title = att.title ?? filename ?? "Untitled Attachment";
			lines.push(`- ${title} (key: ${att.key}, mode: ${linkMode ?? "unknown"})`);
			if (url) lines.push(`  URL: ${url}`);
		}
	}

	return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
