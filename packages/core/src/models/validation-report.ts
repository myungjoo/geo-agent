import { z } from "zod";
import { GeoScoreSchema } from "./geo-score.js";
import { LLMProbeSchema } from "./llm-probe.js";
import {
	InfoRecognitionScoreSchema,
	InfoRecognitionPerLLMSchema,
} from "./info-recognition.js";

export const ValidationLLMResultSchema = z.object({
	llm_service: z.string(),
	probes: z.array(LLMProbeSchema),
	citation_rate: z.number().min(0).max(1),
	citation_accuracy: z.number().min(0).max(1),
	rank_position_avg: z.number().nullable(),
	info_recognition: z.array(InfoRecognitionPerLLMSchema),
	delta_vs_before: z.number(),
});

export type ValidationLLMResult = z.infer<typeof ValidationLLMResultSchema>;

export const ValidationReportSchema = z.object({
	report_id: z.string().uuid(),
	target_id: z.string().uuid(),
	plan_ref: z.string().uuid().nullable(),
	validated_at: z.string().datetime(),

	score_before: GeoScoreSchema,
	score_after: GeoScoreSchema,
	score_delta: z.number(),

	llm_results: z.array(ValidationLLMResultSchema),

	info_recognition: InfoRecognitionScoreSchema,

	verdict: z.enum(["improved", "unchanged", "degraded"]),
	summary: z.string(),

	recommendations: z.array(z.string()),
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;
