import { z } from "zod";

export const ChangeTypeSchema = z.enum([
	"CONTENT_DENSITY",
	"SEMANTIC_STRUCTURE",
	"SCHEMA_MARKUP",
	"LLMS_TXT",
	"FAQ_ADDITION",
	"AUTHORITY_SIGNAL",
	"METADATA",
	"CONTENT_CHUNKING",
	"READABILITY_FIX",
	"EXTERNAL",
]);

export type ChangeType = z.infer<typeof ChangeTypeSchema>;
