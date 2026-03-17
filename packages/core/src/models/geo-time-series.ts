import { z } from "zod";

export const GeoTimeSeriesSchema = z.object({
	url: z.string().url(),
	llm_service: z.string(),
	measured_at: z.string().datetime(),
	geo_score: z.number().min(0).max(100),
	citation_rate: z.number().min(0).max(1),
	citation_rank: z.number().int().positive().nullable(),
	change_id: z.string().uuid().nullable(),
	delta_score: z.number(),
});

export type GeoTimeSeries = z.infer<typeof GeoTimeSeriesSchema>;
