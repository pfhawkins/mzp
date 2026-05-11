import { describe, expect, test } from "bun:test";
import type { ZoteroClient } from "../../zotero/client.js";
import * as createItem from "../createItem.js";
import * as getCollectionItems from "../getCollectionItems.js";
import * as getFulltext from "../getFulltext.js";
import * as getItem from "../getItem.js";
import * as getItemChildren from "../getItemChildren.js";
import * as listCollections from "../listCollections.js";
import * as listTags from "../listTags.js";
import * as recent from "../recent.js";
import * as search from "../search.js";

function makeMockClient(overrides?: Partial<ZoteroClient>): ZoteroClient {
	return overrides as unknown as ZoteroClient;
}

async function* asyncItems<T>(items: T[]): AsyncGenerator<T> {
	for (const item of items) {
		yield item;
	}
}

describe("zotero_search", () => {
	test("rejects empty query", async () => {
		const client = makeMockClient();
		const result = await search.handler(client, { query: "" });
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Invalid input");
	});

	test("returns formatted results", async () => {
		const client = makeMockClient({
			listItems: async () => [
				{
					key: "ITEM1",
					itemType: "journalArticle",
					title: "Test Article",
					creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
					date: "2024",
					tags: [{ tag: "test" }],
					version: 1,
				},
			],
		});
		const result = await search.handler(client, { query: "test" });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("Test Article");
		expect(result.content[0]?.text).toContain("ITEM1");
	});

	test("returns no results message when empty", async () => {
		const client = makeMockClient({ listItems: async () => [] });
		const result = await search.handler(client, { query: "nothing" });
		expect(result.content[0]?.text).toBe("No items found.");
	});

	test("propagates client errors", async () => {
		const client = makeMockClient({
			listItems: async () => {
				throw new Error("API down");
			},
		});
		await expect(search.handler(client, { query: "test" })).rejects.toThrow("API down");
	});
});

describe("zotero_get_item", () => {
	test("rejects missing itemKey", async () => {
		const client = makeMockClient();
		const result = await getItem.handler(client, {});
		expect(result.isError).toBe(true);
	});

	test("returns item detail", async () => {
		const client = makeMockClient({
			getItem: async () => ({
				key: "ITEM1",
				itemType: "book",
				title: "A Book",
				creators: [{ creatorType: "author", lastName: "Doe" }],
				date: "2023",
				version: 1,
			}),
		});
		const result = await getItem.handler(client, { itemKey: "ITEM1" });
		expect(result.content[0]?.text).toContain("A Book");
		expect(result.content[0]?.text).toContain("ITEM1");
		expect(result.content[0]?.text).toContain("Full JSON");
	});
});

describe("zotero_get_item_children", () => {
	test("returns notes and attachments", async () => {
		const client = makeMockClient({
			getItemChildren: async () => [
				{
					key: "NOTE1",
					itemType: "note",
					title: "My Note",
					note: "<p>Note content</p>",
					version: 1,
				},
				{
					key: "ATT1",
					itemType: "attachment",
					title: "PDF",
					filename: "paper.pdf",
					linkMode: "imported_file",
					version: 1,
				},
			],
		});
		const result = await getItemChildren.handler(client, { itemKey: "ITEM1" });
		expect(result.content[0]?.text).toContain("Notes (1)");
		expect(result.content[0]?.text).toContain("Attachments (1)");
		expect(result.content[0]?.text).toContain("Note content");
		expect(result.content[0]?.text).toContain("PDF");
		expect(result.content[0]?.text).toContain("ATT1");
	});

	test("decodes HTML entities in notes after stripping tags", async () => {
		const client = makeMockClient({
			getItemChildren: async () => [
				{
					key: "NOTE1",
					itemType: "note",
					title: "My Note",
					note: "<p>Research &amp; Development &#40;R&amp;D&#41; costs &#x3c; budget</p>",
					version: 1,
				},
			],
		});

		const result = await getItemChildren.handler(client, { itemKey: "ITEM1" });

		expect(result.content[0]?.text).toContain("Research & Development (R&D) costs < budget");
		expect(result.content[0]?.text).not.toContain("&amp;");
	});

	test("returns empty message when no children", async () => {
		const client = makeMockClient({ getItemChildren: async () => [] });
		const result = await getItemChildren.handler(client, { itemKey: "ITEM1" });
		expect(result.content[0]?.text).toContain("No children");
	});
});

describe("zotero_list_collections", () => {
	test("returns collections list", async () => {
		const client = makeMockClient({
			listCollections: async () => [
				{ key: "C1", name: "Papers", version: 1 },
				{ key: "C2", name: "Books", version: 1 },
			],
		});
		const result = await listCollections.handler(client, {});
		expect(result.content[0]?.text).toContain("Papers (key: C1)");
		expect(result.content[0]?.text).toContain("Books (key: C2)");
	});

	test("rejects negative start", async () => {
		const client = makeMockClient();
		const result = await listCollections.handler(client, { start: -1 });
		expect(result.isError).toBe(true);
	});
});

describe("zotero_get_collection_items", () => {
	test("rejects missing collectionKey", async () => {
		const client = makeMockClient();
		const result = await getCollectionItems.handler(client, {});
		expect(result.isError).toBe(true);
	});

	test("returns collection items", async () => {
		const client = makeMockClient({
			listCollectionItems: async () => [
				{
					key: "I1",
					itemType: "journalArticle",
					title: "Article One",
					version: 1,
				},
			],
		});
		const result = await getCollectionItems.handler(client, { collectionKey: "C1" });
		expect(result.content[0]?.text).toContain("Article One");
	});
});

describe("zotero_list_tags", () => {
	test("returns tags list", async () => {
		const client = makeMockClient({
			listTags: async () => [{ tag: "ai" }, { tag: "ml" }],
		});
		const result = await listTags.handler(client, {});
		expect(result.content[0]?.text).toContain("ai");
		expect(result.content[0]?.text).toContain("ml");
	});
});

describe("zotero_get_fulltext", () => {
	test("returns fulltext content", async () => {
		const client = makeMockClient({
			getItemFulltext: async () => ({
				content: "This is the full text.",
				indexedPages: 5,
				indexedChars: 100,
			}),
		});
		const result = await getFulltext.handler(client, { itemKey: "ITEM1" });
		expect(result.content[0]?.text).toContain("This is the full text.");
		expect(result.content[0]?.text).toContain("Indexed pages: 5");
		expect(result.content[0]?.text).toContain("Showing chars 0-22 of 22");
	});

	test("returns message when no fulltext", async () => {
		const client = makeMockClient({ getItemFulltext: async () => ({}) });
		const result = await getFulltext.handler(client, { itemKey: "ITEM1" });
		expect(result.content[0]?.text).toContain("No full-text content");
	});

	test("returns a requested fulltext page with a next offset", async () => {
		const client = makeMockClient({
			getItemFulltext: async () => ({
				content: "abcdefghijklmnopqrstuvwxyz",
				indexedChars: 26,
			}),
		});

		const result = await getFulltext.handler(client, {
			itemKey: "ITEM1",
			offset: 5,
			length: 10,
		});

		expect(result.content[0]?.text).toContain("Showing chars 5-15 of 26");
		expect(result.content[0]?.text).toContain("\nfghijklmno\n");
		expect(result.content[0]?.text).toContain("Next offset: 15");
	});

	test("reports when fulltext offset is past available content", async () => {
		const client = makeMockClient({
			getItemFulltext: async () => ({
				content: "short text",
				indexedChars: 100,
			}),
		});

		const result = await getFulltext.handler(client, { itemKey: "ITEM1", offset: 20 });

		expect(result.content[0]?.text).toContain("Available chars: 10");
		expect(result.content[0]?.text).toContain("Requested offset 20 is past the available content");
	});

	test("rejects invalid fulltext page length", async () => {
		const client = makeMockClient();
		const result = await getFulltext.handler(client, { itemKey: "ITEM1", length: 0 });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Invalid input");
	});
});

describe("zotero_recent", () => {
	test("returns recent items sorted", async () => {
		const client = makeMockClient({
			listItems: async () => [
				{
					key: "I1",
					itemType: "book",
					title: "New Book",
					dateModified: "2024-12-01T00:00:00Z",
					version: 1,
				},
			],
		});
		const result = await recent.handler(client, { limit: 5 });
		expect(result.content[0]?.text).toContain("New Book");
	});

	test("filters by since date", async () => {
		const client = makeMockClient({
			iterateItems: () =>
				asyncItems([
					{
						key: "I2",
						itemType: "book",
						title: "New Book",
						dateModified: "2024-12-01T00:00:00Z",
						version: 1,
					},
					{
						key: "I1",
						itemType: "book",
						title: "Old Book",
						dateModified: "2023-01-01T00:00:00Z",
						version: 1,
					},
				]),
		});
		const result = await recent.handler(client, { since: "2024-06-01T00:00:00Z" });
		expect(result.content[0]?.text).toContain("New Book");
		expect(result.content[0]?.text).not.toContain("Old Book");
	});

	test("accepts date-only since values", async () => {
		const client = makeMockClient({
			iterateItems: () =>
				asyncItems([
					{
						key: "I2",
						itemType: "book",
						title: "Same Day Book",
						dateModified: "2024-06-01T12:00:00Z",
						version: 1,
					},
					{
						key: "I1",
						itemType: "book",
						title: "Previous Day Book",
						dateModified: "2024-05-31T23:59:59Z",
						version: 1,
					},
				]),
		});

		const result = await recent.handler(client, { since: "2024-06-01" });

		expect(result.content[0]?.text).toContain("Same Day Book");
		expect(result.content[0]?.text).not.toContain("Previous Day Book");
	});

	test("uses the item iterator for since results until the requested limit is filled", async () => {
		const calls: Array<{ limit?: number; sort?: string; direction?: string }> = [];
		const client = makeMockClient({
			iterateItems: (opts) => {
				calls.push({ limit: opts?.limit, sort: opts?.sort, direction: opts?.direction });
				return asyncItems([
					{
						key: "I1",
						itemType: "book",
						title: "First New Book",
						dateModified: "2024-12-03T00:00:00Z",
						version: 1,
					},
					{
						key: "I2",
						itemType: "book",
						title: "Missing Modified Date",
						version: 1,
					},
					{
						key: "I3",
						itemType: "book",
						title: "Second New Book",
						dateModified: "2024-12-02T00:00:00Z",
						version: 1,
					},
					{
						key: "I4",
						itemType: "book",
						title: "Old Book",
						dateModified: "2023-01-01T00:00:00Z",
						version: 1,
					},
				]);
			},
		});

		const result = await recent.handler(client, { limit: 2, since: "2024-06-01T00:00:00Z" });

		expect(calls).toEqual([{ limit: 2, sort: "dateModified", direction: "desc" }]);
		expect(result.content[0]?.text).toContain("First New Book");
		expect(result.content[0]?.text).toContain("Second New Book");
		expect(result.content[0]?.text).not.toContain("Missing Modified Date");
		expect(result.content[0]?.text).not.toContain("Old Book");
	});

	test("rejects invalid since date", async () => {
		const client = makeMockClient();
		const result = await recent.handler(client, { since: "not-a-date" });
		expect(result.isError).toBe(true);
	});

	test("rejects invalid date-only since dates", async () => {
		const client = makeMockClient();
		const result = await recent.handler(client, { since: "2024-02-31" });
		expect(result.isError).toBe(true);
	});
});

describe("zotero_create_item", () => {
	test("preserves valid Zotero fields outside the common field list", async () => {
		let createdItem: object | undefined;
		const client = makeMockClient({
			createItem: async (itemData) => {
				createdItem = itemData;
				return { success: { "0": "NEWITEM" } };
			},
		});

		const result = await createItem.handler(client, {
			itemType: "book",
			title: "A Book",
			publisher: "Example Press",
			ISBN: "978-0-00-000000-0",
			language: "en",
			creators: [{ creatorType: "author", name: "Ada Lovelace" }],
			customZoteroField: "kept",
		});

		expect(result.content[0]?.text).toContain("NEWITEM");
		expect(createdItem).toEqual({
			itemType: "book",
			title: "A Book",
			publisher: "Example Press",
			ISBN: "978-0-00-000000-0",
			language: "en",
			creators: [{ creatorType: "author", name: "Ada Lovelace" }],
			customZoteroField: "kept",
		});
	});

	test("strips server-assigned fields before creating an item", async () => {
		let createdItem: object | undefined;
		const client = makeMockClient({
			createItem: async (itemData) => {
				createdItem = itemData;
				return { success: { "0": "NEWITEM" } };
			},
		});

		const result = await createItem.handler(client, {
			itemType: "book",
			title: "A Book",
			key: "EXISTING1",
			version: 12,
			itemKey: "EXISTING1",
			customZoteroField: "kept",
		});

		expect(result.content[0]?.text).toContain("NEWITEM");
		expect(createdItem).toEqual({
			itemType: "book",
			title: "A Book",
			customZoteroField: "kept",
		});
	});

	test("treats Zotero batch write failures as creation errors", async () => {
		const client = makeMockClient({
			createItem: async () => ({
				success: {},
				failed: {
					"0": {
						code: 400,
						message: "Invalid item data",
					},
				},
			}),
		});

		await expect(
			createItem.handler(client, {
				itemType: "book",
				title: "A Book",
			}),
		).rejects.toThrow("Zotero item creation failed: Invalid item data (code: 400)");
	});
});
