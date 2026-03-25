/**
 * Provider Probe Runner — 프로바이더별 프로브 실행
 *
 * 기존 PROBE_DEFINITIONS (P-01~P-08)을 재사용하여
 * 특정 프로바이더에 대해 knowledge(A-0a) 또는 web_search(A-0b) 트랙으로
 * 프로브를 실행하고 응답 텍스트를 수집한다.
 *
 * 판정(citation/accuracy)은 수행하지 않음 — three-layer-comparison.ts가 담당.
 */
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import { piAiComplete, piAiModelFromProvider } from "../../llm/pi-ai-bridge.js";
import type { LLMProviderSettings } from "../../llm/provider-config.js";
import { PROBE_DEFINITIONS, type ProbeContext } from "./synthetic-probes.js";

// ── Types ───────────────────────────────────────────────────

export type ChatLLMFn = (req: LLMRequest) => Promise<LLMResponse>;

export interface SingleProbeResult {
	probe_id: string;
	probe_name: string;
	category: string;
	query: string;
	response: string;
	latency_ms: number;
	error?: string;
}

export interface ProviderProbeResult {
	provider_id: string;
	model: string;
	track: "knowledge" | "web_search";
	probes: SingleProbeResult[];
}

export interface ProviderProbeConfig {
	provider: LLMProviderSettings;
	track: "knowledge" | "web_search";
}

// ── chatLLM Factory ─────────────────────────────────────────

/**
 * Creates a chatLLM function bound to a specific provider.
 * Uses piAiModelFromProvider + piAiComplete for actual API calls.
 */
export function createProviderChatLLM(provider: LLMProviderSettings): ChatLLMFn {
	if (!provider.api_key) {
		throw new Error(`No API key for provider "${provider.provider_id}"`);
	}

	const model = piAiModelFromProvider(provider);

	return async (request: LLMRequest): Promise<LLMResponse> => {
		return piAiComplete(model, request, { apiKey: provider.api_key });
	};
}

// ── Probe Runner ────────────────────────────────────────────

/**
 * Run probes for a single provider on a single track (knowledge or web_search).
 * Collects raw responses only — no citation/accuracy judgment.
 */
export async function runProbesForProvider(
	context: ProbeContext,
	config: ProviderProbeConfig,
	deps: {
		chatLLM: ChatLLMFn;
	},
	options?: {
		/** 실행할 프로브 ID 목록 (기본: 전체) */
		probeIds?: string[];
		/** 프로브 간 딜레이 ms (rate limit 방지, 기본: 500) */
		delayMs?: number;
	},
): Promise<ProviderProbeResult> {
	const probesToRun = options?.probeIds
		? PROBE_DEFINITIONS.filter((p) => options.probeIds!.includes(p.id))
		: PROBE_DEFINITIONS;

	const delayMs = options?.delayMs ?? 500;
	const probes: SingleProbeResult[] = [];

	for (const probe of probesToRun) {
		const query = probe.generateQuery(context);

		try {
			const llmResponse = await deps.chatLLM({
				prompt: query,
				system_instruction:
					"사용자의 질문에 정확하고 상세하게 답변하세요. 가능하면 출처나 브랜드를 언급하세요.",
				max_tokens: 500,
				temperature: 0.3,
				json_mode: false,
				web_search: config.track === "web_search" ? true : undefined,
			});

			probes.push({
				probe_id: probe.id,
				probe_name: probe.name,
				category: probe.category,
				query,
				response: llmResponse.content,
				latency_ms: llmResponse.latency_ms,
			});
		} catch (err) {
			probes.push({
				probe_id: probe.id,
				probe_name: probe.name,
				category: probe.category,
				query,
				response: "",
				latency_ms: 0,
				error: err instanceof Error ? err.message : String(err),
			});
		}

		// Rate limit delay
		if (delayMs > 0 && probesToRun.indexOf(probe) < probesToRun.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	return {
		provider_id: config.provider.provider_id,
		model: config.provider.default_model,
		track: config.track,
		probes,
	};
}

// ── Web Search Support Detection ────────────────────────────

/** Providers that support web search in their API */
const WEB_SEARCH_PROVIDERS = new Set(["openai", "anthropic", "google", "perplexity", "microsoft"]);

/**
 * Returns true if the provider supports web search probes (A-0b).
 * Meta (Llama) does not support web search.
 */
export function supportsWebSearch(providerId: string): boolean {
	return WEB_SEARCH_PROVIDERS.has(providerId);
}
