/**
 * GEO LLM Client — 통합 LLM 추상화 레이어
 *
 * pi-ai를 통해 모든 프로바이더 (OpenAI, Anthropic, Google, Perplexity, Azure)에
 * 단일 인터페이스로 접근. 프로바이더 라우팅, 비용 추적 포함.
 */
import { z } from "zod";
import { piAiComplete, piAiModelFromProvider } from "./pi-ai-bridge.js";
import type { LLMProviderSettings } from "./provider-config.js";
import { ProviderConfigManager } from "./provider-config.js";

// ── LLM 요청/응답 스키마 ─────────────────────────────────────

export const LLMRequestSchema = z.object({
	prompt: z.string(),
	system_instruction: z.string().optional(),
	model: z.string().optional(),
	provider: z.string().optional(),
	max_tokens: z.number().int().positive().optional(),
	temperature: z.number().min(0).max(2).optional(),
	json_mode: z.boolean().default(false),
	/** 웹 검색 활성화 여부 — 프로바이더별 web_search 도구 주입에 사용 */
	web_search: z.boolean().optional(),
});
export type LLMRequest = z.infer<typeof LLMRequestSchema>;

export const LLMResponseSchema = z.object({
	content: z.string(),
	model: z.string(),
	provider: z.string(),
	usage: z.object({
		prompt_tokens: z.number(),
		completion_tokens: z.number(),
		total_tokens: z.number(),
	}),
	latency_ms: z.number(),
	cost_usd: z.number(),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ── Cost Tracker ─────────────────────────────────────────────

export class CostTracker {
	private records: Array<{
		provider: string;
		model: string;
		tokens: number;
		cost_usd: number;
		timestamp: string;
	}> = [];

	record(provider: string, model: string, tokens: number, costUsd: number): void {
		this.records.push({
			provider,
			model,
			tokens,
			cost_usd: costUsd,
			timestamp: new Date().toISOString(),
		});
	}

	getTotalCost(): number {
		return this.records.reduce((sum, r) => sum + r.cost_usd, 0);
	}

	getTotalTokens(): number {
		return this.records.reduce((sum, r) => sum + r.tokens, 0);
	}

	getCostByProvider(): Record<string, number> {
		const result: Record<string, number> = {};
		for (const r of this.records) {
			result[r.provider] = (result[r.provider] ?? 0) + r.cost_usd;
		}
		return result;
	}

	getRecords() {
		return [...this.records];
	}

	reset(): void {
		this.records = [];
	}
}

// ── GEO LLM Client ──────────────────────────────────────────

export class GeoLLMClient {
	private configManager: ProviderConfigManager;
	private costTracker: CostTracker;

	constructor(workspaceDir: string) {
		this.configManager = new ProviderConfigManager(workspaceDir);
		this.costTracker = new CostTracker();
	}

	/** 활성화된 프로바이더 기반 최적 라우팅 (API key가 있는 프로바이더 우선) */
	selectProvider(preferredProvider?: string): LLMProviderSettings {
		const enabled = this.configManager.getEnabled();
		if (enabled.length === 0) {
			throw new Error("No LLM providers enabled. Configure at least one provider.");
		}

		const withKeys = enabled.filter((p) => p.api_key);

		if (preferredProvider) {
			const preferred =
				withKeys.find((p) => p.provider_id === preferredProvider) ??
				enabled.find((p) => p.provider_id === preferredProvider);
			if (preferred) return preferred;
		}

		return withKeys[0] ?? enabled[0];
	}

	/** LLM 호출 — pi-ai complete()를 통해 모든 프로바이더 자동 라우팅 */
	async chat(request: LLMRequest): Promise<LLMResponse> {
		const provider = this.selectProvider(request.provider);
		const model = request.model ?? provider.default_model;

		if (!provider.api_key) {
			throw new Error(
				`No API key configured for provider "${provider.provider_id}". Set it in LLM Provider settings.`,
			);
		}

		// Build pi-ai Model, overriding the model ID if request specifies one
		const piModel = piAiModelFromProvider(
			model !== provider.default_model ? { ...provider, default_model: model } : provider,
		);

		const response = await piAiComplete(piModel, request, { apiKey: provider.api_key });

		this.costTracker.record(
			provider.provider_id,
			response.model,
			response.usage.total_tokens,
			response.cost_usd,
		);

		return response;
	}

	getCostTracker(): CostTracker {
		return this.costTracker;
	}

	getConfigManager(): ProviderConfigManager {
		return this.configManager;
	}
}
