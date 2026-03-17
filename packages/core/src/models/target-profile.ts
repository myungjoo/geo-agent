import { z } from "zod";

export const CompetitorEntrySchema = z.object({
	url: z.string().url(),
	name: z.string(),
	relationship: z.enum(["direct", "indirect", "reference"]),
});

export type CompetitorEntry = z.infer<typeof CompetitorEntrySchema>;

export const LLMPrioritySchema = z.object({
	llm_service: z.string(),
	priority: z.enum(["critical", "important", "nice_to_have", "monitor_only"]),
});

export type LLMPriority = z.infer<typeof LLMPrioritySchema>;

export const DeploymentConfigSchema = z.object({
	type: z.enum(["git", "ftp", "wordpress_api", "custom_api"]),
	endpoint: z.string(),
	credentials_ref: z.string(),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export const NotificationConfigSchema = z.object({
	on_score_drop: z.boolean().default(true),
	on_external_change: z.boolean().default(true),
	on_optimization_complete: z.boolean().default(true),
	channels: z.array(z.enum(["dashboard", "email", "slack"])).default(["dashboard"]),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export const TargetProfileSchema = z.object({
	// Required
	id: z.string().uuid(),
	url: z.string().url(),
	name: z.string().min(1),

	// Business context
	description: z.string().default(""),
	topics: z.array(z.string()).default([]),
	target_queries: z.array(z.string()).default([]),
	audience: z.string().default(""),
	competitors: z.array(CompetitorEntrySchema).default([]),
	business_goal: z.string().default(""),

	// LLM settings
	llm_priorities: z.array(LLMPrioritySchema).default([]),

	// Deployment
	deployment_mode: z.enum(["direct", "cms_api", "suggestion_only"]).default("suggestion_only"),
	deployment_config: DeploymentConfigSchema.optional(),

	// Notifications
	notifications: NotificationConfigSchema.default({}),

	// Auto-managed
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	status: z.enum(["active", "paused", "archived"]).default("active"),
	monitoring_interval: z.string().default("6h"),
});

export type TargetProfile = z.infer<typeof TargetProfileSchema>;

/** Schema for creating a new target (minimal required fields) */
export const CreateTargetSchema = TargetProfileSchema.pick({
	url: true,
	name: true,
}).extend({
	description: z.string().optional(),
	topics: z.array(z.string()).optional(),
	target_queries: z.array(z.string()).optional(),
	audience: z.string().optional(),
	competitors: z.array(CompetitorEntrySchema).optional(),
	business_goal: z.string().optional(),
	llm_priorities: z.array(LLMPrioritySchema).optional(),
	deployment_mode: z.enum(["direct", "cms_api", "suggestion_only"]).optional(),
	deployment_config: DeploymentConfigSchema.optional(),
	notifications: NotificationConfigSchema.optional(),
	monitoring_interval: z.string().optional(),
});

export type CreateTarget = z.infer<typeof CreateTargetSchema>;

/** Schema for updating a target (all fields optional) */
export const UpdateTargetSchema = CreateTargetSchema.partial();

export type UpdateTarget = z.infer<typeof UpdateTargetSchema>;
