import { describe, it, expect, vi } from "vitest";
import {
	ANALYSIS_TOOLS,
	createAnalysisToolHandlers,
	createAnalysisToolState,
	type AnalysisToolDeps,
} from "./tools.js";
import type { CrawlData } from "../shared/types.js";

// ── Mock Data ──────────────────────────────────────────────

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
	meta_tags: { description: "Test page", "og:title": "Test" },
	title: "Test",
	canonical_url: "https://example.com",
	links: [{ href: "/about", rel: "", text: "About" }],
	headers: { "content-type": "text/html" },
};

const mockDeps: AnalysisToolDeps = {
	crawlTarget: vi.fn().mockResolvedValue(mockCrawlData),
	scoreTarget: vi.fn().mockReturnValue({
		overall_score: 65,
		grade: "Needs Improvement",
		dimensions: [
			{ id: "S1", label: "LLM Crawlability", score: 70, weight: 0.15, details: ["robots.txt OK"] },
			{ id: "S2", label: "Structured Data", score: 60, weight: 0.25, details: ["1 JSON-LD block"] },
		],
	}),
	classifySite: vi.fn().mockReturnValue({
		site_type: "generic",
		confidence: 0.8,
		matched_signals: ["no-product-pages"],
		all_signals: [],
	}),
};

// ── Tests ──────────────────────────────────────────────────

describe("ANALYSIS_TOOLS", () => {
	it("should define 9 tools", () => {
		expect(ANALYSIS_TOOLS).toHaveLength(9);
	});

	it("should have correct tool names", () => {
		const names = ANALYSIS_TOOLS.map((t) => t.name);
		expect(names).toContain("crawl_page");
		expect(names).toContain("crawl_multiple_pages");
		expect(names).toContain("score_geo");
		expect(names).toContain("classify_site");
		expect(names).toContain("extract_evaluation_data");
		expect(names).toContain("run_synthetic_probes");
		expect(names).toContain("analyze_brand_message");
		expect(names).toContain("analyze_product_recognition");
		expect(names).toContain("collect_evidence");
	});

	it("each tool should have description and parameters", () => {
		for (const tool of ANALYSIS_TOOLS) {
			expect(tool.description).toBeTruthy();
			expect(tool.parameters).toBeTruthy();
		}
	});
});

describe("createAnalysisToolState", () => {
	it("should create empty state", () => {
		const state = createAnalysisToolState();
		expect(state.homepageCrawl).toBeNull();
		expect(state.multiPageResult).toBeNull();
		expect(state.pageScores.size).toBe(0);
		expect(state.classification).toBeNull();
		expect(state.evalData).toBeNull();
		expect(state.probeResults).toBeNull();
	});
});

describe("createAnalysisToolHandlers", () => {
	it("should create handlers for all 9 tools", () => {
		const state = createAnalysisToolState();
		const handlers = createAnalysisToolHandlers(mockDeps, state);
		expect(Object.keys(handlers)).toHaveLength(9);
		expect(handlers.crawl_page).toBeTypeOf("function");
		expect(handlers.score_geo).toBeTypeOf("function");
		expect(handlers.classify_site).toBeTypeOf("function");
	});

	describe("crawl_page handler", () => {
		it("should crawl and store result in state", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.crawl_page({ url: "https://example.com" });
			const parsed = JSON.parse(result);

			expect(parsed.url).toBe("https://example.com");
			expect(parsed.status_code).toBe(200);
			expect(parsed.title).toBe("Test");
			expect(parsed.json_ld_count).toBe(1);
			expect(parsed.has_robots_txt).toBe(true);
			expect(state.homepageCrawl).toBe(mockCrawlData);
		});

		it("should include robots.txt excerpt", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.crawl_page({ url: "https://example.com" });
			const parsed = JSON.parse(result);
			expect(parsed.robots_txt_excerpt).toContain("User-agent");
		});
	});

	describe("score_geo handler", () => {
		it("should return error if no crawl data", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.score_geo({ crawl_data_key: "homepage" });
			const parsed = JSON.parse(result);
			expect(parsed.error).toBeTruthy();
		});

		it("should score homepage after crawl", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			await handlers.crawl_page({ url: "https://example.com" });
			const result = await handlers.score_geo({ crawl_data_key: "homepage" });
			const parsed = JSON.parse(result);

			expect(parsed.overall_score).toBe(65);
			expect(parsed.grade).toBe("Needs Improvement");
			expect(parsed.dimensions).toHaveLength(2);
			expect(state.pageScores.has("homepage")).toBe(true);
		});
	});

	describe("classify_site handler", () => {
		it("should classify after crawl", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			await handlers.crawl_page({ url: "https://example.com" });
			const result = await handlers.classify_site({});
			const parsed = JSON.parse(result);

			expect(parsed.site_type).toBe("generic");
			expect(parsed.confidence).toBe(0.8);
			expect(state.classification).toBeTruthy();
		});
	});

	describe("extract_evaluation_data handler", () => {
		it("should extract eval data after crawl + score", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);

			await handlers.crawl_page({ url: "https://example.com" });
			await handlers.score_geo({ crawl_data_key: "homepage" });
			const result = await handlers.extract_evaluation_data({});
			const parsed = JSON.parse(result);

			expect(parsed.bot_policies).toBeInstanceOf(Array);
			expect(parsed.schema_coverage).toBeInstanceOf(Array);
			expect(state.evalData).toBeTruthy();
		});
	});

	describe("crawl_multiple_pages handler", () => {
		it("should return error if not available", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.crawl_multiple_pages({ url: "https://example.com" });
			const parsed = JSON.parse(result);
			expect(parsed.error).toContain("not available");
		});

		it("should work when crawlMultiplePages is provided", async () => {
			const multiDeps: AnalysisToolDeps = {
				...mockDeps,
				crawlMultiplePages: vi.fn().mockResolvedValue({
					homepage: mockCrawlData,
					pages: [
						{ url: "https://example.com/about", path: "about.html", crawl_data: mockCrawlData },
					],
					total_pages: 2,
					crawl_duration_ms: 1200,
				}),
			};
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(multiDeps, state);
			const result = await handlers.crawl_multiple_pages({ url: "https://example.com" });
			const parsed = JSON.parse(result);

			expect(parsed.total_pages).toBe(2);
			expect(parsed.pages).toHaveLength(1);
			expect(state.multiPageResult).toBeTruthy();
		});
	});

	describe("run_synthetic_probes handler", () => {
		it("should return error if no chatLLM", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.run_synthetic_probes({
				site_name: "Test",
				topics: ["testing"],
			});
			const parsed = JSON.parse(result);
			expect(parsed.error).toContain("LLM not available");
		});
	});

	describe("analyze_brand_message handler", () => {
		it("should return error if no crawl data", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.analyze_brand_message({});
			expect(JSON.parse(result).error).toBeTruthy();
		});

		it("should extract brand dimensions after crawl", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			await handlers.crawl_page({ url: "https://example.com" });
			const result = await handlers.analyze_brand_message({});
			const parsed = JSON.parse(result);
			expect(parsed.dimensions).toBeInstanceOf(Array);
			expect(parsed.dimensions.length).toBeGreaterThan(0);
			expect(parsed.claims).toBeInstanceOf(Array);
		});
	});

	describe("analyze_product_recognition handler", () => {
		it("should return error if no crawl data", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.analyze_product_recognition({});
			expect(JSON.parse(result).error).toBeTruthy();
		});

		it("should produce category scores after crawl", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			await handlers.crawl_page({ url: "https://example.com" });
			const result = await handlers.analyze_product_recognition({});
			const parsed = JSON.parse(result);
			expect(parsed.category_scores).toBeInstanceOf(Array);
			expect(parsed.product_lists).toBeInstanceOf(Array);
			expect(parsed.spec_recognition).toBeInstanceOf(Array);
		});
	});

	describe("collect_evidence handler", () => {
		it("should return error if no crawl data", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			const result = await handlers.collect_evidence({});
			expect(JSON.parse(result).error).toBeTruthy();
		});

		it("should collect evidence sections after crawl", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			await handlers.crawl_page({ url: "https://example.com" });
			const result = await handlers.collect_evidence({});
			const parsed = JSON.parse(result);
			expect(parsed.sections).toBeInstanceOf(Array);
			expect(parsed.sections.length).toBeGreaterThan(0);
			expect(parsed.schema_implementation_matrix).toBeInstanceOf(Array);
			expect(parsed.js_dependency_details).toBeInstanceOf(Array);
		});

		it("should include llms.txt evidence", async () => {
			const state = createAnalysisToolState();
			const handlers = createAnalysisToolHandlers(mockDeps, state);
			await handlers.crawl_page({ url: "https://example.com" });
			const result = await handlers.collect_evidence({});
			const parsed = JSON.parse(result);
			const llmsSection = parsed.sections.find((s: any) => s.id === "E-1");
			expect(llmsSection).toBeTruthy();
			expect(llmsSection.title).toContain("llms.txt");
		});
	});
});
