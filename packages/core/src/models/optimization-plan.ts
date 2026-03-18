import { z } from "zod";
import { ChangeTypeSchema } from "./change-type.js";
import { EffectivenessIndexSchema } from "./effectiveness-index.js";
import { SemanticChangeRecordSchema } from "./semantic-change-record.js";

export const OptimizationTaskSchema = z.object({
	task_id: z.string().uuid(),
	order: z.number().int().min(0),
	change_type: ChangeTypeSchema,
	title: z.string(),
	description: z.string(),
	target_element: z.string().nullable(),
	priority: z.enum(["critical", "high", "medium", "low"]),

	info_recognition_ref: z.string().nullable(),

	status: z.enum(["pending", "in_progress", "completed", "skipped", "failed"]),
	change_record_ref: z.string().uuid().nullable(),
});

export type OptimizationTask = z.infer<typeof OptimizationTaskSchema>;

export const OptimizationPlanSchema = z.object({
	plan_id: z.string().uuid(),
	target_id: z.string().uuid(),
	created_at: z.string().datetime(),
	analysis_report_ref: z.string().uuid(),

	strategy_rationale: z.string(),
	memory_context: z.object({
		effectiveness_data: z.array(EffectivenessIndexSchema),
		similar_cases: z.array(SemanticChangeRecordSchema),
		negative_patterns: z.array(z.string()),
	}),

	tasks: z.array(OptimizationTaskSchema),

	estimated_impact: z.object({
		expected_delta: z.number(),
		confidence: z.number().min(0).max(1),
		rationale: z.string(),
	}),

	status: z.enum(["draft", "approved", "executing", "completed", "cancelled"]),
});

export type OptimizationPlan = z.infer<typeof OptimizationPlanSchema>;
