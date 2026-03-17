import { z } from "zod";

export const InfoCategorySchema = z.enum([
	"PRODUCT_LIST",
	"PRODUCT_DETAIL",
	"PRICING",
	"FEATURE",
	"AVAILABILITY",
	"CONTACT",
	"POLICY",
	"STAT",
	"COMPARISON",
	"CUSTOM",
]);

export type InfoCategory = z.infer<typeof InfoCategorySchema>;

export const AccuracyLevelSchema = z.enum([
	"exact",
	"approximate",
	"outdated",
	"hallucinated",
	"missing",
]);

export type AccuracyLevel = z.infer<typeof AccuracyLevelSchema>;

export const InfoRecognitionPerLLMSchema = z.object({
	llm_service: z.string(),
	recognized: z.boolean(),
	llm_answer: z.string().nullable(),
	accuracy: AccuracyLevelSchema,
	detail: z.string().nullable(),
});

export type InfoRecognitionPerLLM = z.infer<typeof InfoRecognitionPerLLMSchema>;

export const InfoRecognitionItemSchema = z.object({
	info_id: z.string().uuid(),
	category: InfoCategorySchema,
	label: z.string(),
	expected_value: z.string(),
	llm_results: z.array(InfoRecognitionPerLLMSchema),
});

export type InfoRecognitionItem = z.infer<typeof InfoRecognitionItemSchema>;

export const InfoRecognitionScoreSchema = z.object({
	overall: z.number().min(0).max(100),
	items: z.array(InfoRecognitionItemSchema),
	coverage_rate: z.number().min(0).max(1),
	accuracy_rate: z.number().min(0).max(1),
});

export type InfoRecognitionScore = z.infer<typeof InfoRecognitionScoreSchema>;
