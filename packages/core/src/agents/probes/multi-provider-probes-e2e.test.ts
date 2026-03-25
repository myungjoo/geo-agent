/**
 * E2E Mock Integration Tests — 멀티 프로바이더 3-레이어 프로브 시스템
 *
 * 실제 API Key 없이 전체 파이프라인을 검증한다:
 * CrawlData → FactSet → 프로바이더별 프로브 → 3-레이어 비교 → GeoScore/InfoRecognition 생성
 *
 * 커버하는 갭:
 * - E2E: CrawlData → ThreeLayerResult → GeoScore population
 * - 3+ 프로바이더 시나리오 (varied accuracy: exact/approximate/hallucinated/missing)
 * - web_search 플래그 전파 검증
 * - GeoScore.llm_breakdown 올바른 계산
 * - InfoRecognitionItem 올바른 생성
 * - 엣지 케이스: 전체 프로바이더 실패, 빈 JSON-LD, judge LLM 부분 실패
 */
import { describe, expect, it, vi } from "vitest";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import type { LLMProviderSettings } from "../../llm/provider-config.js";
import type { CrawlData } from "../shared/types.js";
import type { FactExtractionInput } from "./fact-set.js";
import { runMultiProviderProbes } from "./multi-provider-probes.js";
import type { ChatLLMFn } from "./provider-probe-runner.js";
import type { ProbeContext } from "./synthetic-probes.js";

// ── Realistic Mock Data ─────────────────────────────────────

/**
 * Samsung Galaxy S25 Ultra 제품 페이지를 시뮬레이션하는 CrawlData.
 * JSON-LD, meta tags, product specs가 풍부한 현실적인 데이터.
 */
const realisticCrawlData: CrawlData = {
	html: `<html><head>
		<title>Samsung Galaxy S25 Ultra | Samsung Electronics</title>
		<meta name="description" content="Galaxy S25 Ultra features a 6.9-inch Dynamic AMOLED display, Snapdragon 8 Elite processor, and 200MP camera.">
	</head><body>
		<h1>Galaxy S25 Ultra</h1>
		<p>The ultimate smartphone experience. Starting at $1,299.99.</p>
		<p>5000mAh battery, 12GB RAM, 256GB storage.</p>
	</body></html>`,
	url: "https://www.samsung.com/smartphones/galaxy-s25-ultra/",
	status_code: 200,
	content_type: "text/html",
	response_time_ms: 350,
	robots_txt: "User-agent: *\nAllow: /",
	llms_txt: null,
	sitemap_xml: null,
	json_ld: [
		{
			"@type": "Product",
			name: "Galaxy S25 Ultra",
			description: "The ultimate smartphone with AI-powered features and titanium design.",
			offers: {
				price: "1299.99",
				priceCurrency: "USD",
			},
			additionalProperty: [
				{ name: "Display", value: '6.9" Dynamic AMOLED 2X' },
				{ name: "Processor", value: "Snapdragon 8 Elite" },
				{ name: "Camera", value: "200MP Wide" },
				{ name: "Battery", value: "5000mAh" },
			],
			aggregateRating: {
				ratingValue: "4.6",
				reviewCount: "3842",
			},
		},
		{
			"@type": "Organization",
			name: "Samsung Electronics",
		},
	],
	meta_tags: {
		description:
			"Galaxy S25 Ultra features a 6.9-inch Dynamic AMOLED display, Snapdragon 8 Elite processor, and 200MP camera.",
	},
	title: "Samsung Galaxy S25 Ultra | Samsung Electronics",
	canonical_url: "https://www.samsung.com/smartphones/galaxy-s25-ultra/",
	links: [],
	headers: {},
};

const realisticEvalData: FactExtractionInput = {
	product_info: [
		{
			page_url: "https://www.samsung.com/smartphones/galaxy-s25-ultra/",
			filename: "index.html",
			info: {
				product_name: "Galaxy S25 Ultra",
				prices: ["USD 1299.99"],
				specs_in_html: ["5000mAh", "12GB", "256GB"],
				specs_in_schema: ['Display: 6.9" Dynamic AMOLED 2X', "Processor: Snapdragon 8 Elite"],
				has_aggregate_rating: true,
				rating_value: "4.6",
				review_count: "3842",
			},
		},
	],
	marketing_claims: [
		{
			text: "Galaxy S25 Ultra won Red Dot Design Award 2025",
			location: "https://www.samsung.com/smartphones/galaxy-s25-ultra/",
			has_source: true,
			verifiability: "verifiable",
		},
		{
			text: "The world's most advanced smartphone",
			location: "https://www.samsung.com/smartphones/galaxy-s25-ultra/",
			has_source: false,
			verifiability: "unverifiable",
		},
	],
};

const realisticContext: ProbeContext = {
	site_name: "Samsung Electronics",
	site_url: "https://www.samsung.com/smartphones/galaxy-s25-ultra/",
	site_type: "manufacturer",
	topics: ["smartphones", "Galaxy S25 Ultra", "Android"],
	products: ["Galaxy S25 Ultra"],
	prices: ["$1,299.99"],
	brand: "Samsung",
};

// ── Mock Providers ──────────────────────────────────────────

function makeProvider(id: string, model: string): LLMProviderSettings {
	return {
		provider_id: id as any,
		display_name: id,
		enabled: true,
		auth_method: "api_key",
		api_key: `sk-mock-${id}`,
		default_model: model,
		available_models: [model],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	};
}

function makeLLMResponse(content: string, provider: string, model: string): LLMResponse {
	return {
		content,
		model,
		provider,
		usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
		latency_ms: 150,
		cost_usd: 0.002,
	};
}

// ── Provider-specific Mock Responses ────────────────────────

/**
 * OpenAI: 정확한 응답 (exact). Galaxy S25 Ultra 정보를 잘 알고 있음.
 */
function openaiMockLLM(): ChatLLMFn {
	return vi.fn(async (req: LLMRequest) =>
		makeLLMResponse(
			"Samsung Galaxy S25 Ultra is a flagship smartphone priced at $1,299.99. " +
				"It features a 6.9-inch Dynamic AMOLED 2X display, Snapdragon 8 Elite processor, " +
				"200MP main camera, and a 5000mAh battery. It has a 4.6/5 rating based on 3842 reviews. " +
				"Samsung Electronics is the manufacturer. Visit samsung.com for details.",
			"openai",
			"gpt-4o",
		),
	);
}

/**
 * Anthropic: 대체로 정확하지만 일부 근사치 (approximate). 가격을 약간 다르게 언급.
 */
function anthropicMockLLM(): ChatLLMFn {
	return vi.fn(async (req: LLMRequest) =>
		makeLLMResponse(
			`The Samsung Galaxy S25 Ultra is Samsung's premium flagship phone. ` +
				"It costs around $1,300 and features a large AMOLED display with Snapdragon processor. " +
				"The camera system is impressive with a high-resolution main sensor. " +
				`It's well-reviewed with high ratings.`,
			"anthropic",
			"claude-sonnet-4-6",
		),
	);
}

/**
 * Google: 부분적으로 정확하고 일부 정보가 없음 (approximate + missing).
 */
function googleMockLLM(): ChatLLMFn {
	return vi.fn(async (req: LLMRequest) =>
		makeLLMResponse(
			"Samsung Galaxy S25 Ultra is a high-end smartphone with a Snapdragon 8 Elite chip. " +
				`I don't have specific pricing information. ` +
				"The phone has advanced camera capabilities.",
			"google",
			"gemini-2.0-flash",
		),
	);
}

/**
 * Meta: 부정확한 정보 포함 (hallucinated). 다른 모델 스펙과 혼동.
 */
function metaMockLLM(): ChatLLMFn {
	return vi.fn(async (req: LLMRequest) =>
		makeLLMResponse(
			"The Samsung Galaxy S25 Ultra has a 6.7-inch display and is powered by Exynos 2500 processor. " +
				"It costs $999.99 and has a 108MP camera. The battery is 4500mAh. " +
				"Samsung is a South Korean company.",
			"meta",
			"llama-3.3-70b",
		),
	);
}

// ── Judge LLM (현실적인 판정) ──────────────────────────────

/**
 * Judge LLM: 프로바이더별 정확도를 현실적으로 판정.
 * OpenAI=exact, Anthropic=approximate, Google=approximate/missing, Meta=hallucinated
 */
function realisticJudgeLLM(): ChatLLMFn {
	return vi.fn(async (req: LLMRequest) => {
		// ── Fact judgment ──
		if (req.prompt.includes("Ground Truth Fact")) {
			// Determine which fact is being judged
			const factValue = req.prompt.match(/Expected Value: "([^"]+)"/)?.[1] ?? "";

			// Build provider-specific accuracy based on fact
			const results: Array<{
				provider_id: string;
				accuracy: string;
				llm_answer: string;
				detail: string;
			}> = [];

			// Check which providers are in the prompt
			const providerIds = ["openai", "anthropic", "google", "meta"].filter(
				(id) => req.prompt.includes("[Provider") && req.prompt.includes(id),
			);

			for (const pid of providerIds) {
				if (pid === "openai") {
					results.push({
						provider_id: pid,
						accuracy: "exact",
						llm_answer: factValue,
						detail: "Exact match with ground truth",
					});
				} else if (pid === "anthropic") {
					results.push({
						provider_id: pid,
						accuracy: "approximate",
						llm_answer: `~${factValue}`,
						detail: "Close but not exact",
					});
				} else if (pid === "google") {
					if (factValue.includes("USD") || factValue.includes("$")) {
						results.push({
							provider_id: pid,
							accuracy: "missing",
							llm_answer: "",
							detail: "Price not mentioned",
						});
					} else {
						results.push({
							provider_id: pid,
							accuracy: "approximate",
							llm_answer: factValue,
							detail: "Partially correct",
						});
					}
				} else if (pid === "meta") {
					if (
						factValue.includes("1299") ||
						factValue.includes("6.9") ||
						factValue.includes("200MP") ||
						factValue.includes("5000")
					) {
						results.push({
							provider_id: pid,
							accuracy: "hallucinated",
							llm_answer: "Incorrect value stated",
							detail: "Wrong spec provided",
						});
					} else {
						results.push({
							provider_id: pid,
							accuracy: "approximate",
							llm_answer: factValue,
							detail: "Partially correct",
						});
					}
				}
			}

			return makeLLMResponse(JSON.stringify({ results }), "openai", "gpt-4o");
		}

		// ── Citation judgment ──
		if (req.prompt.includes("cite, reference, or mention the target")) {
			const citations: Record<string, { cited_count: number; total: number }> = {};

			if (req.prompt.includes("openai")) {
				citations.openai = { cited_count: 6, total: 8 }; // 75% — mentions samsung.com
			}
			if (req.prompt.includes("anthropic")) {
				citations.anthropic = { cited_count: 4, total: 8 }; // 50% — mentions Samsung
			}
			if (req.prompt.includes("google")) {
				citations.google = { cited_count: 3, total: 8 }; // 37.5%
			}
			if (req.prompt.includes("meta")) {
				citations.meta = { cited_count: 2, total: 8 }; // 25% — mentions Samsung but not site
			}

			return makeLLMResponse(JSON.stringify({ citations }), "openai", "gpt-4o");
		}

		// Default
		return makeLLMResponse("{}", "openai", "gpt-4o");
	});
}

// ── Tests ───────────────────────────────────────────────────

describe("E2E Mock Integration — Multi-Provider 3-Layer Probes", () => {
	describe("E2E: CrawlData → FactSet → Probes → GeoScore", () => {
		it("runs full pipeline with 3 providers + varied accuracy", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [
					makeProvider("openai", "gpt-4o"),
					makeProvider("anthropic", "claude-sonnet-4-6"),
					makeProvider("google", "gemini-2.0-flash"),
				],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: {
					openai: openaiMockLLM(),
					anthropic: anthropicMockLLM(),
					google: googleMockLLM(),
				},
				delayMs: 0,
			});

			// ── FactSet (L0) ──
			expect(result.fact_set.brand).toBe("Samsung");
			expect(result.fact_set.site_name).toBe("Samsung Electronics");
			expect(result.fact_set.facts.length).toBeGreaterThanOrEqual(5);

			// Verify specific facts extracted
			const priceFact = result.fact_set.facts.find(
				(f) => f.category === "PRICING" && f.expected_value.includes("1299"),
			);
			expect(priceFact).toBeTruthy();

			const productFact = result.fact_set.facts.find(
				(f) => f.category === "PRODUCT_DETAIL" && f.expected_value.includes("Galaxy S25 Ultra"),
			);
			expect(productFact).toBeTruthy();

			const claimFact = result.fact_set.facts.find(
				(f) => f.source === "marketing_claim" && f.expected_value.includes("Red Dot"),
			);
			expect(claimFact).toBeTruthy();

			// "world's most advanced" (unverifiable) should NOT be a fact
			const unverifiableClaim = result.fact_set.facts.find((f) =>
				f.expected_value.includes("most advanced"),
			);
			expect(unverifiableClaim).toBeFalsy();

			// ── Knowledge Results (L2) ──
			expect(result.knowledge_results).toHaveLength(3);
			expect(result.knowledge_results.map((r) => r.provider_id).sort()).toEqual([
				"anthropic",
				"google",
				"openai",
			]);
			for (const kr of result.knowledge_results) {
				expect(kr.track).toBe("knowledge");
				expect(kr.probes).toHaveLength(8);
			}

			// ── Web Search Results (L1) ──
			// All 3 providers support web search
			expect(result.web_search_results).toHaveLength(3);
			for (const wr of result.web_search_results) {
				expect(wr.track).toBe("web_search");
			}

			// ── Comparison: InfoRecognitionItems ──
			const items = result.comparison.info_recognition_items;
			expect(items.length).toBe(result.fact_set.facts.length);

			// Each item should have results for all 3 providers
			for (const item of items) {
				expect(item.llm_results).toHaveLength(3);
				expect(item.llm_results.map((r) => r.llm_service).sort()).toEqual([
					"anthropic",
					"google",
					"openai",
				]);
			}

			// ── Comparison: llm_breakdown ──
			const breakdown = result.comparison.llm_breakdown;
			expect(Object.keys(breakdown).sort()).toEqual(["anthropic", "google", "openai"]);

			// OpenAI should have best scores (exact accuracy)
			expect(breakdown.openai.citation_rate).toBeGreaterThan(breakdown.google.citation_rate);
			expect(breakdown.openai.citation_accuracy).toBeGreaterThanOrEqual(
				breakdown.anthropic.citation_accuracy,
			);

			// Each entry should have correct structure
			for (const [pid, score] of Object.entries(breakdown)) {
				expect(score.llm_service).toBe(pid);
				expect(score.citation_rate).toBeGreaterThanOrEqual(0);
				expect(score.citation_rate).toBeLessThanOrEqual(100);
				expect(score.citation_accuracy).toBeGreaterThanOrEqual(0);
				expect(score.citation_accuracy).toBeLessThanOrEqual(100);
			}

			// ── Knowledge Summary ──
			expect(result.comparison.knowledge_summary.track).toBe("knowledge");
			expect(result.comparison.knowledge_summary.avg_citation_rate).toBeGreaterThan(0);
			expect(result.comparison.knowledge_summary.avg_accuracy_rate).toBeGreaterThan(0);

			// ── Web Search Summary ──
			expect(result.comparison.web_search_summary).not.toBeNull();
			expect(result.comparison.web_search_summary!.track).toBe("web_search");

			// ── No provider errors ──
			expect(Object.keys(result.provider_errors)).toHaveLength(0);

			// ── Stats ──
			expect(result.providers_used).toHaveLength(3);
			expect(result.stats.total_probes_run).toBe(8 * 3 * 2); // 8 probes × 3 providers × 2 tracks
		});
	});

	describe("E2E: 4 providers with hallucinated data (meta)", () => {
		it("detects hallucinated provider and scores it lowest", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [
					makeProvider("openai", "gpt-4o"),
					makeProvider("anthropic", "claude-sonnet-4-6"),
					makeProvider("google", "gemini-2.0-flash"),
					makeProvider("meta", "llama-3.3-70b"),
				],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: {
					openai: openaiMockLLM(),
					anthropic: anthropicMockLLM(),
					google: googleMockLLM(),
					meta: metaMockLLM(),
				},
				delayMs: 0,
			});

			expect(result.knowledge_results).toHaveLength(4);

			// Meta should NOT have web search results (doesn't support it)
			const wsProviders = result.web_search_results.map((r) => r.provider_id);
			expect(wsProviders).not.toContain("meta");
			expect(result.web_search_results).toHaveLength(3); // openai, anthropic, google

			// Meta should have knowledge results
			const metaKnowledge = result.knowledge_results.find((r) => r.provider_id === "meta");
			expect(metaKnowledge).toBeTruthy();

			// Meta should have lowest accuracy in llm_breakdown
			const breakdown = result.comparison.llm_breakdown;
			expect(breakdown.meta).toBeDefined();
			expect(breakdown.meta.citation_accuracy).toBeLessThanOrEqual(
				breakdown.openai.citation_accuracy,
			);

			// InfoRecognitionItems should have hallucinated entries for meta
			const items = result.comparison.info_recognition_items;
			const metaHallucinated = items.flatMap((item) =>
				item.llm_results.filter((r) => r.llm_service === "meta" && r.accuracy === "hallucinated"),
			);
			expect(metaHallucinated.length).toBeGreaterThan(0);

			// hallucinated → recognized: false
			for (const h of metaHallucinated) {
				expect(h.recognized).toBe(false);
			}
		});
	});

	describe("web_search flag propagation", () => {
		it("passes web_search: true to providers on web_search track", async () => {
			const openaiLLM = vi.fn(async (req: LLMRequest) =>
				makeLLMResponse("Response from openai", "openai", "gpt-4o"),
			);

			await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: openaiLLM },
				delayMs: 0,
			});

			const calls = openaiLLM.mock.calls;

			// Should have both knowledge calls (web_search: undefined) and web_search calls (web_search: true)
			const knowledgeCalls = calls.filter(([req]: [LLMRequest]) => req.web_search === undefined);
			const webSearchCalls = calls.filter(([req]: [LLMRequest]) => req.web_search === true);

			expect(knowledgeCalls.length).toBe(8); // 8 probes, knowledge track
			expect(webSearchCalls.length).toBe(8); // 8 probes, web_search track
		});

		it("does not pass web_search to meta provider", async () => {
			const metaLLM = vi.fn(async (req: LLMRequest) =>
				makeLLMResponse("Response from meta", "meta", "llama-3.3-70b"),
			);

			await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o"), makeProvider("meta", "llama-3.3-70b")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: {
					openai: openaiMockLLM(),
					meta: metaLLM,
				},
				delayMs: 0,
			});

			// Meta should only get knowledge calls (no web_search calls)
			const metaCalls = metaLLM.mock.calls;
			expect(metaCalls.length).toBe(8); // only knowledge track
			for (const [req] of metaCalls as [LLMRequest][]) {
				expect(req.web_search).toBeUndefined();
			}
		});
	});

	describe("GeoScorePerLLM accuracy calculation", () => {
		it("correctly maps AccuracyLevel to numeric scores", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o"), makeProvider("meta", "llama-3.3-70b")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: {
					openai: openaiMockLLM(),
					meta: metaMockLLM(),
				},
				delayMs: 0,
			});

			const breakdown = result.comparison.llm_breakdown;

			// OpenAI (exact=1.0) should have citation_accuracy ~100
			expect(breakdown.openai.citation_accuracy).toBeGreaterThanOrEqual(80);

			// Meta (hallucinated=0.0 for key facts, approximate=0.7 for others)
			// Should be significantly lower than OpenAI
			expect(breakdown.meta.citation_accuracy).toBeLessThan(breakdown.openai.citation_accuracy);
		});
	});

	describe("InfoRecognitionItem correct population", () => {
		it("populates all fields correctly for each fact × provider", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: openaiMockLLM() },
				delayMs: 0,
			});

			const items = result.comparison.info_recognition_items;
			expect(items.length).toBeGreaterThan(0);

			for (const item of items) {
				// info_id should be a valid UUID
				expect(item.info_id).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				// category should be valid
				expect([
					"PRODUCT_LIST",
					"PRODUCT_DETAIL",
					"PRICING",
					"FEATURE",
					"AVAILABILITY",
					"CONTACT",
					"POLICY",
					"STAT",
					"COMPARISON",
					"CUSTOM",
				]).toContain(item.category);
				// label and expected_value should be non-empty
				expect(item.label.length).toBeGreaterThan(0);
				expect(item.expected_value.length).toBeGreaterThan(0);

				// Each llm_result should have correct structure
				for (const lr of item.llm_results) {
					expect(lr.llm_service).toBe("openai");
					expect(typeof lr.recognized).toBe("boolean");
					expect(["exact", "approximate", "outdated", "hallucinated", "missing"]).toContain(
						lr.accuracy,
					);
					// recognized should align with accuracy
					if (
						lr.accuracy === "exact" ||
						lr.accuracy === "approximate" ||
						lr.accuracy === "outdated"
					) {
						expect(lr.recognized).toBe(true);
					}
					if (lr.accuracy === "missing" || lr.accuracy === "hallucinated") {
						expect(lr.recognized).toBe(false);
					}
				}
			}
		});
	});

	describe("Edge cases", () => {
		it("handles all providers failing gracefully", async () => {
			const failingLLM: ChatLLMFn = vi.fn(async () => {
				throw new Error("Connection refused");
			});

			// All providers' probes fail, but runProbesForProvider still returns results with errors
			// compareThreeLayers should still work with empty responses
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: failingLLM },
				delayMs: 0,
			});

			// Should still complete — probes have errors but results exist
			expect(result.knowledge_results).toHaveLength(1);
			const kr = result.knowledge_results[0];
			expect(kr.probes.every((p) => p.error)).toBe(true);
		});

		it("handles empty JSON-LD (facts from meta/claims only)", async () => {
			const crawlNoJsonLd: CrawlData = {
				...realisticCrawlData,
				json_ld: [],
			};

			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: crawlNoJsonLd,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: openaiMockLLM() },
				delayMs: 0,
			});

			// Facts should still exist (from product_info, marketing_claims, meta description)
			expect(result.fact_set.facts.length).toBeGreaterThan(0);

			// No json_ld source facts
			const jsonLdFacts = result.fact_set.facts.filter((f) => f.source === "json_ld");
			// specs_in_schema comes from evalData which has source "json_ld"
			// but no Product/ItemList/Organization from crawlData.json_ld
			const htmlFacts = result.fact_set.facts.filter((f) => f.source === "html_text");
			expect(htmlFacts.length).toBeGreaterThan(0);

			const metaFacts = result.fact_set.facts.filter((f) => f.source === "meta_tag");
			expect(metaFacts.length).toBeGreaterThan(0);
		});

		it("handles judge LLM returning invalid results for some facts", async () => {
			let factCallCount = 0;
			const partialFailJudge: ChatLLMFn = vi.fn(async (req: LLMRequest) => {
				if (req.prompt.includes("Ground Truth Fact")) {
					factCallCount++;
					// Fail every 3rd fact judgment
					if (factCallCount % 3 === 0) {
						return makeLLMResponse("not valid json at all", "openai", "gpt-4o");
					}
					return makeLLMResponse(
						JSON.stringify({
							results: [
								{
									provider_id: "openai",
									accuracy: "exact",
									llm_answer: "test",
									detail: "ok",
								},
							],
						}),
						"openai",
						"gpt-4o",
					);
				}
				// Citations
				return makeLLMResponse(
					JSON.stringify({
						citations: { openai: { cited_count: 4, total: 8 } },
					}),
					"openai",
					"gpt-4o",
				);
			});

			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: partialFailJudge,
				chatLLMOverrides: { openai: openaiMockLLM() },
				delayMs: 0,
			});

			// Should complete despite partial judge failures
			expect(result.comparison.info_recognition_items.length).toBe(result.fact_set.facts.length);

			// Failed judgments should default to "missing"
			const missingItems = result.comparison.info_recognition_items.filter((item) =>
				item.llm_results.some((r) => r.accuracy === "missing"),
			);
			expect(missingItems.length).toBeGreaterThan(0);

			// Non-failed judgments should have "exact"
			const exactItems = result.comparison.info_recognition_items.filter((item) =>
				item.llm_results.some((r) => r.accuracy === "exact"),
			);
			expect(exactItems.length).toBeGreaterThan(0);
		});

		it("handles crawl data with only meta description (minimal facts)", async () => {
			const minimalCrawl: CrawlData = {
				...realisticCrawlData,
				json_ld: [],
				title: "Simple Page",
			};
			const minimalEval: FactExtractionInput = {
				product_info: [],
				marketing_claims: [],
			};

			const result = await runMultiProviderProbes({
				context: { ...realisticContext, site_name: "Simple Page" },
				crawlData: minimalCrawl,
				evalData: minimalEval,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: openaiMockLLM() },
				delayMs: 0,
			});

			// Only meta description fact
			expect(result.fact_set.facts.length).toBeGreaterThanOrEqual(1);
			expect(result.fact_set.facts[0].source).toBe("meta_tag");

			// Pipeline should still complete
			expect(result.comparison.info_recognition_items.length).toBe(result.fact_set.facts.length);
		});
	});

	describe("provider_errors collection", () => {
		it("records provider_errors when provider initialization fails", async () => {
			// Provider with missing API key → createProviderChatLLM will throw
			const noKeyProvider: LLMProviderSettings = {
				...makeProvider("anthropic", "claude-sonnet-4-6"),
				api_key: "", // empty key → should fail initialization
			};

			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o"), noKeyProvider],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: {
					openai: openaiMockLLM(),
					// no override for anthropic → createProviderChatLLM with empty key
				},
				delayMs: 0,
			});

			// anthropic should have initialization error
			expect(result.provider_errors.anthropic).toBeDefined();
			expect(result.provider_errors.anthropic).toContain("초기화 실패");

			// openai should work fine
			expect(result.provider_errors.openai).toBeUndefined();
			expect(result.providers_used).toContain("openai");
			expect(result.providers_used).not.toContain("anthropic");
		});

		it("provider_errors is empty when all providers succeed", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: openaiMockLLM() },
				delayMs: 0,
			});

			expect(Object.keys(result.provider_errors)).toHaveLength(0);
		});
	});

	describe("Layer comparison summaries", () => {
		it("L0 vs L2: knowledge summary reflects accuracy variance across providers", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [
					makeProvider("openai", "gpt-4o"),
					makeProvider("anthropic", "claude-sonnet-4-6"),
				],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: {
					openai: openaiMockLLM(),
					anthropic: anthropicMockLLM(),
				},
				delayMs: 0,
			});

			const ks = result.comparison.knowledge_summary;

			// OpenAI should have higher accuracy than anthropic
			expect(ks.accuracy_rates.openai).toBeGreaterThanOrEqual(ks.accuracy_rates.anthropic);

			// OpenAI should have higher citation rate
			expect(ks.citation_rates.openai).toBeGreaterThan(ks.citation_rates.anthropic);

			// Averages should be between individual values
			expect(ks.avg_citation_rate).toBeGreaterThan(0);
			expect(ks.avg_accuracy_rate).toBeGreaterThan(0);
		});

		it("L0 vs L1: web search summary available when web search probes run", async () => {
			const result = await runMultiProviderProbes({
				context: realisticContext,
				crawlData: realisticCrawlData,
				evalData: realisticEvalData,
				providers: [makeProvider("openai", "gpt-4o")],
				judgeLLM: realisticJudgeLLM(),
				chatLLMOverrides: { openai: openaiMockLLM() },
				delayMs: 0,
			});

			const ws = result.comparison.web_search_summary;
			expect(ws).not.toBeNull();
			expect(ws!.track).toBe("web_search");
			expect(ws!.citation_rates.openai).toBeDefined();
			expect(ws!.avg_citation_rate).toBeGreaterThanOrEqual(0);
		});
	});
});
