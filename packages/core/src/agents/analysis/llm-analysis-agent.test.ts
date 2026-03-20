import { describe, it, expect, vi } from "vitest";
import { resolveModel, type LLMAnalysisResult } from "./llm-analysis-agent.js";

describe("LLM Analysis Agent", () => {
	describe("resolveModel", () => {
		it("should throw when no provider with API key is configured", () => {
			// Use a temp dir with no config files — ProviderConfigManager returns defaults (no API keys)
			expect(() => resolveModel("/tmp/nonexistent-workspace")).toThrow("No LLM provider");
		});
	});

	describe("LLMAnalysisResult type contract", () => {
		it("should have mandatory richReport field", () => {
			const mockResult: LLMAnalysisResult = {
				output: {} as any,
				richReport: {
					target: { url: "https://example.com", title: "Test", site_type: "generic", site_type_confidence: 0.8, analyzed_at: new Date().toISOString() },
					overall_score: 65,
					grade: "Needs Improvement",
					overview: { summary_cards: [], dimensions: [], llm_accessibility: [], strengths: [], weaknesses: [], opportunities: [] },
					crawlability: { bot_policies: [], blocked_paths: [], allowed_paths: [], llms_txt: { exists: false, urls_checked: [], content_preview: null }, robots_txt_ai_section: null },
					structured_data: { page_quality: [], schema_analysis: [], schema_counts: {} },
					products: { category_scores: [], product_lists: [], spec_recognition: [] },
					brand: { dimensions: [], claims: [] },
					pages: { pages: [] },
					recommendations: { high_priority: [], medium_priority: [], low_priority: [], competitive_comparison: null },
					evidence: { sections: [], schema_implementation_matrix: [], js_dependency_details: [], claim_verifications: [] },
					probes: null,
					roadmap: { consumer_scenarios: [], vulnerability_scores: [], opportunity_matrix: [] },
				},
				llmAssessment: "Good GEO readiness",
				agentLoopResult: { finalText: "{}", messages: [], iterations: 5, totalUsage: { input: 100, output: 200, totalTokens: 300 }, totalCost: 0.01, completed: true, toolCallLog: [] },
				toolCallLog: [
					{ name: "crawl_page", args: { url: "https://example.com" }, result: "{}" },
					{ name: "score_geo", args: { crawl_data_key: "homepage" }, result: "{}" },
				],
			};

			// richReport is NOT null — it's mandatory
			expect(mockResult.richReport).toBeTruthy();
			expect(mockResult.richReport.overall_score).toBe(65);
			expect(mockResult.richReport.overview).toBeTruthy();
			expect(mockResult.richReport.crawlability).toBeTruthy();
			expect(mockResult.richReport.structured_data).toBeTruthy();
			expect(mockResult.richReport.products).toBeTruthy();
			expect(mockResult.richReport.brand).toBeTruthy();
			expect(mockResult.richReport.pages).toBeTruthy();
			expect(mockResult.richReport.recommendations).toBeTruthy();
			expect(mockResult.richReport.evidence).toBeTruthy();
			expect(mockResult.richReport.roadmap).toBeTruthy();
			expect(mockResult.toolCallLog).toHaveLength(2);
		});
	});
});
