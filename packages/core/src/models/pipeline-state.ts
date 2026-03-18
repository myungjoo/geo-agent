import { z } from "zod";

export const PipelineStageSchema = z.enum([
	"INIT",
	"ANALYZING",
	"CLONING",
	"STRATEGIZING",
	"OPTIMIZING",
	"VALIDATING",
	"REPORTING",
	"COMPLETED",
	"FAILED",
	"PARTIAL_FAILURE",
]);

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const PipelineStateSchema = z.object({
	pipeline_id: z.string().uuid(),
	target_id: z.string().uuid(),
	stage: PipelineStageSchema,
	started_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	completed_at: z.string().datetime().nullable(),

	analysis_report_ref: z.string().uuid().nullable(),
	optimization_plan_ref: z.string().uuid().nullable(),
	validation_report_ref: z.string().uuid().nullable(),

	retry_count: z.number().int().min(0).default(0),
	error_message: z.string().nullable(),

	resumable: z.boolean().default(false),
	resume_from_stage: PipelineStageSchema.nullable().default(null),
});

export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const RetryPolicySchema = z.object({
	max_retries: z.number().int().min(0).default(3),
	initial_delay_ms: z.number().int().positive().default(1000),
	backoff_multiplier: z.number().positive().default(2.0),
	max_delay_ms: z.number().int().positive().default(30000),
	retryable_errors: z.array(z.string()).default(["rate_limit", "timeout", "server_error"]),
	non_retryable: z.array(z.string()).default(["auth_error", "invalid_request", "content_filter"]),
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
