import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BINARY_NAME = process.platform === "win32" ? "zotero-mcp.exe" : "zotero-mcp";
const ZOTERO_SERVER_SCRIPT = `
const json = (body) =>
	new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const port = Number.parseInt(process.env.ZOTERO_TEST_PORT ?? "", 10);
if (!Number.isInteger(port) || port <= 0) {
	throw new Error("ZOTERO_TEST_PORT must be set to a concrete port");
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/users/123/items" && req.method === "GET") {
			return json([
				{
					key: "ITEM1",
					version: 1,
					data: {
						key: "ITEM1",
						version: 1,
						itemType: "journalArticle",
						title: "Integration Test Article",
						creators: [{ creatorType: "author", firstName: "Test", lastName: "Author" }],
						tags: [{ tag: "integration" }],
						date: "2024-01-01",
					},
				},
			]);
		}

		if (url.pathname === "/users/123/collections") {
			return json([
				{
					key: "COLL1",
					version: 1,
					data: { key: "COLL1", version: 1, name: "Test Collection" },
				},
			]);
		}

		if (url.pathname === "/users/123/tags") {
			return json([{ tag: "integration" }]);
		}

		if (url.pathname === "/users/123/items" && req.method === "POST") {
			const body = await req.json();
			const item = body[0];
			return json({
				successful: {
					"0": {
						key: "NEWITEM",
						version: 1,
						data: {
							key: "NEWITEM",
							version: 1,
							...item,
						},
					},
				},
				success: { "0": "NEWITEM" },
				unchanged: {},
				failed: {},
			});
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(server.url.origin);
process.on("SIGTERM", () => {
	server.stop();
	process.exit(0);
});
`;

function zoteroFixturePort(attempt: number): number {
	const min = 49_152;
	const max = 65_535;
	const span = max - min + 1;
	const seed = process.pid + Date.now();

	return min + ((seed + attempt * 997) % span);
}

async function startZoteroServerFixture(): Promise<{
	proc: ReturnType<typeof spawn>;
	url: string;
}> {
	const errors: string[] = [];

	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const port = zoteroFixturePort(attempt);
		const proc = spawn(process.execPath, ["--eval", ZOTERO_SERVER_SCRIPT], {
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				ZOTERO_TEST_PORT: String(port),
			},
		});

		try {
			const url = await readStartupLine(proc, "Zotero test server");
			return { proc, url };
		} catch (err) {
			proc.kill();
			errors.push(err instanceof Error ? err.message : String(err));
		}
	}

	throw new Error(`Zotero test server failed to start after 5 attempts:\n${errors.join("\n")}`);
}

async function sendJson(proc: ReturnType<typeof spawn> | undefined, obj: unknown): Promise<void> {
	if (!proc) throw new Error("MCP process was not started");
	return new Promise((resolve, reject) => {
		const ok = proc.stdin?.write(`${JSON.stringify(obj)}\n`);
		if (ok) {
			resolve();
		} else {
			proc.stdin?.once("drain", resolve);
			proc.stdin?.once("error", reject);
		}
	});
}

async function readStartupLine(proc: ReturnType<typeof spawn>, label: string): Promise<string> {
	if (!proc.stdout) throw new Error(`${label} stdout was not piped`);

	let stdout = "";
	let stderr = "";

	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout?.off("data", onStdout);
			proc.stderr?.off("data", onStderr);
			proc.off("exit", onExit);
			proc.off("error", onError);
		};
		const fail = (message: string) => {
			cleanup();
			reject(new Error(stderr ? `${label} ${message}: ${stderr.trim()}` : `${label} ${message}`));
		};
		const onStdout = (chunk: Buffer) => {
			stdout += chunk.toString();
			const newlineIndex = stdout.indexOf("\n");
			if (newlineIndex === -1) return;
			cleanup();
			resolve(stdout.slice(0, newlineIndex).trim());
		};
		const onStderr = (chunk: Buffer) => {
			stderr += chunk.toString();
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			fail(`exited before startup (${code ?? signal ?? "unknown"})`);
		};
		const onError = (err: Error) => {
			fail(`failed to start: ${err.message}`);
		};
		timer = setTimeout(() => fail("did not report a URL within 5s"), 5000);

		proc.stdout?.on("data", onStdout);
		proc.stderr?.on("data", onStderr);
		proc.once("exit", onExit);
		proc.once("error", onError);
	});
}

describe("MCP protocol integration", () => {
	let zoteroServer: ReturnType<typeof spawn> | undefined;
	let zoteroBaseUrl: string | undefined;
	let proc: ReturnType<typeof spawn> | undefined;
	let responseIter: AsyncIterator<string> | undefined;
	let buildDir: string | undefined;

	beforeAll(async () => {
		buildDir = await mkdtemp(join(tmpdir(), "zotero-mcp-test-"));
		const binaryPath = join(buildDir, BINARY_NAME);
		await Bun.$`bun build --compile --minify --sourcemap src/index.ts --outfile ${binaryPath}`;

		const zoteroFixture = await startZoteroServerFixture();
		zoteroServer = zoteroFixture.proc;
		zoteroBaseUrl = zoteroFixture.url;

		proc = spawn(binaryPath, [], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				ZOTERO_API_KEY: "test-key",
				ZOTERO_USER_ID: "123",
				ZOTERO_BASE_URL: zoteroBaseUrl,
				LOG_LEVEL: "error",
			},
		});

		const rl = createInterface({ input: proc.stdout ?? process.stdout });
		responseIter = rl[Symbol.asyncIterator]();
	});

	afterAll(async () => {
		proc?.stdin?.end();
		proc?.kill();
		zoteroServer?.kill();
		if (buildDir) {
			await rm(buildDir, { recursive: true, force: true });
		}
	});

	async function nextResponse(): Promise<unknown> {
		if (!responseIter) throw new Error("MCP process was not started");
		const { value } = await responseIter.next();
		if (typeof value !== "string") throw new Error("Expected string response");
		return JSON.parse(value);
	}

	test("initialize handshake", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test-client", version: "1.0.0" },
			},
		});

		const res = await nextResponse();
		expect(res).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: "2024-11-05",
				serverInfo: { name: "zotero-mcp" },
			},
		});

		await sendJson(proc, {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
	});

	test("tools/list returns all tools", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		});

		const res = (await nextResponse()) as {
			jsonrpc: string;
			id: number;
			result: { tools: Array<{ name: string }> };
		};

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(2);
		const toolNames = res.result.tools.map((t) => t.name);
		expect(toolNames).toContain("zotero_search");
		expect(toolNames).toContain("zotero_get_item");
		expect(toolNames).toContain("zotero_list_collections");
		expect(toolNames).toContain("zotero_list_tags");
		expect(toolNames).toContain("zotero_get_fulltext");
		expect(toolNames).toContain("zotero_recent");
		expect(toolNames).toContain("zotero_get_item_children");
		expect(toolNames).toContain("zotero_get_collection_items");
		expect(toolNames).toContain("zotero_create_item");
	});

	test("tools/call zotero_search returns results", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {
				name: "zotero_search",
				arguments: { query: "integration" },
			},
		});

		const res = (await nextResponse()) as {
			jsonrpc: string;
			id: number;
			result: { content: Array<{ type: string; text: string }>; isError?: boolean };
		};

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(3);
		expect(res.result.isError).toBeUndefined();
		expect(res.result.content[0]?.text).toContain("Integration Test Article");
		expect(res.result.content[0]?.text).toContain("ITEM1");
	});

	test("tools/call zotero_list_collections returns results", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: {
				name: "zotero_list_collections",
				arguments: {},
			},
		});

		const res = (await nextResponse()) as {
			jsonrpc: string;
			id: number;
			result: { content: Array<{ type: string; text: string }>; isError?: boolean };
		};

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(4);
		expect(res.result.isError).toBeUndefined();
		expect(res.result.content[0]?.text).toContain("Test Collection");
		expect(res.result.content[0]?.text).toContain("COLL1");
	});

	test("tools/call with unknown tool returns error", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: {
				name: "zotero_nonexistent",
				arguments: {},
			},
		});

		const res = (await nextResponse()) as {
			jsonrpc: string;
			id: number;
			error?: { code: number; message: string };
		};

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(5);
		expect(res.error).toBeDefined();
		expect(res.error?.message).toContain("Unknown tool");
	});

	test("tools/call zotero_create_item creates an item", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 7,
			method: "tools/call",
			params: {
				name: "zotero_create_item",
				arguments: {
					itemType: "journalArticle",
					title: "Test Creation",
					creators: [{ creatorType: "author", firstName: "Test", lastName: "Creator" }],
				},
			},
		});

		const res = (await nextResponse()) as {
			jsonrpc: string;
			id: number;
			result: { content: Array<{ type: string; text: string }>; isError?: boolean };
		};

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(7);
		expect(res.result.isError).toBeUndefined();
		expect(res.result.content[0]?.text).toContain("NEWITEM");
	});

	test("resources/templates/list returns templates", async () => {
		await sendJson(proc, {
			jsonrpc: "2.0",
			id: 6,
			method: "resources/templates/list",
			params: {},
		});

		const res = (await nextResponse()) as {
			jsonrpc: string;
			id: number;
			result?: { resourceTemplates: Array<{ uriTemplate: string }> };
		};

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(6);
		expect(res.result).toBeDefined();
		const templates = res.result?.resourceTemplates ?? [];
		expect(templates.some((t) => t.uriTemplate === "zotero://item/{key}")).toBe(true);
		expect(templates.some((t) => t.uriTemplate === "zotero://collection/{key}")).toBe(true);
	});
});
