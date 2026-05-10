export type Config = {
	apiKey: string;
	userId?: string;
	groupId?: string;
	baseUrl?: string;
};

export function loadConfig(): Config {
	const apiKey = process.env.ZOTERO_API_KEY;
	const userId = process.env.ZOTERO_USER_ID;
	const groupId = process.env.ZOTERO_GROUP_ID;
	const baseUrl = process.env.ZOTERO_BASE_URL;

	if (!apiKey) {
		throw new Error("Missing required environment variable: ZOTERO_API_KEY");
	}
	if (!userId && !groupId) {
		throw new Error("Exactly one of ZOTERO_USER_ID or ZOTERO_GROUP_ID must be set");
	}
	if (userId && groupId) {
		throw new Error("Exactly one of ZOTERO_USER_ID or ZOTERO_GROUP_ID must be set");
	}

	return { apiKey, userId, groupId, baseUrl };
}
