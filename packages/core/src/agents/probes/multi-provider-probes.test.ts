import { describe, expect, it, vi } from "vitest";
import type { LLMResponse } from "../../llm/geo-llm-client.js";
import type { LLMProviderSettings } from "../../llm/provider-config.js";
import type { CrawlData } from "../shared/types.js";
import type { FactExtractionInput } from "./fact-set.js";
import { runMultiProviderProbes } from "./multi-provider-probes.js";
import type { ChatLLMFn } from "./provider-probe-runner.js";
import type { ProbeContext } from "./synthetic-probes.js";

// ── Fixtures ────────────────────────────────────────────────

function mockLLMResponse(content: string): LLMResponse {
	return {
		content,
		model: "test-model",
		provider: "openai",
		usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
		latency_ms: 100,
		cost_usd: 0.001,
	};
}

const testContext: ProbeContext = {
	site_name: "TestCo",
	site_url: "https://www.testco.com",
	site_type: "manufacturer",
	topics: ["electronics"],
	products: ["Widget Pro"],
	prices: ["$99.99"],
	brand: "TestCo",
};

const testCrawlData: CrawlData = {
	html: "<html><head><title>TestCo</title></head><body>TestCo Widget Pro $99.99</body></html>",
	url: "https://www.testco.com",
	status_code: 200,
	content_type: "text/html",
	response_time_ms: 100,
	robots_txt: null,
	llms_txt: null,
	sitemap_xml: null,
	json_ld: [
		{
			"@type": "Product",
			name: "Widget Pro",
			offers: { price: "99.99", priceCurrency: "USD" },
		},
	],
	meta_tags: { description: "TestCo makes the best Widget Pro for everyone." },
	title: "TestCo - Widget Pro",
	canonical_url: null,
	links: [],
	headers: {},
};

const testEvalData: FactExtractionInput = {
	product_info: [],
	marketing_claims: [],
};

function makeProvider(id: string): LLMProviderSettings {
	return {
		provider_id: id as any,
		display_name: id,
		enabled: true,
		auth_method: "api_key",
		api_key: `sk-${id}-test`,
		default_model: `${id}-model`,
		available_models: [`${id}-model`],
		max_tokens: 4096,
		temperature: 0.3,
		rate_limit_rpm: 60,
	};
}

function makeJudgeLLM(): ChatLLMFn {
	return vi.fn(async (req) => {
		if (req.prompt.includes("Ground Truth Fact")) {
			// judgeFact response
			return mockLLMResponse(
				JSON.stringify({
					results: [
						{ provider_id: "openai", accuracy: "exact", llm_answer: "99.99", detail: "ok" },
						{
							provider_id: "anthropic",
							accuracy: "approximate",
							llm_answer: "~100",
							detail: "close",
						},
					],
				}),
			);
		}
		// judgeCitations response
		return mockLLMResponse(
			JSON.stringify({
				citations: {
					openai: { cited_count: 5, total: 8 },
					anthropic: { cited_count: 3, total: 8 },
				},
			}),
		);
	});
}

function makeMockChatLLM(providerId: string): ChatLLMFn {
	return vi.fn(async () =>
		mockLLMResponse(`This is a response from ${providerId} about TestCo Widget Pro.`),
	);
}

// ── Tests ───────────────────────────────────────────────────

describe("multi-provider-probes", () => {
	describe("runMultiProviderProbes — basic", () => {
		it("runs probes for multiple providers and returns full result", async () => {
			const result = await runMultiProviderProbes({
				context: testContext,
				crawlData: testCrawlData,
				evalData: testEvalData,
				providers: [makeProvider("openai"), makeProvider("anthropic")],
				judgeLLM: makeJudgeLLM(),
				chatLLMOverrides: {
					openai: makeMockChatLLM("openai"),
					anthropic: makeMockChatLLM("anthropic"),
				},
				delayMs: 0,
			});

			// FactSet
			expect(result.fact_set.facts.length).toBeGreaterThan(0);
			expect(result.fact_set.brand).toBe("TestCo");

			// Knowledge results
			expect(result.knowledge_results).toHaveLength(2);
			expect(result.knowledge_results[0].track).toBe("knowledge");

			// Web search results (openai + anthropic both support it)
			expect(result.web_search_results).toHaveLength(2);
			expect(result.web_search_results[0].track).toBe("web_search");

			// Comparison
			expect(result.comparison.info_recognition_items.length).toBeGreaterThan(0);
			expect(Object.keys(result.comparison.llm_breakdown).length).toBeGreaterThan(0);

			// Providers used
			expect(result.providers_used).toContain("openai");
			expect(result.providers_used).toContain("anthropic");

			// No provider errors in success case
			expect(Object.keys(result.provider_errors)).toHaveLength(0);

			// Stats
			expect(result.stats.total_probes_run).toBeGreaterThan(0);
			expect(result.stats.duration_ms).toBeGreaterThanOrEqual(0);
		});
	});

	describe("runMultiProviderProbes — single provider", () => {
		it("works with a single provider", async () => {
			const result = await runMultiProviderProbes({
				context: testContext,
				crawlData: testCrawlData,
				evalData: testEvalData,
				providers: [makeProvider("openai")],
				judgeLLM: makeJudgeLLM(),
				chatLLMOverrides: {
					openai: makeMockChatLLM("openai"),
				},
				delayMs: 0,
			});

			expect(result.knowledge_results).toHaveLength(1);
			expect(result.providers_used).toEqual(["openai"]);
		});
	});

	describe("runMultiProviderProbes — web search filtering", () => {
		it("excludes meta from web search probes", async () => {
			const result = await runMultiProviderProbes({
				context: testContext,
				crawlData: testCrawlData,
				evalData: testEvalData,
				providers: [makeProvider("openai"), makeProvider("meta")],
				judgeLLM: makeJudgeLLM(),
				chatLLMOverrides: {
					openai: makeMockChatLLM("openai"),
					meta: makeMockChatLLM("meta"),
				},
				delayMs: 0,
			});

			// Both run knowledge probes
			expect(result.knowledge_results).toHaveLength(2);

			// Only openai runs web search (meta doesn't support it)
			expect(result.web_search_results).toHaveLength(1);
			expect(result.web_search_results[0].provider_id).toBe("openai");
		});
	});

	describe("runMultiProviderProbes — error handling", () => {
		it("throws when no providers available", async () => {
			await expect(
				runMultiProviderProbes({
					context: testContext,
					crawlData: testCrawlData,
					evalData: testEvalData,
					providers: [],
					judgeLLM: makeJudgeLLM(),
					delayMs: 0,
				}),
			).rejects.toThrow("No active providers");
		});

		it("continues when one provider fails", async () => {
			const failingLLM: ChatLLMFn = vi.fn(async () => {
				throw new Error("API key invalid");
			});

			const result = await runMultiProviderProbes({
				context: testContext,
				crawlData: testCrawlData,
				evalData: testEvalData,
				providers: [makeProvider("openai"), makeProvider("anthropic")],
				judgeLLM: makeJudgeLLM(),
				chatLLMOverrides: {
					openai: makeMockChatLLM("openai"),
					anthropic: failingLLM,
				},
				delayMs: 0,
			});

			// openai results should still be present
			expect(result.knowledge_results.length).toBeGreaterThanOrEqual(1);
			// anthropic probes have errors but the provider result still exists
			const anthropicResult = result.knowledge_results.find((r) => r.provider_id === "anthropic");
			if (anthropicResult) {
				expect(anthropicResult.probes.every((p) => p.error)).toBe(true);
			}
		});
	});

	describe("runMultiProviderProbes — fact extraction", () => {
		it("extracts facts from JSON-LD in crawl data", async () => {
			const result = await runMultiProviderProbes({
				context: testContext,
				crawlData: testCrawlData,
				evalData: testEvalData,
				providers: [makeProvider("openai")],
				judgeLLM: makeJudgeLLM(),
				chatLLMOverrides: { openai: makeMockChatLLM("openai") },
				delayMs: 0,
			});

			// Should have Product fact from JSON-LD
			const productFact = result.fact_set.facts.find(
				(f) => f.category === "PRODUCT_DETAIL" && f.expected_value === "Widget Pro",
			);
			expect(productFact).toBeTruthy();

			// Should have Price fact from JSON-LD
			const priceFact = result.fact_set.facts.find((f) => f.category === "PRICING");
			expect(priceFact).toBeTruthy();
		});
	});
});
