import { z } from "zod";
import { GeoScoreSchema } from "./geo-score.js";
import { LLMProbeSchema } from "./llm-probe.js";

export const ContentSnapshotSchema = z.object({
	snapshot_id: z.string().uuid(),
	url: z.string().url(),
	target_id: z.string().uuid(),
	captured_at: z.string().datetime(),
	html_hash: z.string(),
	content_text: z.string(),
	structured_data: z.record(z.string(), z.unknown()),
	geo_score: GeoScoreSchema.optional(),
	llm_responses: z.array(LLMProbeSchema).default([]),
});

export type ContentSnapshot = z.infer<typeof ContentSnapshotSchema>;
