import { z } from "zod";
import { ChangeTypeSchema } from "./change-type.js";

export const EffectivenessIndexSchema = z.object({
	url: z.string().url(),
	change_type: ChangeTypeSchema,
	llm_service: z.string().nullable(),

	sample_count: z.number().int().min(0),
	avg_delta: z.number(),
	success_rate: z.number().min(0).max(1),
	best_delta: z.number(),
	worst_delta: z.number(),
	last_updated: z.string().datetime(),
});

export type EffectivenessIndex = z.infer<typeof EffectivenessIndexSchema>;
