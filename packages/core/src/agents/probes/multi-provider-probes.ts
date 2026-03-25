import type { LLMProviderSettings } from "../../llm/provider-config.js";
import type { GeoScorePerLLM } from "../../models/geo-score.js";
/**
 * Multi-Provider Probes — 오케스트레이터 (진입점)
 *
 * 전체 3-레이어 프로브 시스템을 조율하는 진입점:
 * 1. 활성 프로바이더 목록 획득
 * 2. Ground Truth FactSet 생성 (L0)
 * 3. 프로바이더별 병렬 프로브 실행 (L1 web_search + L2 knowledge)
 * 4. 3-레이어 비교 평가
 * 5. MultiProviderProbeResult 반환
 */
import type { InfoRecognitionItem } from "../../models/info-recognition.js";
import type { CrawlData } from "../shared/types.js";
import { type FactExtractionInput, type FactSet, buildFactSet } from "./fact-set.js";
import {
	type ChatLLMFn,
	type ProviderProbeResult,
	createProviderChatLLM,
	runProbesForProvider,
	supportsWebSearch,
} from "./provider-probe-runner.js";
import type { ProbeContext } from "./synthetic-probes.js";
import {
	type LayerSummary,
	type ThreeLayerResult,
	compareThreeLayers,
} from "./three-layer-comparison.js";

// ── Types ───────────────────────────────────────────────────

export interface MultiProviderProbeResult {
	/** Ground Truth 팩트셋 */
	fact_set: FactSet;
	/** 프로바이더별 knowledge (A-0a) 프로브 원본 결과 */
	knowledge_results: ProviderProbeResult[];
	/** 프로바이더별 web search (A-0b) 프로브 원본 결과 */
	web_search_results: ProviderProbeResult[];
	/** 3-레이어 비교 결과 */
	comparison: ThreeLayerResult;
	/** 참여 프로바이더 목록 */
	providers_used: string[];
	/** 프로바이더별 에러 (초기화 실패, 프로브 전체 실패 등). key=provider_id */
	provider_errors: Record<string, string>;
	/** 실행 통계 */
	stats: {
		total_llm_calls: number;
		total_probes_run: number;
		duration_ms: number;
	};
}

export interface MultiProviderProbeConfig {
	/** 프로브 컨텍스트 (사이트 정보, 키워드 등) */
	context: ProbeContext;
	/** 크롤 데이터 (L0 팩트 추출용) */
	crawlData: CrawlData;
	/** GeoEvaluationData 일부 (팩트 추출용) */
	evalData: FactExtractionInput;
	/** 활성 프로바이더 목록 (API Key가 있는 것만) */
	providers: LLMProviderSettings[];
	/** 판정 LLM (테스트 대상과 별도 — 판정 분리 원칙) */
	judgeLLM: ChatLLMFn;
	/** 프로바이더별 chatLLM 오버라이드 (테스트용, 생략 시 createProviderChatLLM 사용) */
	chatLLMOverrides?: Record<string, ChatLLMFn>;
	/** 프로브 간 딜레이 ms (기본: 500) */
	delayMs?: number;
}

// ── Main Orchestrator ───────────────────────────────────────

/**
 * 멀티 프로바이더 3-레이어 프로브 실행 오케스트레이터.
 *
 * 실행 흐름:
 * 1. buildFactSet() → L0 Ground Truth
 * 2. 프로바이더별 병렬 프로브 실행:
 *    - knowledge track (모든 프로바이더)
 *    - web_search track (지원 프로바이더만)
 * 3. compareThreeLayers() → 비교 결과
 */
export async function runMultiProviderProbes(
	config: MultiProviderProbeConfig,
): Promise<MultiProviderProbeResult> {
	const startTime = Date.now();

	// ── Step 1: Build FactSet (L0) ──────────────────────────
	const factSet = buildFactSet(config.crawlData, config.evalData, {
		brand: config.context.brand,
		site_name: config.context.site_name,
	});

	// ── Step 2: Build chatLLM per provider ──────────────────
	const providerChatLLMs: Record<string, ChatLLMFn> = {};
	const providerErrors: Record<string, string> = {};
	for (const provider of config.providers) {
		if (config.chatLLMOverrides?.[provider.provider_id]) {
			providerChatLLMs[provider.provider_id] = config.chatLLMOverrides[provider.provider_id];
		} else {
			try {
				providerChatLLMs[provider.provider_id] = createProviderChatLLM(provider);
			} catch (err) {
				providerErrors[provider.provider_id] =
					`초기화 실패: ${err instanceof Error ? err.message : String(err)}`;
			}
		}
	}

	const activeProviders = config.providers.filter((p) => providerChatLLMs[p.provider_id]);

	if (activeProviders.length === 0) {
		throw new Error("No active providers with API keys available for multi-provider probes.");
	}

	// ── Step 3: Run probes in parallel ──────────────────────
	const delayMs = config.delayMs ?? 500;

	// A-0a: Knowledge probes (all providers)
	const knowledgePromises = activeProviders.map((provider) =>
		runProbesForProvider(
			config.context,
			{ provider, track: "knowledge" },
			{ chatLLM: providerChatLLMs[provider.provider_id] },
			{ delayMs },
		),
	);

	// A-0b: Web search probes (supported providers only)
	const wsProviders = activeProviders.filter((p) => supportsWebSearch(p.provider_id));
	const webSearchPromises = wsProviders.map((provider) =>
		runProbesForProvider(
			config.context,
			{ provider, track: "web_search" },
			{ chatLLM: providerChatLLMs[provider.provider_id] },
			{ delayMs },
		),
	);

	// Execute all in parallel
	const allResults = await Promise.allSettled([...knowledgePromises, ...webSearchPromises]);

	// Separate results
	const knowledgeResults: ProviderProbeResult[] = [];
	const webSearchResults: ProviderProbeResult[] = [];

	for (let i = 0; i < allResults.length; i++) {
		const result = allResults[i];
		if (result.status === "fulfilled") {
			if (i < knowledgePromises.length) {
				knowledgeResults.push(result.value);
			} else {
				webSearchResults.push(result.value);
			}
		} else {
			// Rejected — 어떤 프로바이더가 실패했는지 기록
			const isKnowledge = i < knowledgePromises.length;
			const provider = isKnowledge ? activeProviders[i] : wsProviders[i - knowledgePromises.length];
			const track = isKnowledge ? "knowledge" : "web_search";
			const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
			const key = provider?.provider_id ?? `unknown-${i}`;
			const prev = providerErrors[key];
			providerErrors[key] = prev
				? `${prev}; ${track} 프로브 실패: ${errMsg}`
				: `${track} 프로브 실패: ${errMsg}`;
		}
	}

	if (knowledgeResults.length === 0) {
		throw new Error("All knowledge probe executions failed. No results to compare.");
	}

	// ── Step 4: Compare three layers ────────────────────────
	const comparison = await compareThreeLayers(
		factSet,
		knowledgeResults,
		webSearchResults,
		config.judgeLLM,
	);

	// ── Step 5: Compute stats ───────────────────────────────
	const totalProbes = [...knowledgeResults, ...webSearchResults].reduce(
		(sum, r) => sum + r.probes.length,
		0,
	);
	// Rough estimate: probes + fact judgments + citation judgments
	const factJudgmentCalls = factSet.facts.length > 0 ? factSet.facts.length : 0;
	const citationCalls = knowledgeResults.length > 0 ? 1 : 0;
	const wsCitationCalls = webSearchResults.length > 0 ? 1 : 0;

	return {
		fact_set: factSet,
		knowledge_results: knowledgeResults,
		web_search_results: webSearchResults,
		comparison,
		providers_used: activeProviders.map((p) => p.provider_id),
		provider_errors: providerErrors,
		stats: {
			total_llm_calls: totalProbes + factJudgmentCalls + citationCalls + wsCitationCalls,
			total_probes_run: totalProbes,
			duration_ms: Date.now() - startTime,
		},
	};
}
