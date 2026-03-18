import { z } from "zod";

export const OAuthConfigSchema = z.object({
	provider: z.enum(["google", "microsoft", "openai"]),
	client_id_ref: z.string(),
	client_secret_ref: z.string(),
	scopes: z.array(z.string()),
	token_endpoint: z.string().nullable(),
	redirect_uri: z.string().default("http://localhost:3000/auth/callback"),

	access_token: z.string().nullable().default(null),
	refresh_token: z.string().nullable().default(null),
	expires_at: z.string().datetime().nullable().default(null),
});

export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

export const LLMAuthConfigSchema = z.discriminatedUnion("method", [
	z.object({
		method: z.literal("api_key"),
		api_key_ref: z.string(),
	}),
	z.object({
		method: z.literal("oauth"),
		oauth_config: OAuthConfigSchema,
	}),
]);

export type LLMAuthConfig = z.infer<typeof LLMAuthConfigSchema>;

export const ModelRoleSchema = z.enum(["orchestration", "validation_target", "utility", "both"]);

export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const LLMModelConfigSchema = z.object({
	model_id: z.string(),
	display_name: z.string(),
	role: ModelRoleSchema,
	is_default: z.boolean().default(false),
	max_tokens: z.number().int().positive(),
	supports_tools: z.boolean(),
	cost_per_1k_tokens: z.object({
		input: z.number().min(0),
		output: z.number().min(0),
	}),
});

export type LLMModelConfig = z.infer<typeof LLMModelConfigSchema>;

export const LLMProviderConfigSchema = z.object({
	provider_id: z.string(),
	display_name: z.string(),
	enabled: z.boolean().default(true),

	auth: LLMAuthConfigSchema,

	models: z.array(LLMModelConfigSchema),

	rate_limit: z.object({
		requests_per_minute: z.number().int().positive(),
		tokens_per_minute: z.number().int().positive(),
	}),
});

export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;
