import { z } from "zod";

export const ErrorTypeSchema = z.enum([
	"api_error",
	"timeout",
	"crawl_error",
	"deploy_error",
	"validation_regression",
	"system_error",
]);

export type ErrorType = z.infer<typeof ErrorTypeSchema>;

export const SeveritySchema = z.enum(["critical", "warning", "info"]);

export type Severity = z.infer<typeof SeveritySchema>;

export const ErrorEventSchema = z.object({
	error_id: z.string().uuid(),
	timestamp: z.string().datetime(),
	agent_id: z.string(),
	target_id: z.string().uuid(),
	error_type: ErrorTypeSchema,
	severity: SeveritySchema,
	message: z.string(),
	context: z.record(z.string(), z.unknown()),
	resolved: z.boolean().default(false),
});

export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
