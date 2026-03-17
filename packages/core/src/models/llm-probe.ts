import { z } from "zod";
import { InfoRecognitionPerLLMSchema } from "./info-recognition.js";

export const QueryTypeSchema = z.enum([
	"citation_test",
	"accuracy_test",
	"info_recognition",
	"sentiment_test",
	"competitor_compare",
]);

export type QueryType = z.infer<typeof QueryTypeSchema>;

export const LLMProbeSchema = z.object({
	probe_id: z.string().uuid(),
	llm_service: z.string(),
	model_version: z.string(),
	query: z.string(),
	query_type: QueryTypeSchema,
	response_text: z.string(),
	response_at: z.string().datetime(),

	// Analysis results
	cited: z.boolean(),
	citation_excerpt: z.string().nullable(),
	citation_position: z.number().int().nullable(),
	accuracy_vs_source: z.number().min(0).max(1),
	info_items_checked: z.array(InfoRecognitionPerLLMSchema),
});

export type LLMProbe = z.infer<typeof LLMProbeSchema>;
