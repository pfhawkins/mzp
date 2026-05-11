import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { ZoteroApiError, ZoteroClient } from "../client.js";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

function mockFetch(
	handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
	globalThis.fetch = handler as unknown as typeof fetch;
}

function mockSetTimeoutImmediate(delays?: number[]) {
	globalThis.setTimeout = ((cb: () => void, delay?: number) => {
		delays?.push(delay ?? 0);
		cb();
		return 0;
	}) as unknown as typeof setTimeout;
}

async function collectAsync<T>(items: AsyncIterable<T>): Promise<T[]> {
	const results: T[] = [];
	for await (const item of items) {
		results.push(item);
	}
	return results;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	globalThis.setTimeout = originalSetTimeout;
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

	test("sends correct headers on every request", async () => {
		const requests: { url: string; headers: Headers }[] = [];
		mockFetch(async (url, init) => {
			requests.push({
				url: url.toString(),
				headers: new Headers(init?.headers),
			});
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({
			apiKey: "my-secret-key",
			userId: "123",
			baseUrl: "https://zotero.test",
		});

		await client.listItems({ limit: 1 });

		expect(requests[0]?.headers.get("Zotero-API-Version")).toBe("3");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer my-secret-key");
	});

	test("parses item fields from Zotero data envelopes", async () => {
		mockFetch(async () => {
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

		const results: Array<{ id: number }> = [];
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

	test("paginate rejects cross-origin next links", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ id: 1 }]), {
				headers: {
					Link: '<https://evil.test/users/123/items?limit=1&start=99>; rel="next"',
				},
			});
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});

		const results: Array<{ id: number }> = [];
		const iterator = client.paginate("/items", z.array(z.object({ id: z.number() })), {
			limit: 1,
		});

		await expect(
			(async () => {
				for await (const item of iterator) {
					results.push(item);
				}
			})(),
		).rejects.toThrow("Refusing to follow cross-origin pagination link");

		expect(results).toEqual([{ id: 1 }]);
		expect(urls).toEqual(["https://zotero.test/users/123/items?limit=1&start=0"]);
	});

	test("paginate stops when no next link", async () => {
		mockFetch(async () => {
			return new Response(JSON.stringify([{ id: 1 }]), {
				headers: { Link: "" },
			});
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const results = [];
		for await (const item of client.paginate("/items", z.array(z.object({ id: z.number() })))) {
			results.push(item);
		}
		expect(results).toEqual([{ id: 1 }]);
	});

	test("retry on 429 with Retry-After header", async () => {
		let calls = 0;
		mockFetch(async () => {
			calls++;
			if (calls === 1) {
				return new Response("Too Many Requests", {
					status: 429,
					headers: { "Retry-After": "0" },
				});
			}
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await client.listItems({ limit: 1 });
		expect(calls).toBe(2);
		expect(items).toHaveLength(1);
	});

	test("clamps oversized Retry-After delays", async () => {
		const delays: number[] = [];
		mockSetTimeoutImmediate(delays);
		let calls = 0;
		mockFetch(async () => {
			calls++;
			if (calls === 1) {
				return new Response("Too Many Requests", {
					status: 429,
					headers: { "Retry-After": "86400" },
				});
			}
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await client.listItems({ limit: 1 });
		expect(calls).toBe(2);
		expect(items).toHaveLength(1);
		expect(delays).toEqual([30_000]);
	});

	test("falls back to exponential backoff when Retry-After is an HTTP-date", async () => {
		const delays: number[] = [];
		mockSetTimeoutImmediate(delays);
		let calls = 0;
		mockFetch(async () => {
			calls++;
			if (calls === 1) {
				return new Response("Too Many Requests", {
					status: 429,
					headers: { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" },
				});
			}
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await client.listItems({ limit: 1 });
		expect(calls).toBe(2);
		expect(items).toHaveLength(1);
		expect(delays).toHaveLength(1);
		expect(delays[0]).toBeGreaterThanOrEqual(1000);
		expect(delays[0]).toBeLessThan(2000);
	});

	test("retry on 500 with exponential backoff", async () => {
		mockSetTimeoutImmediate();
		let calls = 0;
		mockFetch(async () => {
			calls++;
			if (calls < 3) {
				return new Response("Internal Server Error", { status: 500 });
			}
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await client.listItems({ limit: 1 });
		expect(calls).toBe(3);
		expect(items).toHaveLength(1);
	});

	test("gives up after 3 retries on 500", async () => {
		mockSetTimeoutImmediate();
		let calls = 0;
		mockFetch(async () => {
			calls++;
			return new Response("Internal Server Error", { status: 500 });
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		await expect(client.listItems({ limit: 1 })).rejects.toThrow("Zotero API error: 500");
		expect(calls).toBe(4); // initial + 3 retries
	});

	test("does not retry on 400 errors", async () => {
		let calls = 0;
		mockFetch(async () => {
			calls++;
			return new Response("Bad Request", { status: 400 });
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		await expect(client.listItems({ limit: 1 })).rejects.toThrow("Zotero API error: 400");
		expect(calls).toBe(1);
	});

	test("retries item creation POSTs on transient errors", async () => {
		mockSetTimeoutImmediate();
		let calls = 0;
		mockFetch(async () => {
			calls++;
			if (calls === 1) {
				return new Response("Service Unavailable", { status: 503 });
			}

			return new Response(
				JSON.stringify({
					successful: {
						"0": {
							key: "NEWITEM",
							version: 1,
							data: { key: "NEWITEM", version: 1, itemType: "book", title: "A Book" },
						},
					},
					success: { "0": "NEWITEM" },
					unchanged: {},
					failed: {},
				}),
			);
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const result = await client.createItem({ itemType: "book", title: "A Book" });
		expect(result.success?.["0"]).toBe("NEWITEM");
		expect(calls).toBe(2);
	});

	test("createItem sends JSON POST body and parses Zotero write responses", async () => {
		const requests: { url: string; method?: string; headers: Headers; body: unknown }[] = [];
		mockFetch(async (url, init) => {
			requests.push({
				url: url.toString(),
				method: init?.method,
				headers: new Headers(init?.headers),
				body: JSON.parse(init?.body as string),
			});
			return new Response(
				JSON.stringify({
					successful: {
						"0": {
							key: "NEWITEM",
							version: 1,
							data: { key: "NEWITEM", version: 1, itemType: "book", title: "A Book" },
						},
					},
					success: { "0": "NEWITEM" },
					unchanged: {},
					failed: {},
				}),
			);
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const result = await client.createItem({ itemType: "book", title: "A Book" });

		expect(result.successful?.["0"]).toBeDefined();
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://zotero.test/users/123/items");
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.headers.get("Content-Type")).toBe("application/json");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer test");
		expect(requests[0]?.body).toEqual([{ itemType: "book", title: "A Book" }]);
	});

	test("createItem maps invalid write responses to ZoteroApiError", async () => {
		mockFetch(async () => {
			return new Response(JSON.stringify({ unexpected: true }));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});

		try {
			await client.createItem({ itemType: "book", title: "A Book" });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ZoteroApiError);
			expect((err as ZoteroApiError).code).toBe("INVALID_RESPONSE");
			expect((err as ZoteroApiError).message).toContain("Invalid response");
		}
	});

	test("maps API errors to ZoteroApiError with status and requestId", async () => {
		mockFetch(async () => {
			return new Response("Forbidden", {
				status: 403,
				headers: { "Zotero-Request-ID": "req-123" },
			});
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		try {
			await client.listItems({ limit: 1 });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ZoteroApiError);
			expect((err as ZoteroApiError).status).toBe(403);
			expect((err as ZoteroApiError).requestId).toBe("req-123");
			expect((err as ZoteroApiError).message).toContain("Forbidden");
		}
	});

	test("maps invalid JSON response to ZoteroApiError with INVALID_RESPONSE code", async () => {
		mockFetch(async () => {
			return new Response(JSON.stringify({ unexpected: true }));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		try {
			await client.listItems({ limit: 1 });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ZoteroApiError);
			expect((err as ZoteroApiError).code).toBe("INVALID_RESPONSE");
			expect((err as ZoteroApiError).message).toContain("Invalid response");
		}
	});

	test("paginate maps API errors to ZoteroApiError", async () => {
		mockSetTimeoutImmediate();
		mockFetch(async () => {
			return new Response("Server Error", { status: 502 });
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const gen = client.paginate("/items", z.array(z.object({ id: z.number() })));
		await expect(gen.next()).rejects.toThrow("Zotero API error: 502");
	});

	test("paginate maps invalid JSON to ZoteroApiError", async () => {
		mockFetch(async () => {
			return new Response(JSON.stringify({ bad: true }));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const gen = client.paginate("/items", z.array(z.object({ id: z.number() })));
		await expect(gen.next()).rejects.toThrow("Invalid response");
	});

	test("getItem calls correct endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify({ key: "ITEM1", itemType: "book", version: 1 }));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const item = await client.getItem("ITEM1");
		expect(item.key).toBe("ITEM1");
		expect(urls[0]).toBe("https://zotero.test/users/123/items/ITEM1");
	});

	test("getItemChildren calls correct endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		await client.getItemChildren("ITEM1");
		expect(urls[0]).toBe("https://zotero.test/users/123/items/ITEM1/children");
	});

	test("getCollection calls correct endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify({ key: "C1", name: "Papers", version: 1 }));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const col = await client.getCollection("C1");
		expect(col.key).toBe("C1");
		expect(urls[0]).toBe("https://zotero.test/users/123/collections/C1");
	});

	test("listCollectionItems calls correct endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		await client.listCollectionItems("C1", { limit: 5 });
		expect(urls[0]).toBe("https://zotero.test/users/123/collections/C1/items?limit=5");
	});

	test("iterateItems calls paginated items endpoint with filters", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await collectAsync(
			client.iterateItems({
				q: "biology",
				qmode: "everything",
				tag: ["science", "reviewed"],
				itemType: "book",
				limit: 5,
				start: 10,
				sort: "dateModified",
				direction: "desc",
			}),
		);
		expect(items).toHaveLength(1);
		expect(urls[0]).toContain("limit=5");
		expect(urls[0]).toContain("start=10");
		expect(urls[0]).toContain("q=biology");
		expect(urls[0]).toContain("qmode=everything");
		expect(urls[0]).toContain("tag=science%7C%7Creviewed");
		expect(urls[0]).toContain("itemType=book");
		expect(urls[0]).toContain("sort=dateModified");
		expect(urls[0]).toContain("direction=desc");
	});

	test("iterateCollections calls paginated collections endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ key: "C1", name: "Papers", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const collections = await collectAsync(client.iterateCollections({ limit: 5, start: 10 }));
		expect(collections).toHaveLength(1);
		expect(urls[0]).toBe("https://zotero.test/users/123/collections?limit=5&start=10");
	});

	test("iterateCollectionItems calls paginated collection items endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await collectAsync(client.iterateCollectionItems("C1", { limit: 5, start: 10 }));
		expect(items).toHaveLength(1);
		expect(urls[0]).toBe("https://zotero.test/users/123/collections/C1/items?limit=5&start=10");
	});

	test("listTags calls correct endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ tag: "ai" }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const tags = await client.listTags({ limit: 10 });
		expect(tags).toHaveLength(1);
		expect(urls[0]).toBe("https://zotero.test/users/123/tags?limit=10");
	});

	test("iterateTags calls paginated tags endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ tag: "ai" }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const tags = await collectAsync(client.iterateTags({ limit: 5, start: 10 }));
		expect(tags).toHaveLength(1);
		expect(urls[0]).toBe("https://zotero.test/users/123/tags?limit=5&start=10");
	});

	test("searchFulltext calls correct endpoint with qmode=everything", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		await client.searchFulltext("neural nets", { limit: 5 });
		expect(urls[0]).toContain("q=neural+nets");
		expect(urls[0]).toContain("qmode=everything");
		expect(urls[0]).toContain("limit=5");
	});

	test("iterateFulltextSearch calls paginated fulltext search endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([{ key: "ITEM1", itemType: "book", version: 1 }]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const items = await collectAsync(client.iterateFulltextSearch("neural nets", { limit: 5 }));
		expect(items).toHaveLength(1);
		expect(urls[0]).toContain("q=neural+nets");
		expect(urls[0]).toContain("qmode=everything");
		expect(urls[0]).toContain("limit=5");
	});

	test("getItemFulltext calls correct endpoint", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify({ content: "hello", indexedPages: 1, indexedChars: 5 }));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		const ft = await client.getItemFulltext("ITEM1");
		expect(ft.content).toBe("hello");
		expect(urls[0]).toBe("https://zotero.test/users/123/items/ITEM1/fulltext");
	});

	test("ZoteroApiError preserves status, code, and requestId", () => {
		const err = new ZoteroApiError("boom", 503, "RATE_LIMIT", "req-abc");
		expect(err.message).toBe("boom");
		expect(err.status).toBe(503);
		expect(err.code).toBe("RATE_LIMIT");
		expect(err.requestId).toBe("req-abc");
		expect(err.name).toBe("ZoteroApiError");
	});

	test("strips trailing slash from baseUrl", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test/",
		});
		await client.listItems();
		expect(urls[0]).toBe("https://zotero.test/users/123/items");
	});

	test("uses default baseUrl when not provided", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({ apiKey: "test", userId: "123" });
		await client.listItems();
		expect(urls[0]).toStartWith("https://api.zotero.org/users/123/items");
	});

	test("joins multiple tags with ||", async () => {
		const urls: string[] = [];
		mockFetch(async (url) => {
			urls.push(url.toString());
			return new Response(JSON.stringify([]));
		});

		const client = new ZoteroClient({
			apiKey: "test",
			userId: "123",
			baseUrl: "https://zotero.test",
		});
		await client.listItems({ tag: ["ai", "ml"] });
		expect(urls[0]).toContain("tag=ai%7C%7Cml");
	});
});
