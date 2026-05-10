import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { ZoteroClient } from "../client.js";

const originalFetch = globalThis.fetch;

function mockFetch(
	handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
	globalThis.fetch = handler as unknown as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ZoteroClient", () => {
	test("throws if neither userId nor groupId provided", () => {
		expect(() => new ZoteroClient({ apiKey: "test" })).toThrow(
			"Exactly one of userId or groupId must be provided",
		);
	});

	test("throws if both userId and groupId provided", () => {
		expect(() => new ZoteroClient({ apiKey: "test", userId: "123", groupId: "456" })).toThrow(
			"Exactly one of userId or groupId must be provided",
		);
	});

	test("creates client with userId", () => {
		const client = new ZoteroClient({ apiKey: "test", userId: "123" });
		expect(client).toBeDefined();
	});

	test("creates client with groupId", () => {
		const client = new ZoteroClient({ apiKey: "test", groupId: "456" });
		expect(client).toBeDefined();
	});

	test("parses item fields from Zotero data envelopes", async () => {
		const requests: { url: string; headers: Headers }[] = [];
		mockFetch(async (url, init) => {
			requests.push({
				url: url.toString(),
				headers: new Headers(init?.headers),
			});
			return new Response(
				JSON.stringify([
					{
						key: "ABCD1234",
						version: 9,
						links: {
							self: { href: "https://api.zotero.org/users/123/items/ABCD1234" },
						},
						data: {
							key: "ABCD1234",
							version: 9,
							itemType: "journalArticle",
							title: "A Real Zotero Item",
							creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
							tags: [{ tag: "computing" }],
							collections: ["COLL1234"],
						},
					},
				]),
			);
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});

		const items = await client.listItems({ limit: 1 });

		expect(items).toHaveLength(1);
		expect(items[0]?.key).toBe("ABCD1234");
		expect(items[0]?.itemType).toBe("journalArticle");
		expect(items[0]?.title).toBe("A Real Zotero Item");
		expect(items[0]?.creators?.[0]?.lastName).toBe("Lovelace");
		expect(items[0]?.tags?.[0]?.tag).toBe("computing");
		expect(items[0]?.collections).toEqual(["COLL1234"]);
		expect(requests[0]?.headers.get("Zotero-API-Version")).toBe("3");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer test");
	});

	test("parses collection fields from Zotero data envelopes", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify([
					{
						key: "COLL1234",
						version: 3,
						data: {
							key: "COLL1234",
							version: 3,
							name: "Research Notes",
							parentCollection: false,
						},
					},
				]),
			);
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});

		const collections = await client.listCollections();

		expect(collections).toHaveLength(1);
		expect(collections[0]?.key).toBe("COLL1234");
		expect(collections[0]?.name).toBe("Research Notes");
		expect(collections[0]?.parentCollection).toBe(false);
	});

	test("paginate follows rel next URLs from Link headers", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());

			if (urls.length === 1) {
				return new Response(JSON.stringify([{ id: 1 }]), {
					headers: {
						Link: '<https://zotero.test/users/123/items?limit=1&start=99>; rel="next"',
					},
				});
			}

			return new Response(JSON.stringify([{ id: 2 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});

		const results = [];
		for await (const item of client.paginate("/items", z.array(z.object({ id: z.number() })), {
			limit: 1,
			params: { start: 5 },
		})) {
			results.push(item);
		}

		expect(results).toEqual([{ id: 1 }, { id: 2 }]);
		expect(urls).toEqual([
			"https://zotero.test/users/123/items?limit=1&start=5",
			"https://zotero.test/users/123/items?limit=1&start=99",
		]);
	});
});
