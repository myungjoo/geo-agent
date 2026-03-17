import { z } from "zod";
import { InfoRecognitionScoreSchema } from "./info-recognition.js";

export const GeoScorePerLLMSchema = z.object({
	llm_service: z.string(),
	citation_rate: z.number().min(0).max(100),
	citation_accuracy: z.number().min(0).max(100),
	rank_position: z.number().int().nullable(),
	info_recognition: InfoRecognitionScoreSchema.optional(),
});

export type GeoScorePerLLM = z.infer<typeof GeoScorePerLLMSchema>;

export const GeoScoreSchema = z.object({
	total: z.number().min(0).max(100),

	// Sub-metrics (each 0-100)
	citation_rate: z.number().min(0).max(100), // weight 25%
	citation_accuracy: z.number().min(0).max(100), // weight 20%
	info_recognition_score: z.number().min(0).max(100), // weight 20%
	coverage: z.number().min(0).max(100), // weight 15%
	rank_position: z.number().min(0).max(100), // weight 10%
	structured_score: z.number().min(0).max(100), // weight 10%

	// Information Recognition detail
	info_recognition: InfoRecognitionScoreSchema.optional(),

	// Meta
	measured_at: z.string().datetime(),
	llm_breakdown: z.record(z.string(), GeoScorePerLLMSchema),
});

export type GeoScore = z.infer<typeof GeoScoreSchema>;

/** GEO Score weight configuration */
export const GEO_SCORE_WEIGHTS = {
	citation_rate: 0.25,
	citation_accuracy: 0.2,
	info_recognition_score: 0.2,
	coverage: 0.15,
	rank_position: 0.1,
	structured_score: 0.1,
} as const;
