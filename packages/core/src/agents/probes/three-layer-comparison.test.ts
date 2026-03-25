import { describe, expect, it, vi } from "vitest";
import type { LLMResponse } from "../../llm/geo-llm-client.js";
import type { Fact, FactSet } from "./fact-set.js";
import type { ChatLLMFn, ProviderProbeResult, SingleProbeResult } from "./provider-probe-runner.js";
import { compareThreeLayers, judgeCitations, judgeFact } from "./three-layer-comparison.js";

// ── Helpers ─────────────────────────────────────────────────

function mockLLMResponse(content: string): LLMResponse {
	return {
		content,
		model: "judge-model",
		provider: "openai",
		usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
		latency_ms: 150,
		cost_usd: 0.002,
	};
}

function makeProbe(overrides?: Partial<SingleProbeResult>): SingleProbeResult {
	return {
		probe_id: "P-01",
		probe_name: "Test Probe",
		category: "accuracy",
		query: "What is X?",
		response: "X is a product.",
		latency_ms: 200,
		...overrides,
	};
}

function makeProviderResult(
	providerId: string,
	track: "knowledge" | "web_search",
	probes: SingleProbeResult[],
): ProviderProbeResult {
	return {
		provider_id: providerId,
		model: `${providerId}-model`,
		track,
		probes,
	};
}

const testFact: Fact = {
	fact_id: "550e8400-e29b-41d4-a716-446655440000",
	category: "PRICING",
	label: "Price: Widget Pro",
	expected_value: "USD 99.99",
	source: "json_ld",
};

const testFactSet: FactSet = {
	site_name: "TestCo",
	site_url: "https://www.testco.com",
	brand: "TestCo",
	facts: [testFact],
	extracted_at: "2026-01-01T00:00:00Z",
};

// ── Tests ───────────────────────────────────────────────────

describe("three-layer-comparison", () => {
	describe("judgeFact", () => {
		it("returns accuracy levels from judge LLM", async () => {
			const judgeLLM: ChatLLMFn = vi.fn(async () =>
				mockLLMResponse(
					JSON.stringify({
						results: [
							{
								provider_id: "openai",
								accuracy: "exact",
								llm_answer: "USD 99.99",
								detail: "Exact match",
							},
							{
								provider_id: "anthropic",
								accuracy: "missing",
								llm_answer: null,
								detail: "Not mentioned",
							},
						],
					}),
				),
			);

			const results = await judgeFact(
				testFact,
				[
					{ provider_id: "openai", response: "The Widget Pro costs USD 99.99" },
					{ provider_id: "anthropic", response: "I don't have pricing information" },
				],
				judgeLLM,
			);

			expect(results).toHaveLength(2);
			expect(results[0].provider_id).toBe("openai");
			expect(results[0].accuracy).toBe("exact");
			expect(results[1].provider_id).toBe("anthropic");
			expect(results[1].accuracy).toBe("missing");
		});

		it("defaults to missing on parse error", async () => {
			const judgeLLM: ChatLLMFn = vi.fn(async () => mockLLMResponse("not valid json"));

			const results = await judgeFact(
				testFact,
				[{ provider_id: "openai", response: "Some response" }],
				judgeLLM,
			);

			expect(results[0].accuracy).toBe("missing");
			expect(results[0].detail).toContain("parse error");
		});

		it("returns empty array for no providers", async () => {
			const judgeLLM: ChatLLMFn = vi.fn();
			const results = await judgeFact(testFact, [], judgeLLM);
			expect(results).toEqual([]);
			expect(judgeLLM).not.toHaveBeenCalled();
		});
	});

	describe("judgeCitations", () => {
		it("returns citation rates per provider", async () => {
			const judgeLLM: ChatLLMFn = vi.fn(async () =>
				mockLLMResponse(
					JSON.stringify({
						citations: {
							openai: { cited_count: 3, total: 4 },
							anthropic: { cited_count: 1, total: 4 },
						},
					}),
				),
			);

			const result = await judgeCitations(
				"https://www.testco.com",
				"TestCo",
				"TestCo",
				[
					{ provider_id: "openai", responses: ["r1", "r2", "r3", "r4"] },
					{ provider_id: "anthropic", responses: ["r1", "r2", "r3", "r4"] },
				],
				judgeLLM,
			);

			expect(result.openai).toBe(0.75);
			expect(result.anthropic).toBe(0.25);
		});

		it("returns 0 on parse error", async () => {
			const judgeLLM: ChatLLMFn = vi.fn(async () => mockLLMResponse("invalid"));

			const result = await judgeCitations(
				"https://www.testco.com",
				"TestCo",
				"TestCo",
				[{ provider_id: "openai", responses: ["r1"] }],
				judgeLLM,
			);

			expect(result.openai).toBe(0);
		});
	});

	describe("compareThreeLayers", () => {
		it("produces InfoRecognitionItems and llm_breakdown", async () => {
			let callCount = 0;
			const judgeLLM: ChatLLMFn = vi.fn(async (req) => {
				callCount++;
				// First call: judgeFact
				if (req.prompt.includes("Ground Truth Fact")) {
					return mockLLMResponse(
						JSON.stringify({
							results: [
								{ provider_id: "openai", accuracy: "exact", llm_answer: "USD 99.99", detail: "ok" },
							],
						}),
					);
				}
				// Second call: judgeCitations
				return mockLLMResponse(
					JSON.stringify({
						citations: {
							openai: { cited_count: 5, total: 8 },
						},
					}),
				);
			});

			const knowledgeResults: ProviderProbeResult[] = [
				makeProviderResult("openai", "knowledge", [
					makeProbe({ response: "Widget Pro costs USD 99.99 at TestCo" }),
					makeProbe({ probe_id: "P-02", response: "TestCo offers great products" }),
				]),
			];

			const result = await compareThreeLayers(testFactSet, knowledgeResults, [], judgeLLM);

			// InfoRecognitionItems
			expect(result.info_recognition_items).toHaveLength(1);
			const item = result.info_recognition_items[0];
			expect(item.info_id).toBe(testFact.fact_id);
			expect(item.category).toBe("PRICING");
			expect(item.llm_results).toHaveLength(1);
			expect(item.llm_results[0].llm_service).toBe("openai");
			expect(item.llm_results[0].accuracy).toBe("exact");
			expect(item.llm_results[0].recognized).toBe(true);

			// llm_breakdown
			expect(result.llm_breakdown.openai).toBeDefined();
			expect(result.llm_breakdown.openai.llm_service).toBe("openai");
			expect(result.llm_breakdown.openai.citation_rate).toBeGreaterThan(0);
			expect(result.llm_breakdown.openai.citation_accuracy).toBe(100); // exact = 1.0

			// knowledge_summary
			expect(result.knowledge_summary.track).toBe("knowledge");
			expect(result.knowledge_summary.avg_citation_rate).toBeGreaterThan(0);

			// No web search results
			expect(result.web_search_summary).toBeNull();
		});

		it("handles multiple providers", async () => {
			const judgeLLM: ChatLLMFn = vi.fn(async (req) => {
				if (req.prompt.includes("Ground Truth Fact")) {
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
				return mockLLMResponse(
					JSON.stringify({
						citations: {
							openai: { cited_count: 4, total: 8 },
							anthropic: { cited_count: 2, total: 8 },
						},
					}),
				);
			});

			const knowledgeResults: ProviderProbeResult[] = [
				makeProviderResult("openai", "knowledge", [
					makeProbe({ response: "Widget Pro is USD 99.99" }),
				]),
				makeProviderResult("anthropic", "knowledge", [
					makeProbe({ response: "I think the price is around $100" }),
				]),
			];

			const result = await compareThreeLayers(testFactSet, knowledgeResults, [], judgeLLM);

			expect(Object.keys(result.llm_breakdown)).toHaveLength(2);
			expect(result.llm_breakdown.openai.citation_accuracy).toBe(100);
			expect(result.llm_breakdown.anthropic.citation_accuracy).toBe(70); // approximate = 0.7
		});

		it("includes web_search_summary when web search results provided", async () => {
			const judgeLLM: ChatLLMFn = vi.fn(async (req) => {
				if (req.prompt.includes("Ground Truth Fact")) {
					return mockLLMResponse(
						JSON.stringify({
							results: [
								{ provider_id: "openai", accuracy: "exact", llm_answer: "99.99", detail: "ok" },
							],
						}),
					);
				}
				return mockLLMResponse(
					JSON.stringify({
						citations: {
							openai: { cited_count: 6, total: 8 },
						},
					}),
				);
			});

			const knowledgeResults: ProviderProbeResult[] = [
				makeProviderResult("openai", "knowledge", [makeProbe()]),
			];
			const webSearchResults: ProviderProbeResult[] = [
				makeProviderResult("openai", "web_search", [
					makeProbe({ response: "According to testco.com, Widget Pro costs USD 99.99" }),
				]),
			];

			const result = await compareThreeLayers(
				testFactSet,
				knowledgeResults,
				webSearchResults,
				judgeLLM,
			);

			expect(result.web_search_summary).not.toBeNull();
			expect(result.web_search_summary!.track).toBe("web_search");
			expect(result.web_search_summary!.citation_rates.openai).toBeGreaterThan(0);
		});

		it("handles empty facts gracefully", async () => {
			const judgeLLM: ChatLLMFn = vi.fn();
			const emptyFactSet: FactSet = {
				...testFactSet,
				facts: [],
			};

			const knowledgeResults: ProviderProbeResult[] = [
				makeProviderResult("openai", "knowledge", [makeProbe()]),
			];

			const result = await compareThreeLayers(emptyFactSet, knowledgeResults, [], judgeLLM);

			expect(result.info_recognition_items).toHaveLength(0);
			expect(result.llm_breakdown.openai).toBeDefined();
			expect(result.llm_breakdown.openai.citation_accuracy).toBe(0);
		});
	});
});
