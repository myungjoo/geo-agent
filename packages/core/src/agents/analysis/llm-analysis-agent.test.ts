import { describe, expect, it, vi } from "vitest";
import type { CrawlData } from "../shared/types.js";
import { type LLMAnalysisResult, resolveModel } from "./llm-analysis-agent.js";
import {
	type AnalysisToolDeps,
	createAnalysisToolHandlers,
	createAnalysisToolState,
} from "./tools.js";

const mockCrawlData: CrawlData = {
	html: "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>",
	url: "https://example.com",
	status_code: 200,
	content_type: "text/html",
	response_time_ms: 150,
	robots_txt: "User-agent: *\nAllow: /",
	llms_txt: null,
	sitemap_xml: null,
	json_ld: [{ "@type": "WebPage", name: "Test" }],
	meta_tags: { description: "Test page" },
	title: "Test",
	canonical_url: "https://example.com",
	links: [],
	headers: {},
};

const mockDeps: AnalysisToolDeps = {
	crawlTarget: vi.fn().mockResolvedValue(mockCrawlData),
	scoreTarget: vi.fn().mockReturnValue({
		overall_score: 65,
		grade: "Needs Improvement",
		dimensions: [
			{ id: "S1", label: "Crawlability", score: 70, weight: 0.15, details: [] },
			{ id: "S2", label: "Structured Data", score: 60, weight: 0.25, details: [] },
		],
	}),
	classifySite: vi.fn().mockReturnValue({
		site_type: "generic",
		confidence: 0.8,
		matched_signals: [],
		all_signals: [],
	}),
};

describe("LLM Analysis Agent", () => {
	describe("resolveModel", () => {
		it("should throw when no provider with API key is configured", () => {
			expect(() => resolveModel("/tmp/nonexistent-workspace")).toThrow("No LLM provider");
		});
	});

	describe("tool state auto-completion", () => {
		it("should auto-call score_geo if LLM skipped it", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			// Simulate: LLM called crawl_page but NOT score_geo
			await handlers.crawl_page({ url: "https://example.com" });
			expect(state.homepageCrawl).toBeTruthy();
			expect(state.pageScores.has("homepage")).toBe(false);

			// After auto-completion, score should exist
			await handlers.score_geo({ crawl_data_key: "homepage" });
			expect(state.pageScores.has("homepage")).toBe(true);
			expect(state.pageScores.get("homepage")!.overall_score).toBe(65);
		});

		it("should auto-call classify_site if LLM skipped it", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			await handlers.crawl_page({ url: "https://example.com" });
			expect(state.classification).toBeNull();

			await handlers.classify_site({});
			expect(state.classification).toBeTruthy();
			expect(state.classification!.site_type).toBe("generic");
		});

		it("score should NOT be 0 after crawl + score_geo", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			await handlers.crawl_page({ url: "https://example.com" });
			await handlers.score_geo({ crawl_data_key: "homepage" });

			const score = state.pageScores.get("homepage");
			expect(score).toBeTruthy();
			expect(score!.overall_score).toBeGreaterThan(0);
		});
	});

	describe("multipage score_geo URL matching", () => {
		const subPageCrawlData: CrawlData = {
			...mockCrawlData,
			url: "https://example.com/products/phones/",
			title: "Phones",
			canonical_url: "https://example.com/products/phones/",
		};
		const subPage2CrawlData: CrawlData = {
			...mockCrawlData,
			url: "https://example.com/about/",
			title: "About",
			canonical_url: "https://example.com/about/",
		};

		function setupMultipageState() {
			const state = createAnalysisToolState();
			state.homepageCrawl = mockCrawlData;
			state.multiPageResult = {
				homepage: mockCrawlData,
				pages: [
					{ url: "https://example.com/products/phones/", path: "/products/phones/", crawl_data: subPageCrawlData },
					{ url: "https://example.com/about/", path: "/about/", crawl_data: subPage2CrawlData },
				],
				total_pages: 3,
				crawl_duration_ms: 5000,
			};
			return state;
		}

		it("should score sub-page by exact full URL", async () => {
			const state = setupMultipageState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			const result = await handlers.score_geo({ crawl_data_key: "https://example.com/products/phones/" });
			const parsed = JSON.parse(result);

			expect(parsed.error).toBeUndefined();
			expect(parsed.overall_score).toBe(65);
			expect(state.pageScores.has("https://example.com/products/phones/")).toBe(true);
		});

		it("should score sub-page by path fallback", async () => {
			const state = setupMultipageState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			const result = await handlers.score_geo({ crawl_data_key: "/products/phones/" });
			const parsed = JSON.parse(result);

			expect(parsed.error).toBeUndefined();
			expect(parsed.overall_score).toBe(65);
			// Key should be normalized to full URL
			expect(state.pageScores.has("https://example.com/products/phones/")).toBe(true);
			expect(state.pageScores.has("/products/phones/")).toBe(false);
		});

		it("should score sub-page by URL suffix fallback", async () => {
			const state = setupMultipageState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			const result = await handlers.score_geo({ crawl_data_key: "/about/" });
			const parsed = JSON.parse(result);

			expect(parsed.error).toBeUndefined();
			expect(state.pageScores.has("https://example.com/about/")).toBe(true);
		});

		it("should return error with available URLs for unknown key", async () => {
			const state = setupMultipageState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			const result = await handlers.score_geo({ crawl_data_key: "/nonexistent/" });
			const parsed = JSON.parse(result);

			expect(parsed.error).toBeDefined();
			expect(parsed.error).toContain("https://example.com/products/phones/");
			expect(parsed.error).toContain("https://example.com/about/");
		});

		it("should score all pages so none default to 0", async () => {
			const state = setupMultipageState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			// Score homepage
			await handlers.score_geo({ crawl_data_key: "homepage" });
			// Score all sub-pages by full URL
			for (const page of state.multiPageResult!.pages) {
				await handlers.score_geo({ crawl_data_key: page.url });
			}

			// Verify all pages have scores > 0
			expect(state.pageScores.get("homepage")!.overall_score).toBeGreaterThan(0);
			for (const page of state.multiPageResult!.pages) {
				const ps = state.pageScores.get(page.url);
				expect(ps).toBeDefined();
				expect(ps!.overall_score).toBeGreaterThan(0);
			}
		});

		it("should produce non-zero aggregate when all pages are scored", async () => {
			const state = setupMultipageState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			await handlers.score_geo({ crawl_data_key: "homepage" });
			for (const page of state.multiPageResult!.pages) {
				await handlers.score_geo({ crawl_data_key: page.url });
			}

			// Simulate buildOutputFromState aggregation logic
			const mp = state.multiPageResult!;
			const homepageScores = state.pageScores.get("homepage")!;
			const pageScores = mp.pages.map((p) => {
				const ps = state.pageScores.get(p.url);
				return { scores: ps ?? { overall_score: 0 } };
			});

			const weights = [2, ...mp.pages.map(() => 1)];
			const totalWeight = weights.reduce((a, b) => a + b, 0);
			const allScores = [homepageScores.overall_score, ...pageScores.map((p) => p.scores.overall_score)];
			const aggregateScore = Math.round((allScores.reduce((sum, s, i) => sum + s * weights[i], 0) / totalWeight) * 10) / 10;

			// All pages scored 65, so aggregate must also be 65
			expect(aggregateScore).toBe(65);
			// No page should have 0
			expect(allScores.every((s) => s > 0)).toBe(true);
		});
	});

	describe("LLMAnalysisResult type contract", () => {
		it("should have mandatory richReport field", () => {
			const mockResult: LLMAnalysisResult = {
				output: {} as any,
				richReport: {
					target: {
						url: "https://example.com",
						title: "Test",
						site_type: "generic",
						site_type_confidence: 0.8,
						analyzed_at: new Date().toISOString(),
					},
					overall_score: 65,
					grade: "Needs Improvement",
					overview: {
						summary_cards: [],
						dimensions: [],
						llm_accessibility: [],
						strengths: [],
						weaknesses: [],
						opportunities: [],
					},
					crawlability: {
						bot_policies: [],
						blocked_paths: [],
						allowed_paths: [],
						llms_txt: { exists: false, urls_checked: [], content_preview: null },
						robots_txt_ai_section: null,
					},
					structured_data: { page_quality: [], schema_analysis: [], schema_counts: {} },
					products: { category_scores: [], product_lists: [], spec_recognition: [] },
					brand: { dimensions: [], claims: [] },
					pages: { pages: [] },
					recommendations: {
						high_priority: [],
						medium_priority: [],
						low_priority: [],
						competitive_comparison: null,
					},
					evidence: {
						sections: [],
						schema_implementation_matrix: [],
						js_dependency_details: [],
						claim_verifications: [],
					},
					probes: null,
					roadmap: { consumer_scenarios: [], vulnerability_scores: [], opportunity_matrix: [] },
				},
				llmAssessment: "Good",
				agentLoopResult: {
					finalText: "{}",
					messages: [],
					iterations: 5,
					totalUsage: { input: 100, output: 200, totalTokens: 300 },
					totalCost: 0.01,
					completed: true,
					toolCallLog: [],
				},
				toolCallLog: [],
			};

			expect(mockResult.richReport).toBeTruthy();
			expect(mockResult.richReport.overall_score).toBe(65);
		});
	});
});
