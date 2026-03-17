import { z } from "zod";

export const VerdictSchema = z.enum(["positive", "negative", "neutral"]);

export type Verdict = z.infer<typeof VerdictSchema>;

export const ChangeImpactSchema = z.object({
	change_id: z.string().uuid(),
	measured_at: z.string().datetime(),
	score_before: z.number().min(0).max(100),
	score_after: z.number().min(0).max(100),
	delta: z.number(),
	delta_pct: z.number(),
	per_llm_impact: z.record(z.string(), z.number()),
	confidence: z.number().min(0).max(1),
	confounders: z.array(z.string()),
	verdict: VerdictSchema,
});

export type ChangeImpact = z.infer<typeof ChangeImpactSchema>;
