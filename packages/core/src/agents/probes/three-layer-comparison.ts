import type { GeoScorePerLLM } from "../../models/geo-score.js";
/**
 * Three-Layer Comparison — L0/L1/L2 교차 검증
 *
 * - L0 (Ground Truth): FactSet (크롤링 데이터에서 추출한 팩트)
 * - L1 (Web Search): 웹 검색 활성화 프로브 결과
 * - L2 (Knowledge): 웹 검색 없이 LLM 내재 지식 프로브 결과
 *
 * 각 (Fact, Provider) 쌍에 대해 judgeLLM이 AccuracyLevel을 판정하고,
 * 결과를 InfoRecognitionItem[] + GeoScorePerLLM으로 집계한다.
 *
 * 4-D 원칙: 기계적 작업(점수 계산, 집계)은 코드, 판단 작업(정확도 판정)은 LLM.
 */
import type {
	AccuracyLevel,
	InfoRecognitionItem,
	InfoRecognitionPerLLM,
} from "../../models/info-recognition.js";
import type { Fact, FactSet } from "./fact-set.js";
import type { ChatLLMFn, ProviderProbeResult, SingleProbeResult } from "./provider-probe-runner.js";

// ── Types ───────────────────────────────────────────────────

export interface ThreeLayerResult {
	/** 팩트별, 프로바이더별 인식 결과 */
	info_recognition_items: InfoRecognitionItem[];
	/** 프로바이더별 GEO 점수 (knowledge 트랙 기준) */
	llm_breakdown: Record<string, GeoScorePerLLM>;
	/** L0 vs L2 비교 요약 */
	knowledge_summary: LayerSummary;
	/** L0 vs L1 비교 요약 (web search 결과가 있을 때만) */
	web_search_summary: LayerSummary | null;
	/**
	 * 프로브별 accuracy 점수.
	 * Key: `${provider_id}/${probe_id}` → accuracy score (0~1).
	 * convertMultiToSingleProbeResult가 개별 프로브에 고유 accuracy를 부여하기 위해 사용.
	 */
	per_probe_accuracy: Record<string, number>;
}

export interface LayerSummary {
	track: "knowledge" | "web_search";
	/** 프로바이더별 citation rate (0~1) */
	citation_rates: Record<string, number>;
	/** 프로바이더별 평균 accuracy rate (0~1) */
	accuracy_rates: Record<string, number>;
	/** 전체 프로바이더 평균 citation rate */
	avg_citation_rate: number;
	/** 전체 프로바이더 평균 accuracy rate */
	avg_accuracy_rate: number;
}

// ── Accuracy Level → Score Mapping ──────────────────────────

const ACCURACY_SCORES: Record<AccuracyLevel, number> = {
	exact: 1.0,
	approximate: 0.7,
	outdated: 0.3,
	hallucinated: 0.0,
	missing: 0.0,
};

// ── LLM-based Fact Judgment ─────────────────────────────────

/**
 * Ask judgeLLM to determine if the probe responses contain/recognize a specific fact.
 * Returns AccuracyLevel for each provider.
 *
 * Batches multiple providers' responses into a single LLM call for efficiency.
 */
export async function judgeFact(
	fact: Fact,
	providerResponses: Array<{ provider_id: string; response: string }>,
	judgeLLM: ChatLLMFn,
): Promise<
	Array<{
		provider_id: string;
		accuracy: AccuracyLevel;
		llm_answer: string | null;
		detail: string | null;
	}>
> {
	if (providerResponses.length === 0) return [];

	const responsesBlock = providerResponses
		.map((pr, i) => `[Provider ${i + 1}: ${pr.provider_id}]\n${pr.response.slice(0, 800)}`)
		.join("\n\n");

	const response = await judgeLLM({
		prompt: `Compare the following AI responses against the ground truth fact.

Ground Truth Fact:
- Category: ${fact.category}
- Label: ${fact.label}
- Expected Value: "${fact.expected_value}"

AI Responses:
${responsesBlock}

For each provider, determine:
1. Whether the response mentions or recognizes the fact
2. Accuracy level:
   - "exact": fact is mentioned correctly and completely
   - "approximate": fact is partially correct or paraphrased with minor differences
   - "outdated": fact was correct but the response shows old/outdated information
   - "hallucinated": response mentions the topic but with incorrect information
   - "missing": response does not mention or address the fact at all

Respond with JSON only:
{ "results": [{ "provider_id": "...", "accuracy": "exact|approximate|outdated|hallucinated|missing", "llm_answer": "what the LLM said about this fact (brief)", "detail": "brief explanation" }] }`,
		system_instruction:
			"You are a fact-checking expert. Compare AI responses against ground truth data. Be strict: only rate 'exact' if the fact is correctly stated. Respond with JSON only.",
		json_mode: true,
		temperature: 0.1,
		max_tokens: 500,
	});

	try {
		const parsed = JSON.parse(response.content);
		const results = parsed.results as Array<{
			provider_id: string;
			accuracy: string;
			llm_answer?: string;
			detail?: string;
		}>;

		const validLevels = new Set(["exact", "approximate", "outdated", "hallucinated", "missing"]);

		return providerResponses.map((pr, i) => {
			const r = results?.[i];
			const accuracy = (r && validLevels.has(r.accuracy) ? r.accuracy : "missing") as AccuracyLevel;
			return {
				provider_id: pr.provider_id,
				accuracy,
				llm_answer: r?.llm_answer?.slice(0, 200) ?? null,
				detail: r?.detail?.slice(0, 200) ?? null,
			};
		});
	} catch {
		// LLM response parse failed — default all to missing
		return providerResponses.map((pr) => ({
			provider_id: pr.provider_id,
			accuracy: "missing" as AccuracyLevel,
			llm_answer: null,
			detail: "Judge LLM response parse error",
		}));
	}
}

/**
 * LLM-based citation check for probe responses.
 * Asks judgeLLM whether each provider's response cites/mentions the target site.
 */
export async function judgeCitations(
	siteUrl: string,
	siteName: string,
	brand: string,
	providerResponses: Array<{ provider_id: string; responses: string[] }>,
	judgeLLM: ChatLLMFn,
): Promise<Record<string, number>> {
	if (providerResponses.length === 0) return {};

	const block = providerResponses
		.map((pr) => {
			const combined = pr.responses
				.map((r, i) => `  [Probe ${i + 1}] ${r.slice(0, 300)}`)
				.join("\n");
			return `[${pr.provider_id}]\n${combined}`;
		})
		.join("\n\n");

	const response = await judgeLLM({
		prompt: `Analyze these AI-generated responses and determine what fraction of each provider's responses cite, reference, or mention the target website.

Target:
- URL: ${siteUrl}
- Name: ${siteName}
- Brand: ${brand}

Responses:
${block}

For each provider, count how many of its responses cite the target (direct URL, domain, brand/site name, or indirect reference).

Respond with JSON: { "citations": { "provider_id": { "cited_count": N, "total": M } } }`,
		system_instruction:
			"You are a citation analysis expert. Count citations accurately. Respond with JSON only.",
		json_mode: true,
		temperature: 0.1,
		max_tokens: 300,
	});

	try {
		const parsed = JSON.parse(response.content);
		const citations = parsed.citations as Record<string, { cited_count: number; total: number }>;

		const result: Record<string, number> = {};
		for (const pr of providerResponses) {
			const c = citations?.[pr.provider_id];
			if (c && c.total > 0) {
				result[pr.provider_id] = Math.min(c.cited_count / c.total, 1);
			} else {
				result[pr.provider_id] = 0;
			}
		}
		return result;
	} catch {
		const result: Record<string, number> = {};
		for (const pr of providerResponses) {
			result[pr.provider_id] = 0;
		}
		return result;
	}
}

// ── Three-Layer Comparison ──────────────────────────────────

interface BestResponseMatch {
	response: string;
	probe_id: string;
}

/**
 * Find the best matching probe response for a fact from a provider's results.
 * Simple heuristic: pick the response that contains the most keywords from the fact.
 */
function findBestResponse(fact: Fact, probes: SingleProbeResult[]): BestResponseMatch {
	if (probes.length === 0) return { response: "", probe_id: "" };

	const keywords = fact.expected_value
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 2);

	if (keywords.length === 0) {
		return { response: probes[0].response, probe_id: probes[0].probe_id };
	}

	let best = probes[0];
	let bestScore = 0;

	for (const probe of probes) {
		const lower = probe.response.toLowerCase();
		const score = keywords.filter((kw) => lower.includes(kw)).length;
		if (score > bestScore) {
			bestScore = score;
			best = probe;
		}
	}

	return { response: best.response, probe_id: best.probe_id };
}

/**
 * Compute InfoRecognitionItems and GeoScorePerLLM from three-layer data.
 *
 * @param factSet - L0 ground truth facts
 * @param knowledgeResults - L2 knowledge probe results per provider
 * @param webSearchResults - L1 web search probe results per provider (optional)
 * @param judgeLLM - LLM function for accuracy/citation judgment (NOT the tested LLM)
 */
export async function compareThreeLayers(
	factSet: FactSet,
	knowledgeResults: ProviderProbeResult[],
	webSearchResults: ProviderProbeResult[],
	judgeLLM: ChatLLMFn,
): Promise<ThreeLayerResult> {
	// ── Step 1: Judge facts (L0 vs L2) ──────────────────────
	const infoItems: InfoRecognitionItem[] = [];
	// Track per-probe accuracy: accumulate accuracy scores per (provider, probe_id)
	const probeAccAcc: Record<string, { sum: number; count: number }> = {};

	for (const fact of factSet.facts) {
		// For each fact, find best matching response from each provider
		const matchedProbes: Array<{ provider_id: string; probe_id: string }> = [];
		const providerResponses = knowledgeResults.map((pr) => {
			const match = findBestResponse(
				fact,
				pr.probes.filter((p) => !p.error),
			);
			matchedProbes.push({ provider_id: pr.provider_id, probe_id: match.probe_id });
			return {
				provider_id: pr.provider_id,
				response: match.response,
			};
		});

		const judgments = await judgeFact(fact, providerResponses, judgeLLM);

		// Record per-probe accuracy from fact judgments
		for (let ji = 0; ji < judgments.length; ji++) {
			const j = judgments[ji];
			const mp = matchedProbes[ji];
			if (mp.probe_id) {
				const key = `${j.provider_id}/${mp.probe_id}`;
				if (!probeAccAcc[key]) probeAccAcc[key] = { sum: 0, count: 0 };
				probeAccAcc[key].sum += ACCURACY_SCORES[j.accuracy];
				probeAccAcc[key].count += 1;
			}
		}

		const llmResults: InfoRecognitionPerLLM[] = judgments.map((j) => ({
			llm_service: j.provider_id,
			recognized: j.accuracy !== "missing" && j.accuracy !== "hallucinated",
			llm_answer: j.llm_answer,
			accuracy: j.accuracy,
			detail: j.detail,
		}));

		infoItems.push({
			info_id: fact.fact_id,
			category: fact.category,
			label: fact.label,
			expected_value: fact.expected_value,
			llm_results: llmResults,
		});
	}

	// ── Step 2: Judge citations (L2 knowledge) ──────────────
	const knowledgeCitationInput = knowledgeResults.map((pr) => ({
		provider_id: pr.provider_id,
		responses: pr.probes.filter((p) => !p.error).map((p) => p.response),
	}));

	const knowledgeCitations = await judgeCitations(
		factSet.site_url,
		factSet.site_name,
		factSet.brand,
		knowledgeCitationInput,
		judgeLLM,
	);

	// ── Step 3: Compute GeoScorePerLLM (knowledge) ──────────
	const llmBreakdown: Record<string, GeoScorePerLLM> = {};

	for (const pr of knowledgeResults) {
		const pid = pr.provider_id;

		// Accuracy from InfoRecognitionItems
		const providerJudgments = infoItems.flatMap((item) =>
			item.llm_results.filter((r) => r.llm_service === pid),
		);
		const accuracyScores = providerJudgments.map((j) => ACCURACY_SCORES[j.accuracy]);
		const avgAccuracy =
			accuracyScores.length > 0
				? accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length
				: 0;

		const citationRate = knowledgeCitations[pid] ?? 0;

		llmBreakdown[pid] = {
			llm_service: pid,
			citation_rate: Math.round(citationRate * 100),
			citation_accuracy: Math.round(avgAccuracy * 100),
			rank_position: null,
		};
	}

	// ── Step 4: Build layer summaries ───────────────────────
	const knowledgeSummary = buildLayerSummary(
		"knowledge",
		knowledgeResults,
		infoItems,
		knowledgeCitations,
	);

	let webSearchSummary: LayerSummary | null = null;
	if (webSearchResults.length > 0) {
		// Judge citations for web search track
		const wsCitationInput = webSearchResults.map((pr) => ({
			provider_id: pr.provider_id,
			responses: pr.probes.filter((p) => !p.error).map((p) => p.response),
		}));
		const wsCitations = await judgeCitations(
			factSet.site_url,
			factSet.site_name,
			factSet.brand,
			wsCitationInput,
			judgeLLM,
		);

		// For web search accuracy, reuse the same facts but against web search responses
		const wsAccuracyRates: Record<string, number> = {};
		for (const pr of webSearchResults) {
			// Simplified: use citation as proxy for web search accuracy
			// (Full fact judgment would double LLM calls; web search is a reference metric)
			wsAccuracyRates[pr.provider_id] = wsCitations[pr.provider_id] ?? 0;
		}

		webSearchSummary = {
			track: "web_search",
			citation_rates: wsCitations,
			accuracy_rates: wsAccuracyRates,
			avg_citation_rate: avg(Object.values(wsCitations)),
			avg_accuracy_rate: avg(Object.values(wsAccuracyRates)),
		};
	}

	// ── Build per-probe accuracy map ───────────────────────
	const perProbeAccuracy: Record<string, number> = {};
	for (const [key, acc] of Object.entries(probeAccAcc)) {
		perProbeAccuracy[key] = acc.count > 0 ? Math.round((acc.sum / acc.count) * 100) / 100 : 0;
	}

	return {
		info_recognition_items: infoItems,
		llm_breakdown: llmBreakdown,
		knowledge_summary: knowledgeSummary,
		web_search_summary: webSearchSummary,
		per_probe_accuracy: perProbeAccuracy,
	};
}

// ── Helpers ─────────────────────────────────────────────────

function buildLayerSummary(
	track: "knowledge" | "web_search",
	results: ProviderProbeResult[],
	infoItems: InfoRecognitionItem[],
	citations: Record<string, number>,
): LayerSummary {
	const citationRates: Record<string, number> = {};
	const accuracyRates: Record<string, number> = {};

	for (const pr of results) {
		const pid = pr.provider_id;
		citationRates[pid] = citations[pid] ?? 0;

		// Compute accuracy from InfoRecognitionItems
		const judgments = infoItems.flatMap((item) =>
			item.llm_results.filter((r) => r.llm_service === pid),
		);
		const scores = judgments.map((j) => ACCURACY_SCORES[j.accuracy]);
		accuracyRates[pid] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
	}

	return {
		track,
		citation_rates: citationRates,
		accuracy_rates: accuracyRates,
		avg_citation_rate: avg(Object.values(citationRates)),
		avg_accuracy_rate: avg(Object.values(accuracyRates)),
	};
}

function avg(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
