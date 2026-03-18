/**
 * GEO LLM Client — 통합 LLM 추상화 레이어
 *
 * 멀티 프로바이더를 통합하여 단일 인터페이스로 제공.
 * 실제 API 호출은 MVP 이후 각 프로바이더 SDK를 연동하여 구현.
 * 현 단계에서는 인터페이스 정의 + 비용 추적 + 라우팅 로직 구현.
 */
import { z } from "zod";
import type { LLMProviderId, LLMProviderSettings } from "./provider-config.js";
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

	/** 활성화된 프로바이더 기반 최적 라우팅 */
	selectProvider(preferredProvider?: string): LLMProviderSettings {
		const enabled = this.configManager.getEnabled();
		if (enabled.length === 0) {
			throw new Error("No LLM providers enabled. Configure at least one provider.");
		}

		if (preferredProvider) {
			const preferred = enabled.find((p) => p.provider_id === preferredProvider);
			if (preferred) return preferred;
		}

		// 기본: 첫 번째 활성 프로바이더
		return enabled[0];
	}

	/**
	 * LLM 호출 (인터페이스 — 실제 API 호출은 프로바이더 SDK 연동 시 구현)
	 * MVP에서는 stub response를 반환한다.
	 */
	async chat(request: LLMRequest): Promise<LLMResponse> {
		const provider = this.selectProvider(request.provider);
		const model = request.model ?? provider.default_model;
		const startTime = Date.now();

		// TODO: 실제 프로바이더 SDK 호출 구현
		// 현재는 stub response
		const response: LLMResponse = {
			content: `[Stub] LLM response from ${provider.provider_id}/${model}`,
			model,
			provider: provider.provider_id,
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
			latency_ms: Date.now() - startTime,
			cost_usd: 0,
		};

		this.costTracker.record(
			provider.provider_id,
			model,
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
