import type { z } from "zod";
import type { zoteroItemSchema } from "../zotero/schemas.js";

type Item = z.infer<typeof zoteroItemSchema>;

export function formatCreators(
	creators?: Array<{
		creatorType: string;
		firstName?: string;
		lastName?: string;
		name?: string;
	}>,
): string {
	if (!creators?.length) return "Unknown";
	return creators
		.map((c) => c.name ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim())
		.join(", ");
}

export function formatTags(tags?: Array<{ tag: string }>): string {
	return tags?.map((t) => t.tag).join(", ") ?? "";
}

export function formatItemSummary(item: Item): string {
	const title = item.title ?? "Untitled";
	const creators = formatCreators(item.creators);
	const date = item.date ?? "n.d.";
	const itemType = item.itemType ?? "unknown";
	const tags = formatTags(item.tags);
	const lines = [
		`- ${title}`,
		`  Key: ${item.key}`,
		`  Type: ${itemType} | Creators: ${creators} | Date: ${date}`,
	];
	if (tags) lines.push(`  Tags: ${tags}`);
	return lines.join("\n");
}

export function formatItemDetail(item: Item): string {
	const title = item.title ?? "Untitled";
	const creators = formatCreators(item.creators);
	const date = item.date ?? "n.d.";
	const itemType = item.itemType ?? "unknown";
	const tags = formatTags(item.tags);
	const abstract = (item as Record<string, unknown>).abstractNote as string | undefined;
	const url = (item as Record<string, unknown>).url as string | undefined;

	const lines = [
		`Title: ${title}`,
		`Key: ${item.key}`,
		`Type: ${itemType}`,
		`Creators: ${creators}`,
		`Date: ${date}`,
	];
	if (tags) lines.push(`Tags: ${tags}`);
	if (url) lines.push(`URL: ${url}`);
	if (abstract) lines.push(`Abstract: ${abstract}`);
	return lines.join("\n");
}
