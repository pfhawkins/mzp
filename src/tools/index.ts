import type { ZoteroClient } from "../zotero/client.js";
import * as createItem from "./createItem.js";
import * as getCollectionItems from "./getCollectionItems.js";
import * as getFulltext from "./getFulltext.js";
import * as getItem from "./getItem.js";
import * as getItemChildren from "./getItemChildren.js";
import * as listCollections from "./listCollections.js";
import * as listTags from "./listTags.js";
import * as recent from "./recent.js";
import * as search from "./search.js";

export type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: object;
	handler: (
		client: ZoteroClient,
		args: unknown,
	) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}>;
};

export const tools: ToolDefinition[] = [
	search,
	getItem,
	getItemChildren,
	listCollections,
	getCollectionItems,
	listTags,
	getFulltext,
	recent,
	createItem,
];
