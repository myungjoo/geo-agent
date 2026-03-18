/**
 * GEO LLM Client — 통합 LLM 추상화 레이어
 *
 * OpenAI / Anthropic / Google Generative AI SDK를 통합하여 단일 인터페이스로 제공.
 * 프로바이더 자동 라우팅, 비용 추적, 에러 핸들링 포함.
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

// ── Price table (USD per 1K tokens) ──────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
	"gpt-4o": { input: 0.0025, output: 0.01 },
	"gpt-4o-mini": { input: 0.00015, output: 0.0006 },
	"gpt-4-turbo": { input: 0.01, output: 0.03 },
	"claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
	"claude-haiku-4-5-20251001": { input: 0.0008, output: 0.004 },
	"claude-opus-4-20250514": { input: 0.015, output: 0.075 },
	"gemini-2.0-flash": { input: 0.0001, output: 0.0004 },
	"gemini-2.5-pro-preview-05-06": { input: 0.00125, output: 0.01 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
	const price = PRICING[model] ?? { input: 0.002, output: 0.006 };
	return (promptTokens / 1000) * price.input + (completionTokens / 1000) * price.output;
}

// ── Provider-specific callers ────────────────────────────────

async function callOpenAI(
	provider: LLMProviderSettings,
	request: LLMRequest,
	model: string,
): Promise<LLMResponse> {
	const { default: OpenAI } = await import("openai");
	const client = new OpenAI({
		apiKey: provider.api_key ?? "",
		baseURL: provider.api_base_url || undefined,
	});

	const messages: Array<{ role: "system" | "user"; content: string }> = [];
	if (request.system_instruction) {
		messages.push({ role: "system", content: request.system_instruction });
	}
	messages.push({ role: "user", content: request.prompt });

	const startTime = Date.now();
	const completion = await client.chat.completions.create({
		model,
		messages,
		max_tokens: request.max_tokens ?? provider.max_tokens,
		temperature: request.temperature ?? provider.temperature,
		...(request.json_mode ? { response_format: { type: "json_object" } } : {}),
	});

	const usage = completion.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
	const costUsd = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);

	return {
		content: completion.choices[0]?.message?.content ?? "",
		model: completion.model ?? model,
		provider: provider.provider_id,
		usage: {
			prompt_tokens: usage.prompt_tokens,
			completion_tokens: usage.completion_tokens,
			total_tokens: usage.total_tokens,
		},
		latency_ms: Date.now() - startTime,
		cost_usd: costUsd,
	};
}

async function callAnthropic(
	provider: LLMProviderSettings,
	request: LLMRequest,
	model: string,
): Promise<LLMResponse> {
	const { default: Anthropic } = await import("@anthropic-ai/sdk");
	const client = new Anthropic({
		apiKey: provider.api_key ?? "",
		baseURL: provider.api_base_url || undefined,
	});

	const startTime = Date.now();
	const message = await client.messages.create({
		model,
		max_tokens: request.max_tokens ?? provider.max_tokens ?? 4096,
		...(request.system_instruction ? { system: request.system_instruction } : {}),
		messages: [{ role: "user", content: request.prompt }],
		...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
	});

	const usage = message.usage;
	const promptTokens = usage?.input_tokens ?? 0;
	const completionTokens = usage?.output_tokens ?? 0;
	const costUsd = estimateCost(model, promptTokens, completionTokens);

	const content =
		message.content
			.filter((b) => b.type === "text")
			.map((b) => (b as { type: "text"; text: string }).text)
			.join("") ?? "";

	return {
		content,
		model: message.model ?? model,
		provider: provider.provider_id,
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
		},
		latency_ms: Date.now() - startTime,
		cost_usd: costUsd,
	};
}

async function callGoogle(
	provider: LLMProviderSettings,
	request: LLMRequest,
	model: string,
): Promise<LLMResponse> {
	const { GoogleGenerativeAI } = await import("@google/generative-ai");
	const genAI = new GoogleGenerativeAI(provider.api_key ?? "");
	const genModel = genAI.getGenerativeModel({
		model,
		...(request.system_instruction ? { systemInstruction: request.system_instruction } : {}),
	});

	const startTime = Date.now();
	const result = await genModel.generateContent({
		contents: [{ role: "user", parts: [{ text: request.prompt }] }],
		generationConfig: {
			maxOutputTokens: request.max_tokens ?? provider.max_tokens ?? 4096,
			temperature: request.temperature ?? provider.temperature ?? 0.7,
			...(request.json_mode ? { responseMimeType: "application/json" } : {}),
		},
	});

	const response = result.response;
	const text = response.text();
	const usage = response.usageMetadata;
	const promptTokens = usage?.promptTokenCount ?? 0;
	const completionTokens = usage?.candidatesTokenCount ?? 0;
	const costUsd = estimateCost(model, promptTokens, completionTokens);

	return {
		content: text,
		model,
		provider: provider.provider_id,
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
		},
		latency_ms: Date.now() - startTime,
		cost_usd: costUsd,
	};
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

	/** LLM 호출 — 프로바이더별 SDK 자동 라우팅 */
	async chat(request: LLMRequest): Promise<LLMResponse> {
		const provider = this.selectProvider(request.provider);
		const model = request.model ?? provider.default_model;

		if (!provider.api_key) {
			throw new Error(
				`No API key configured for provider "${provider.provider_id}". Set it in LLM Provider settings.`,
			);
		}

		let response: LLMResponse;

		switch (provider.provider_id) {
			case "openai":
				response = await callOpenAI(provider, request, model);
				break;
			case "anthropic":
				response = await callAnthropic(provider, request, model);
				break;
			case "google":
				response = await callGoogle(provider, request, model);
				break;
			case "perplexity":
				// Perplexity uses OpenAI-compatible API
				response = await callOpenAI(
					{ ...provider, api_base_url: provider.api_base_url || "https://api.perplexity.ai" },
					request,
					model,
				);
				break;
			default:
				throw new Error(
					`Provider "${provider.provider_id}" is not yet supported for direct API calls.`,
				);
		}

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
