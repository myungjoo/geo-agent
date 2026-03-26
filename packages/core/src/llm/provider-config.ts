/**
 * LLM Provider Configuration Manager
 *
 * 멀티 프로바이더 설정 관리 (OpenAI, Anthropic, Google, Perplexity, Microsoft, Meta)
 * API Key + OAuth 이중 인증 지원
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// ── Provider Types ────────────────────────────────────────────

export const LLMProviderIdSchema = z.enum([
	"openai",
	"anthropic",
	"google",
	"perplexity",
	"microsoft",
	"meta",
]);
export type LLMProviderId = z.infer<typeof LLMProviderIdSchema>;

export const AuthMethodSchema = z.enum(["api_key", "oauth"]);
export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const LLMProviderSettingsSchema = z.object({
	provider_id: LLMProviderIdSchema,
	display_name: z.string(),
	enabled: z.boolean().default(false),
	auth_method: AuthMethodSchema.default("api_key"),
	api_key: z.string().optional(),
	api_base_url: z.string().optional(),
	default_model: z.string(),
	available_models: z.array(z.string()).default([]),
	max_tokens: z.number().int().positive().default(4096),
	temperature: z.number().min(0).max(2).default(0.3),
	rate_limit_rpm: z.number().int().positive().default(60),
});
export type LLMProviderSettings = z.infer<typeof LLMProviderSettingsSchema>;

// ── Default Providers ────────────────────────────────────────

export const DEFAULT_PROVIDERS: LLMProviderSettings[] = [
	{
		provider_id: "openai",
		display_name: "OpenAI",
		enabled: true,
		auth_method: "api_key",
		default_model: "gpt-4o",
		available_models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	},
	{
		provider_id: "anthropic",
		display_name: "Anthropic",
		enabled: false,
		auth_method: "api_key",
		default_model: "claude-sonnet-4-6",
		available_models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	},
	{
		provider_id: "google",
		display_name: "Google AI",
		enabled: false,
		auth_method: "api_key",
		default_model: "gemini-2.5-flash",
		available_models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash-001"],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	},
	{
		provider_id: "perplexity",
		display_name: "Perplexity",
		enabled: false,
		auth_method: "api_key",
		default_model: "sonar",
		available_models: ["sonar", "sonar-pro"],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	},
	{
		provider_id: "microsoft",
		display_name: "Microsoft (Azure OpenAI)",
		enabled: false,
		auth_method: "api_key",
		default_model: "gpt-4o",
		available_models: ["gpt-4o", "gpt-4o-mini"],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	},
	{
		provider_id: "meta",
		display_name: "Meta (Llama)",
		enabled: false,
		auth_method: "api_key",
		default_model: "llama-3.3-70b",
		available_models: ["llama-3.3-70b", "llama-3.1-405b"],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	},
];

// ── Environment Variable Fallback (CI/CD) ───────────────

const ENV_VAR_MAP: Record<string, { apiKey: string; baseUrl?: string }> = {
	openai: { apiKey: "OPENAI_API_KEY" },
	anthropic: { apiKey: "ANTHROPIC_API_KEY" },
	google: { apiKey: "GOOGLE_API_KEY" },
	microsoft: { apiKey: "AZURE_OPENAI_API_KEY", baseUrl: "AZURE_OPENAI_BASE_URL" },
	perplexity: { apiKey: "PERPLEXITY_API_KEY" },
	meta: { apiKey: "META_API_KEY" },
};

/** export for testing */
export { ENV_VAR_MAP };

const PROVIDERS_FILE = "llm-providers.json";

// ── Provider Config Manager ────────────────────────────────

export class ProviderConfigManager {
	private workspaceDir: string;

	constructor(workspaceDir: string) {
		this.workspaceDir = workspaceDir;
	}

	/**
	 * 환경변수 fallback 적용.
	 * 파일 설정에 api_key가 없을 때만 env var로 채움.
	 * env var로 키가 채워지면 자동으로 enabled: true.
	 */
	private applyEnvFallback(provider: LLMProviderSettings): LLMProviderSettings {
		const envMap = ENV_VAR_MAP[provider.provider_id];
		if (!envMap) return provider;

		let changed = false;

		if (!provider.api_key) {
			const envKey = process.env[envMap.apiKey];
			if (envKey) {
				provider.api_key = envKey;
				provider.enabled = true;
				changed = true;
			}
		}

		if (!provider.api_base_url && envMap.baseUrl) {
			const envUrl = process.env[envMap.baseUrl];
			if (envUrl) {
				provider.api_base_url = envUrl;
			}
		}

		return provider;
	}

	/** 모든 프로바이더 설정 로드 (환경변수 fallback 포함) */
	loadAll(): LLMProviderSettings[] {
		const configPath = path.join(this.workspaceDir, PROVIDERS_FILE);
		let providers: LLMProviderSettings[];
		if (!fs.existsSync(configPath)) {
			providers = DEFAULT_PROVIDERS.map((p) => ({ ...p }));
		} else {
			try {
				const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
				providers = z.array(LLMProviderSettingsSchema).parse(raw);
			} catch (err) {
				throw new Error(
					`Failed to parse LLM provider config ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		return providers.map((p) => this.applyEnvFallback(p));
	}

	/** 특정 프로바이더 설정 로드 */
	load(providerId: LLMProviderId): LLMProviderSettings {
		const all = this.loadAll();
		const found = all.find((p) => p.provider_id === providerId);
		if (!found) {
			const defaultProvider = DEFAULT_PROVIDERS.find((p) => p.provider_id === providerId);
			if (!defaultProvider) throw new Error(`Unknown provider: ${providerId}`);
			return { ...defaultProvider };
		}
		return found;
	}

	/** 프로바이더 설정 저장 */
	save(settings: LLMProviderSettings): void {
		const all = this.loadAll();
		const idx = all.findIndex((p) => p.provider_id === settings.provider_id);
		if (idx >= 0) {
			all[idx] = settings;
		} else {
			all.push(settings);
		}
		this.saveAll(all);
	}

	/** 전체 설정 저장 */
	saveAll(settings: LLMProviderSettings[]): void {
		const configPath = path.join(this.workspaceDir, PROVIDERS_FILE);
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		// API 키는 마스킹하지 않고 저장 (workspace는 로컬 전용)
		fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf-8");
	}

	/** 프로바이더 활성화/비활성화 */
	setEnabled(providerId: LLMProviderId, enabled: boolean): LLMProviderSettings {
		const settings = this.load(providerId);
		settings.enabled = enabled;
		this.save(settings);
		return settings;
	}

	/** 활성화된 프로바이더 목록 */
	getEnabled(): LLMProviderSettings[] {
		return this.loadAll().filter((p) => p.enabled);
	}

	/** 설정 초기화 (기본값으로) */
	reset(providerId: LLMProviderId): LLMProviderSettings {
		const defaultProvider = DEFAULT_PROVIDERS.find((p) => p.provider_id === providerId);
		if (!defaultProvider) throw new Error(`Unknown provider: ${providerId}`);
		const settings = { ...defaultProvider };
		this.save(settings);
		return settings;
	}

	/** 전체 초기화 */
	resetAll(): LLMProviderSettings[] {
		const defaults = DEFAULT_PROVIDERS.map((p) => ({ ...p }));
		this.saveAll(defaults);
		return defaults;
	}
}
