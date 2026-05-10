#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

/**
 * Cross-platform binary builder.
 * Produces compiled binaries for all supported targets + SHA256SUMS.
 */

const targets = [
	{ target: "bun-darwin-arm64", outfile: "zotero-mcp-darwin-arm64" },
	{ target: "bun-darwin-x64", outfile: "zotero-mcp-darwin-x64" },
	{ target: "bun-linux-x64", outfile: "zotero-mcp-linux-x64" },
	{ target: "bun-linux-arm64", outfile: "zotero-mcp-linux-arm64" },
	{ target: "bun-windows-x64", outfile: "zotero-mcp-windows-x64.exe" },
];

const distDir = join(import.meta.dir, "..", "dist");

async function sha256(filePath: string): Promise<string> {
	const data = readFileSync(filePath);
	return createHash("sha256").update(data).digest("hex");
}

let checksums = "";

for (const { target, outfile } of targets) {
	const outPath = join(distDir, outfile);
	console.error(`Building ${target} → ${outfile} ...`);
	await $`bun build --compile --minify --sourcemap --target ${target} src/index.ts --outfile ${outPath}`;
	const sum = await sha256(outPath);
	checksums += `${sum}  ${outfile}\n`;
	console.error(`  ✓ ${outfile} (${sum.slice(0, 16)}...)`);
}

const sumsPath = join(distDir, "SHA256SUMS");
writeFileSync(sumsPath, checksums);
console.error(`\nWrote ${sumsPath}`);
