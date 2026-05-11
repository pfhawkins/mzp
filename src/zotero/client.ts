import { z } from "zod";
import {
	zoteroCollectionSchema,
	zoteroFulltextSchema,
	zoteroItemSchema,
	zoteroTagResponseSchema,
	zoteroWriteResponseSchema,
} from "./schemas.js";

function retryDelayMs(attempt: number, retryAfter: string | null): number {
	if (retryAfter) {
		const retryAfterSeconds = Number(retryAfter);
		if (Number.isFinite(retryAfterSeconds)) return retryAfterSeconds * 1000;
	}

	return Math.min(1000 * 2 ** attempt, 10000) + Math.random() * 1000;
}

function linkHeaderUrlForRel(linkHeader: string | null, rel: string): string | undefined {
	if (!linkHeader) return undefined;

	for (const link of linkHeader.split(",")) {
		const [urlPart, ...paramParts] = link.split(";");
		const urlMatch = urlPart?.trim().match(/^<(.+)>$/);
		if (!urlMatch) continue;

		for (const param of paramParts) {
			const relMatch = param.trim().match(/^rel="?([^"]+)"?$/);
			if (!relMatch) continue;
			const rels = relMatch[1]?.split(/\s+/) ?? [];
			if (rels.includes(rel)) return urlMatch[1];
		}
	}

	return undefined;
}

export class ZoteroApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
		public requestId?: string,
	) {
		super(message);
		this.name = "ZoteroApiError";
	}
}

export type ZoteroClientOptions = {
	apiKey: string;
	userId?: string;
	groupId?: string;
	baseUrl?: string;
};

export class ZoteroClient {
	private baseUrl: string;
	private apiKey: string;
	private libraryPath: string;

	constructor(opts: ZoteroClientOptions) {
		if (opts.userId && opts.groupId) {
			throw new Error("Exactly one of userId or groupId must be provided");
		}
		if (opts.userId) {
			this.baseUrl = opts.baseUrl?.replace(/\/$/, "") ?? "https://api.zotero.org";
			this.apiKey = opts.apiKey;
			this.libraryPath = `/users/${opts.userId}`;
		} else if (opts.groupId) {
			this.baseUrl = opts.baseUrl?.replace(/\/$/, "") ?? "https://api.zotero.org";
			this.apiKey = opts.apiKey;
			this.libraryPath = `/groups/${opts.groupId}`;
		} else {
			throw new Error("Exactly one of userId or groupId must be provided");
		}
	}

	private fetchOnce(url: string, init?: RequestInit): Promise<Response> {
		return fetch(url, {
			...init,
			headers: {
				"Zotero-API-Version": "3",
				Authorization: `Bearer ${this.apiKey}`,
				...(init?.headers ?? {}),
			},
		});
	}

	private async fetchWithRetry(url: string, init?: RequestInit, attempt = 0): Promise<Response> {
		const res = await this.fetchOnce(url, init);

		if ((res.status === 429 || res.status >= 500) && attempt < 3) {
			const retryAfter = res.headers.get("Retry-After");
			const delay = retryDelayMs(attempt, retryAfter);
			await new Promise((r) => setTimeout(r, delay));
			return this.fetchWithRetry(url, init, attempt + 1);
		}

		return res;
	}

	private async request<T>(
		path: string,
		schema: z.ZodType<T>,
		opts?: { params?: Record<string, string | number | undefined>; init?: RequestInit },
	): Promise<T> {
		const url = new URL(`${this.baseUrl}${this.libraryPath}${path}`);
		if (opts?.params) {
			for (const [k, v] of Object.entries(opts.params)) {
				if (v !== undefined) url.searchParams.set(k, String(v));
			}
		}

		const res = await this.fetchWithRetry(url.toString(), opts?.init);

		if (!res.ok) {
			const text = await res.text().catch(() => "Unknown error");
			throw new ZoteroApiError(
				`Zotero API error: ${res.status} ${text}`,
				res.status,
				undefined,
				res.headers.get("Zotero-Request-ID") ?? undefined,
			);
		}

		const json = await res.json();
		const parsed = schema.safeParse(json);
		if (!parsed.success) {
			throw new ZoteroApiError(
				`Invalid response from Zotero API: ${parsed.error.message}`,
				res.status,
				"INVALID_RESPONSE",
				res.headers.get("Zotero-Request-ID") ?? undefined,
			);
		}
		return parsed.data;
	}

	async *paginate<T>(
		path: string,
		schema: z.ZodType<T[]>,
		opts?: { params?: Record<string, string | number | undefined>; limit?: number },
	): AsyncGenerator<T> {
		const limit = opts?.limit ?? 25;
		const requestUrl = `${this.baseUrl}${this.libraryPath}${path}`;
		let nextUrl: string | undefined;

		while (true) {
			const url = nextUrl ? new URL(nextUrl, requestUrl) : new URL(requestUrl);
			if (!nextUrl) {
				url.searchParams.set("limit", String(limit));
				if (!opts?.params || opts.params.start === undefined) {
					url.searchParams.set("start", "0");
				}
				if (opts?.params) {
					for (const [k, v] of Object.entries(opts.params)) {
						if (v !== undefined) url.searchParams.set(k, String(v));
					}
				}
			}

			const res = await this.fetchWithRetry(url.toString());
			if (!res.ok) {
				const text = await res.text().catch(() => "Unknown error");
				throw new ZoteroApiError(
					`Zotero API error: ${res.status} ${text}`,
					res.status,
					undefined,
					res.headers.get("Zotero-Request-ID") ?? undefined,
				);
			}

			const json = await res.json();
			const parsed = schema.safeParse(json);
			if (!parsed.success) {
				throw new ZoteroApiError(
					`Invalid response from Zotero API: ${parsed.error.message}`,
					res.status,
					"INVALID_RESPONSE",
					res.headers.get("Zotero-Request-ID") ?? undefined,
				);
			}

			for (const item of parsed.data) {
				yield item;
			}

			const linkHeader = res.headers.get("Link") ?? "";
			nextUrl = linkHeaderUrlForRel(linkHeader, "next");
			if (!nextUrl || parsed.data.length === 0) break;
		}
	}

	listItems(opts?: {
		q?: string;
		qmode?: string;
		tag?: string | string[];
		itemType?: string;
		collection?: string;
		limit?: number;
		start?: number;
		sort?: string;
		direction?: "asc" | "desc";
	}) {
		const params: Record<string, string | number | undefined> = {
			q: opts?.q,
			qmode: opts?.qmode,
			itemType: opts?.itemType,
			collection: opts?.collection,
			limit: opts?.limit,
			start: opts?.start,
			sort: opts?.sort,
			direction: opts?.direction,
		};
		if (opts?.tag) {
			params.tag = Array.isArray(opts.tag) ? opts.tag.join("||") : opts.tag;
		}
		return this.request("/items", z.array(zoteroItemSchema), { params });
	}

	getItem(itemKey: string) {
		return this.request(`/items/${itemKey}`, zoteroItemSchema);
	}

	getItemChildren(itemKey: string) {
		return this.request(`/items/${itemKey}/children`, z.array(zoteroItemSchema));
	}

	listCollections(opts?: { limit?: number; start?: number }) {
		return this.request("/collections", z.array(zoteroCollectionSchema), {
			params: { limit: opts?.limit, start: opts?.start },
		});
	}

	getCollection(collectionKey: string) {
		return this.request(`/collections/${collectionKey}`, zoteroCollectionSchema);
	}

	listCollectionItems(collectionKey: string, opts?: { limit?: number; start?: number }) {
		return this.request(`/collections/${collectionKey}/items`, z.array(zoteroItemSchema), {
			params: { limit: opts?.limit, start: opts?.start },
		});
	}

	listTags(opts?: { limit?: number; start?: number }) {
		return this.request("/tags", z.array(zoteroTagResponseSchema), {
			params: { limit: opts?.limit, start: opts?.start },
		});
	}

	searchFulltext(q: string, opts?: { limit?: number; start?: number }) {
		return this.request("/items", z.array(zoteroItemSchema), {
			params: {
				q,
				qmode: "everything",
				limit: opts?.limit,
				start: opts?.start,
			},
		});
	}

	getItemFulltext(itemKey: string) {
		return this.request(`/items/${itemKey}/fulltext`, zoteroFulltextSchema);
	}

	async createItem(itemData: object) {
		return this.request("/items", zoteroWriteResponseSchema, {
			init: {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify([itemData]),
			},
		});
	}
}
