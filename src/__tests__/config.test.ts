import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
	const originalApiKey = process.env.ZOTERO_API_KEY;
	const originalUserId = process.env.ZOTERO_USER_ID;
	const originalGroupId = process.env.ZOTERO_GROUP_ID;
	const originalBaseUrl = process.env.ZOTERO_BASE_URL;

	afterEach(() => {
		process.env.ZOTERO_API_KEY = originalApiKey;
		process.env.ZOTERO_USER_ID = originalUserId;
		process.env.ZOTERO_GROUP_ID = originalGroupId;
		process.env.ZOTERO_BASE_URL = originalBaseUrl;
	});

	test("throws when ZOTERO_API_KEY is missing", () => {
		delete process.env.ZOTERO_API_KEY;
		delete process.env.ZOTERO_USER_ID;
		delete process.env.ZOTERO_GROUP_ID;
		expect(() => loadConfig()).toThrow("ZOTERO_API_KEY");
	});

	test("throws when neither userId nor groupId is set", () => {
		process.env.ZOTERO_API_KEY = "test";
		delete process.env.ZOTERO_USER_ID;
		delete process.env.ZOTERO_GROUP_ID;
		expect(() => loadConfig()).toThrow("ZOTERO_USER_ID or ZOTERO_GROUP_ID");
	});

	test("throws when both userId and groupId are set", () => {
		process.env.ZOTERO_API_KEY = "test";
		process.env.ZOTERO_USER_ID = "123";
		process.env.ZOTERO_GROUP_ID = "456";
		expect(() => loadConfig()).toThrow("exactly one");
	});

	test("returns config with userId", () => {
		process.env.ZOTERO_API_KEY = "test";
		process.env.ZOTERO_USER_ID = "123";
		delete process.env.ZOTERO_GROUP_ID;
		const config = loadConfig();
		expect(config.apiKey).toBe("test");
		expect(config.userId).toBe("123");
		expect(config.groupId).toBeUndefined();
	});

	test("returns config with groupId", () => {
		process.env.ZOTERO_API_KEY = "test";
		process.env.ZOTERO_GROUP_ID = "456";
		delete process.env.ZOTERO_USER_ID;
		const config = loadConfig();
		expect(config.apiKey).toBe("test");
		expect(config.groupId).toBe("456");
		expect(config.userId).toBeUndefined();
	});

	test("trims whitespace from env vars", () => {
		process.env.ZOTERO_API_KEY = "  test  ";
		process.env.ZOTERO_USER_ID = "  123  ";
		delete process.env.ZOTERO_GROUP_ID;
		const config = loadConfig();
		expect(config.apiKey).toBe("test");
		expect(config.userId).toBe("123");
	});

	test("includes baseUrl when set", () => {
		process.env.ZOTERO_API_KEY = "test";
		process.env.ZOTERO_USER_ID = "123";
		process.env.ZOTERO_BASE_URL = "https://custom.zotero.org";
		delete process.env.ZOTERO_GROUP_ID;
		const config = loadConfig();
		expect(config.baseUrl).toBe("https://custom.zotero.org");
	});
});
