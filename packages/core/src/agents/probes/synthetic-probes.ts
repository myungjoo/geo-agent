/**
 * Synthetic Probes — LLM에 실제 질의하여 Target 인용/정확도 검증
 *
 * 8종 프로브:
 * P-01: 제품/서비스 스펙 질의 → 정확한 스펙 인용 여부
 * P-02: 가격 질의 → 가격 정보 정확도
 * P-03: 비교 질의 → 경쟁사 대비 Target 언급 여부
 * P-04: 브랜드 질의 → 브랜드/조직 인식 정확도
 * P-05: 추천 질의 → Target 추천 포함 여부
 * P-06: 팩트 검증 → 주요 수치/사실 정확도
 * P-07: 최신 정보 → 최신 정보 반영 여부
 * P-08: 문제 해결 → 솔루션으로 Target 언급 여부
 */
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";

// ── Types ───────────────────────────────────────────────────

export interface ProbeDefinition {
	id: string;
	name: string;
	category: "citation" | "accuracy" | "recognition" | "recommendation";
	/** 프로브 질문 생성 함수 */
	generateQuery: (context: ProbeContext) => string;
}

export interface ProbeContext {
	site_name: string;
	site_url: string;
	site_type: string;
	/** 페이지에서 추출한 주요 키워드/토픽 */
	topics: string[];
	/** 페이지에서 추출한 제품/서비스 이름 */
	products: string[];
	/** 페이지에서 추출한 가격 정보 */
	prices: string[];
	/** 페이지에서 추출한 조직/브랜드 이름 */
	brand: string;
}

export interface SyntheticProbeResult {
	probe_id: string;
	probe_name: string;
	category: string;
	query: string;
	response: string;
	/** Target 사이트가 응답에서 언급/인용되었는지 */
	cited: boolean;
	/** 정확도 (0~1): 응답 내용이 원본 데이터와 일치하는 정도 */
	accuracy: number;
	/** 결과 판정 */
	verdict: "PASS" | "PARTIAL" | "FAIL";
	latency_ms: number;
	model: string;
	provider: string;
}

export interface SyntheticProbeRunResult {
	probes: SyntheticProbeResult[];
	summary: {
		total: number;
		pass: number;
		partial: number;
		fail: number;
		citation_rate: number;
		average_accuracy: number;
	};
}

// ── Probe Definitions ────────────────────────────────────────

const PROBE_DEFINITIONS: ProbeDefinition[] = [
	{
		id: "P-01",
		name: "제품/서비스 스펙",
		category: "accuracy",
		generateQuery: (ctx) =>
			ctx.products.length > 0
				? `${ctx.products[0]}의 주요 스펙과 특징을 알려주세요.`
				: `${ctx.site_name}의 주요 제품이나 서비스의 특징을 알려주세요.`,
	},
	{
		id: "P-02",
		name: "가격 정보",
		category: "accuracy",
		generateQuery: (ctx) =>
			ctx.products.length > 0
				? `${ctx.products[0]}의 가격은 얼마인가요?`
				: `${ctx.site_name}의 주요 제품 가격대를 알려주세요.`,
	},
	{
		id: "P-03",
		name: "비교 분석",
		category: "citation",
		generateQuery: (ctx) =>
			ctx.products.length > 0
				? `${ctx.products[0]}을 경쟁 제품과 비교해주세요.`
				: `${ctx.site_name}을 같은 분야의 경쟁사와 비교해주세요.`,
	},
	{
		id: "P-04",
		name: "브랜드 인식",
		category: "recognition",
		generateQuery: (ctx) =>
			`${ctx.brand || ctx.site_name}에 대해 알려주세요. 어떤 회사이고 무엇으로 유명한가요?`,
	},
	{
		id: "P-05",
		name: "추천 질의",
		category: "recommendation",
		generateQuery: (ctx) => {
			if (ctx.topics.length > 0) {
				return `${ctx.topics[0]} 관련 좋은 제품이나 서비스를 추천해주세요.`;
			}
			return `${ctx.brand || ctx.site_name} 분야에서 추천할 만한 것을 알려주세요.`;
		},
	},
	{
		id: "P-06",
		name: "팩트 검증",
		category: "accuracy",
		generateQuery: (ctx) =>
			ctx.products.length > 0
				? `${ctx.products[0]}의 사양 정보가 정확한지 확인해주세요.`
				: `${ctx.site_name}에 대한 주요 사실을 알려주세요.`,
	},
	{
		id: "P-07",
		name: "최신 정보",
		category: "citation",
		generateQuery: (ctx) => `${ctx.brand || ctx.site_name}의 최신 소식이나 새로운 발표가 있나요?`,
	},
	{
		id: "P-08",
		name: "문제 해결",
		category: "recommendation",
		generateQuery: (ctx) => {
			if (ctx.topics.length > 0) {
				return `${ctx.topics[0]} 관련 문제를 해결하려면 어떻게 해야 하나요?`;
			}
			return `${ctx.brand || ctx.site_name}이 제공하는 서비스로 어떤 문제를 해결할 수 있나요?`;
		},
	},
];

// ── Citation/Accuracy Analysis (LLM-based, 4-D) ─────────────

/**
 * LLM-based citation check: asks the LLM to judge whether the response
 * cited or referenced the target site. Catches indirect citations,
 * paraphrases, and URL variants that string matching would miss.
 */
async function checkCitation(
	response: string,
	siteUrl: string,
	siteName: string,
	brand: string,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<boolean> {
	const judgeResponse = await chatLLM({
		prompt: `Analyze this AI-generated response and determine if it cites, references, or mentions the target website.

Target website:
- URL: ${siteUrl}
- Site name: ${siteName}
- Brand: ${brand}

AI response to analyze:
"""
${response.slice(0, 1500)}
"""

Does the response cite, reference, or mention the target website (including indirect references, paraphrases, or URL variants)?
Respond with JSON: { "cited": true/false, "reasoning": "brief explanation" }`,
		system_instruction:
			"You are a citation analysis expert. Determine if a given text references a specific website. Look for: direct URL mentions, domain references, brand/site name mentions, indirect references, and paraphrased content attribution. Be thorough but accurate. Respond with JSON only.",
		json_mode: true,
		temperature: 0.1,
		max_tokens: 200,
	});

	try {
		const parsed = JSON.parse(judgeResponse.content);
		return !!parsed.cited;
	} catch {
		// If JSON parse fails, fall back to checking for "true" in response
		return (
			judgeResponse.content.toLowerCase().includes('"cited": true') ||
			judgeResponse.content.toLowerCase().includes('"cited":true')
		);
	}
}

/**
 * LLM-based accuracy estimation: asks the LLM to judge how accurately
 * the probe response reflects the target site's actual data.
 * Provides ProbeContext (topics, products, prices) for comparison.
 */
async function estimateAccuracy(
	response: string,
	context: ProbeContext,
	cited: boolean,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<number> {
	const contextInfo = [
		context.topics.length > 0 ? `Topics: ${context.topics.join(", ")}` : null,
		context.products.length > 0 ? `Products: ${context.products.join(", ")}` : null,
		context.prices.length > 0 ? `Prices: ${context.prices.join(", ")}` : null,
		`Brand: ${context.brand}`,
		`Site: ${context.site_name} (${context.site_url})`,
	]
		.filter(Boolean)
		.join("\n");

	const judgeResponse = await chatLLM({
		prompt: `Evaluate the accuracy of this AI-generated response against the known facts about the target site.

Known facts about the target:
${contextInfo}
Was the target cited in the response: ${cited ? "Yes" : "No"}

AI response to evaluate:
"""
${response.slice(0, 1500)}
"""

Rate the accuracy from 0.0 to 1.0 based on:
- How well the response reflects the actual products, topics, and prices
- Whether product names, specs, or brand information are correctly stated
- Whether the response contains relevant and factual information about the target
- Deduct for fabricated or incorrect information

Respond with JSON: { "accuracy": 0.0-1.0, "reasoning": "brief explanation" }`,
		system_instruction:
			"You are an accuracy evaluation expert. Rate how accurately an AI response reflects known facts about a website. Be strict: fabricated details score low, verified facts score high. Respond with JSON only.",
		json_mode: true,
		temperature: 0.1,
		max_tokens: 200,
	});

	try {
		const parsed = JSON.parse(judgeResponse.content);
		const accuracy = Number(parsed.accuracy);
		if (Number.isFinite(accuracy)) {
			return Math.min(Math.max(Math.round(accuracy * 100) / 100, 0), 1);
		}
	} catch {
		// Fallback: try to extract number from response
	}
	return 0;
}

function determineVerdict(cited: boolean, accuracy: number): "PASS" | "PARTIAL" | "FAIL" {
	if (cited && accuracy >= 0.5) return "PASS";
	if (cited || accuracy >= 0.3) return "PARTIAL";
	return "FAIL";
}

// ── Probe Runner ─────────────────────────────────────────────

export async function runProbes(
	context: ProbeContext,
	deps: {
		chatLLM: (req: LLMRequest) => Promise<LLMResponse>;
	},
	options?: {
		/** 실행할 프로브 ID 목록 (기본: 전체) */
		probeIds?: string[];
		/** 프로브 간 딜레이 ms (rate limit 방지, 기본: 1000) */
		delayMs?: number;
	},
): Promise<SyntheticProbeRunResult> {
	const probesToRun = options?.probeIds
		? PROBE_DEFINITIONS.filter((p) => options.probeIds!.includes(p.id))
		: PROBE_DEFINITIONS;

	const delayMs = options?.delayMs ?? 1000;
	const results: SyntheticProbeResult[] = [];

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
			});

			const cited = await checkCitation(
				llmResponse.content,
				context.site_url,
				context.site_name,
				context.brand,
				deps.chatLLM,
			);
			const accuracy = await estimateAccuracy(llmResponse.content, context, cited, deps.chatLLM);
			const verdict = determineVerdict(cited, accuracy);

			results.push({
				probe_id: probe.id,
				probe_name: probe.name,
				category: probe.category,
				query,
				response: llmResponse.content,
				cited,
				accuracy,
				verdict,
				latency_ms: llmResponse.latency_ms,
				model: llmResponse.model,
				provider: llmResponse.provider,
			});
		} catch (err) {
			results.push({
				probe_id: probe.id,
				probe_name: probe.name,
				category: probe.category,
				query,
				response: `Error: ${err instanceof Error ? err.message : String(err)}`,
				cited: false,
				accuracy: 0,
				verdict: "FAIL",
				latency_ms: 0,
				model: "error",
				provider: "error",
			});
		}

		// Rate limit delay
		if (delayMs > 0 && probesToRun.indexOf(probe) < probesToRun.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	const pass = results.filter((r) => r.verdict === "PASS").length;
	const partial = results.filter((r) => r.verdict === "PARTIAL").length;
	const fail = results.filter((r) => r.verdict === "FAIL").length;
	const citedCount = results.filter((r) => r.cited).length;
	const avgAccuracy =
		results.length > 0 ? results.reduce((sum, r) => sum + r.accuracy, 0) / results.length : 0;

	return {
		probes: results,
		summary: {
			total: results.length,
			pass,
			partial,
			fail,
			citation_rate: results.length > 0 ? citedCount / results.length : 0,
			average_accuracy: Math.round(avgAccuracy * 100) / 100,
		},
	};
}

export { PROBE_DEFINITIONS };
