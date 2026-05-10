import { z } from "zod";

export const zoteroCreatorSchema = z
	.object({
		creatorType: z.string(),
		firstName: z.string().optional(),
		lastName: z.string().optional(),
		name: z.string().optional(),
	})
	.passthrough();

export const zoteroTagSchema = z
	.object({
		tag: z.string(),
		type: z.number().optional(),
	})
	.passthrough();

const zoteroItemDataSchema = z
	.object({
		key: z.string(),
		version: z.number(),
		itemType: z.string(),
		title: z.string().optional(),
		creators: z.array(zoteroCreatorSchema).optional(),
		abstractNote: z.string().optional(),
		tags: z.array(zoteroTagSchema).optional(),
		collections: z.array(z.string()).optional(),
		date: z.string().optional(),
		url: z.string().optional(),
		relations: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const zoteroItemEnvelopeSchema = z
	.object({
		data: zoteroItemDataSchema,
	})
	.passthrough()
	.transform(({ data, ...envelope }) => ({ ...envelope, ...data }));

export const zoteroItemSchema = z.union([zoteroItemDataSchema, zoteroItemEnvelopeSchema]);

const zoteroCollectionDataSchema = z
	.object({
		key: z.string(),
		version: z.number(),
		name: z.string(),
		parentCollection: z.union([z.string(), z.boolean()]).optional(),
		relations: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const zoteroCollectionEnvelopeSchema = z
	.object({
		data: zoteroCollectionDataSchema,
	})
	.passthrough()
	.transform(({ data, ...envelope }) => ({ ...envelope, ...data }));

export const zoteroCollectionSchema = z.union([
	zoteroCollectionDataSchema,
	zoteroCollectionEnvelopeSchema,
]);

export const zoteroTagResponseSchema = z
	.object({
		tag: z.string(),
		url: z.string().optional(),
		links: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export const zoteroFulltextSchema = z
	.object({
		content: z.string().optional(),
		indexedPages: z.number().optional(),
		indexedChars: z.number().optional(),
	})
	.passthrough();
