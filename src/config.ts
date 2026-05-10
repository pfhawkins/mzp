import { logger } from "./logger.js";

export type Config = {
	apiKey: string;
	userId?: string;
	groupId?: string;
	baseUrl?: string;
};

export function loadConfig(): Config {
	const apiKey = process.env.ZOTERO_API_KEY?.trim();
	const userId = process.env.ZOTERO_USER_ID?.trim();
	const groupId = process.env.ZOTERO_GROUP_ID?.trim();
	const baseUrl = process.env.ZOTERO_BASE_URL?.trim();

	const missing: string[] = [];
	if (!apiKey) missing.push("ZOTERO_API_KEY");
	if (!userId && !groupId) {
		missing.push("ZOTERO_USER_ID or ZOTERO_GROUP_ID");
	}
	if (userId && groupId) {
		throw new Error(
			"Configuration error: exactly one of ZOTERO_USER_ID or ZOTERO_GROUP_ID must be set, but both are provided.",
		);
	}

	if (missing.length > 0) {
		throw new Error(
			`Configuration error: missing required environment variable(s): ${missing.join(", ")}\n\n` +
				`Required env vars:\n` +
				`  ZOTERO_API_KEY       Your Zotero API key\n` +
				`  ZOTERO_USER_ID       Your Zotero user ID (or use ZOTERO_GROUP_ID)\n` +
				`  ZOTERO_GROUP_ID      Your Zotero group ID (or use ZOTERO_USER_ID)\n\n` +
				`Optional env vars:\n` +
				`  ZOTERO_BASE_URL      API base URL (default: https://api.zotero.org)\n` +
				`  LOG_LEVEL            Log level: debug, info, warn, error (default: info)`,
		);
	}

	logger.debug("Configuration loaded successfully");
	return { apiKey: apiKey as string, userId, groupId, baseUrl };
}
