import { z } from "zod";
import { VerdictSchema } from "./change-impact.js";

export const SemanticChangeRecordSchema = z.object({
	change_id: z.string().uuid(),
	embedding: z.array(z.number()),
	change_summary: z.string(),
	impact_verdict: VerdictSchema,
	delta: z.number(),
	lesson: z.string(),
});

export type SemanticChangeRecord = z.infer<typeof SemanticChangeRecordSchema>;
