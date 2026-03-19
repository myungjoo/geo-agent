import { describe, expect, it, vi } from "vitest";
import { type AnalysisInput, type AnalysisOutput, runAnalysis } from "./analysis-agent.js";
import type { CrawlData } from "./types.js";

// ── Mock CrawlData ──────────────────────────────────────────

function makeCrawlData(overrides: Partial<CrawlData> = {}): CrawlData {
	return {
		html: `<html lang="ko"><head>
			<title>Samsung Galaxy S25 | Samsung</title>
			<meta name="description" content="Galaxy S25 specs and pricing">
			<meta property="og:title" content="Galaxy S25">
			<meta property="og:site_name" content="Samsung">
			<script type="application/ld+json">{"@type":"Product","name":"Galaxy S25"}</script>
			<script type="application/ld+json">{"@type":"Organization","name":"Samsung"}</script>
		</head><body>
			<nav>Navigation</nav>
			<header>Header</header>
			<main><article>
				<h1>Galaxy S25 Ultra</h1>
				<h2>Specs</h2>
				<table><tr><td>Weight</td><td>218g</td></tr></table>
				<p>Price: $1,299.99</p>
				<p>Display: 6.9" QHD+ 3120x1440px</p>
			</article></main>
			<footer>Footer</footer>
		</body></html>`,
		url: "https://www.samsung.com/galaxy-s25/",
		status_code: 200,
		content_type: "text/html",
		response_time_ms: 400,
		robots_txt: "User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /",
		llms_txt: null,
		sitemap_xml: "<urlset><url><loc>https://www.samsung.com/</loc></url></urlset>",
		json_ld: [
			{ "@type": "Product", name: "Galaxy S25" },
			{ "@type": "Organization", name: "Samsung" },
		],
		meta_tags: {
			description: "Galaxy S25 specs and pricing",
			"og:title": "Galaxy S25",
			"og:site_name": "Samsung",
		},
		title: "Samsung Galaxy S25 | Samsung",
		canonical_url: "https://www.samsung.com/galaxy-s25/",
		links: [
			{ href: "/products", rel: "", text: "Products" },
			{ href: "/about", rel: "", text: "About" },
		],
		headers: { "content-type": "text/html; charset=utf-8" },
		...overrides,
	};
}

// ── Mock Dependencies ───────────────────────────────────────

function makeDeps(crawlOverrides?: Partial<CrawlData>) {
	const crawlData = makeCrawlData(crawlOverrides);
	return {
		crawlTarget: vi.fn().mockResolvedValue(crawlData),
		scoreTarget: vi.fn().mockReturnValue({
			overall_score: 71,
			grade: "Needs Improvement",
			dimensions: [
				{
					id: "S1",
					label: "크롤링 접근성",
					score: 55,
					weight: 0.15,
					details: ["robots.txt found"],
				},
				{ id: "S2", label: "구조화 데이터", score: 85, weight: 0.25, details: ["JSON-LD found"] },
				{ id: "S3", label: "기계가독성", score: 70, weight: 0.2, details: ["H1 found"] },
				{ id: "S4", label: "팩트 밀도", score: 75, weight: 0.1, details: ["Numbers found"] },
				{ id: "S5", label: "브랜드 메시지", score: 100, weight: 0.1, details: ["Brand schema"] },
				{ id: "S6", label: "AI 인프라", score: 30, weight: 0.1, details: ["No llms.txt"] },
				{ id: "S7", label: "네비게이션", score: 70, weight: 0.1, details: ["Nav found"] },
			],
		}),
		classifySite: vi.fn().mockReturnValue({
			site_type: "manufacturer",
			confidence: 0.75,
			matched_signals: ["Product JSON-LD", "Price info"],
			all_signals: [
				{ site_type: "manufacturer", confidence: 0.75, signals: ["Product JSON-LD"] },
				{ site_type: "research", confidence: 0, signals: [] },
				{ site_type: "generic", confidence: 0.25, signals: [] },
			],
		}),
		_crawlData: crawlData,
	};
}

const defaultInput: AnalysisInput = {
	target_id: "target-001",
	target_url: "https://www.samsung.com/galaxy-s25/",
};

// ── Tests ───────────────────────────────────────────────────

describe("Analysis Agent", () => {
	describe("runAnalysis — basic execution", () => {
		it("returns AnalysisOutput with all required fields", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);

			expect(result).toHaveProperty("report");
			expect(result).toHaveProperty("crawl_data");
			expect(result).toHaveProperty("classification");
			expect(result).toHaveProperty("geo_scores");
		});

		it("calls crawlTarget with correct URL and timeout", async () => {
			const deps = makeDeps();
			await runAnalysis({ ...defaultInput, crawl_timeout: 20000 }, deps);

			expect(deps.crawlTarget).toHaveBeenCalledWith("https://www.samsung.com/galaxy-s25/", 20000);
		});

		it("uses default crawl timeout of 15000ms", async () => {
			const deps = makeDeps();
			await runAnalysis(defaultInput, deps);

			expect(deps.crawlTarget).toHaveBeenCalledWith("https://www.samsung.com/galaxy-s25/", 15000);
		});

		it("calls classifySite with crawled HTML and URL", async () => {
			const deps = makeDeps();
			await runAnalysis(defaultInput, deps);

			expect(deps.classifySite).toHaveBeenCalledWith(deps._crawlData.html, deps._crawlData.url);
		});

		it("calls scoreTarget with crawl data", async () => {
			const deps = makeDeps();
			await runAnalysis(defaultInput, deps);

			expect(deps.scoreTarget).toHaveBeenCalledWith(deps._crawlData);
		});
	});

	describe("runAnalysis — AnalysisReport structure", () => {
		it("report has valid UUID report_id", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.report_id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
		});

		it("report has correct target_id and url", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.target_id).toBe("target-001");
			expect(result.report.url).toBe("https://www.samsung.com/galaxy-s25/");
		});

		it("report has analyzed_at timestamp", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.analyzed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("report.machine_readability has correct grade", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			// 71 score → "B" grade
			expect(result.report.machine_readability.grade).toBe("B");
		});

		it("report.machine_readability.crawler_access reflects crawl status", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			const access = result.report.machine_readability.crawler_access;
			expect(access).toHaveLength(1);
			expect(access[0].http_status).toBe(200);
			expect(access[0].content_accessible).toBe(true);
		});

		it("report.structured_data detects JSON-LD", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.structured_data.json_ld_present).toBe(true);
			expect(result.report.structured_data.json_ld_types).toContain("Product");
			expect(result.report.structured_data.json_ld_types).toContain("Organization");
		});

		it("report.structured_data detects OG tags", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.structured_data.og_tags_present).toBe(true);
		});

		it("report.structured_data has meta description", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.structured_data.meta_description).toBe("Galaxy S25 specs and pricing");
		});

		it("report.content_analysis has word count", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.content_analysis.word_count).toBeGreaterThan(0);
		});

		it("report.current_geo_score has structured_score from S2", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.current_geo_score.structured_score).toBe(85);
		});

		it("report.current_geo_score.total matches overall score", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.current_geo_score.total).toBe(71);
		});

		it("LLM-dependent fields default to 0", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.current_geo_score.citation_rate).toBe(0);
			expect(result.report.current_geo_score.citation_accuracy).toBe(0);
			expect(result.report.current_geo_score.rank_position).toBe(0);
		});
	});

	describe("runAnalysis — classification passthrough", () => {
		it("returns classification result", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.classification.site_type).toBe("manufacturer");
			expect(result.classification.confidence).toBe(0.75);
			expect(result.classification.matched_signals).toHaveLength(2);
		});
	});

	describe("runAnalysis — geo_scores passthrough", () => {
		it("returns dimension scores", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(result.geo_scores.overall_score).toBe(71);
			expect(result.geo_scores.grade).toBe("Needs Improvement");
			expect(result.geo_scores.dimensions).toHaveLength(7);
		});
	});

	describe("runAnalysis — edge cases", () => {
		it("handles crawl failure by propagating error", async () => {
			const deps = makeDeps();
			deps.crawlTarget = vi.fn().mockRejectedValue(new Error("Network timeout"));

			await expect(runAnalysis(defaultInput, deps)).rejects.toThrow("Network timeout");
		});

		it("handles page with no JSON-LD", async () => {
			const deps = makeDeps({ json_ld: [], meta_tags: {} });
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.structured_data.json_ld_present).toBe(false);
			expect(result.report.structured_data.json_ld_types).toEqual([]);
			expect(result.report.structured_data.og_tags_present).toBe(false);
		});

		it("handles HTTP error status", async () => {
			const deps = makeDeps({ status_code: 403 });
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.machine_readability.crawler_access[0].http_status).toBe(403);
			expect(result.report.machine_readability.crawler_access[0].content_accessible).toBe(false);
		});

		it("handles minimal HTML", async () => {
			const deps = makeDeps({
				html: "<html><body>Hello</body></html>",
				json_ld: [],
				meta_tags: {},
			});
			const result = await runAnalysis(defaultInput, deps);
			expect(result.report.content_analysis.word_count).toBeGreaterThan(0);
			expect(result.report.structured_data.json_ld_present).toBe(false);
		});

		it("generates unique report_id each call", async () => {
			const deps = makeDeps();
			const r1 = await runAnalysis(defaultInput, deps);
			const r2 = await runAnalysis(defaultInput, deps);
			expect(r1.report.report_id).not.toBe(r2.report.report_id);
		});
	});

	describe("runAnalysis — structure quality computation", () => {
		it("detects semantic HTML tags", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			// Mock HTML has nav, header, main, article, footer = 5/7
			expect(
				result.report.machine_readability.structure_quality.semantic_tag_ratio,
			).toBeGreaterThan(0.5);
		});

		it("detects heading hierarchy", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			// Has h1 and h2
			expect(result.report.machine_readability.structure_quality.heading_hierarchy_valid).toBe(
				true,
			);
		});

		it("computes text-to-markup ratio", async () => {
			const deps = makeDeps();
			const result = await runAnalysis(defaultInput, deps);
			expect(
				result.report.machine_readability.structure_quality.text_to_markup_ratio,
			).toBeGreaterThan(0);
			expect(result.report.machine_readability.structure_quality.text_to_markup_ratio).toBeLessThan(
				1,
			);
		});
	});
});

describe("Analysis Agent — with LLM content quality assessment", () => {
	const mockLLMAssessment = {
		brand_recognition: {
			score: 80,
			identified_brand: "Test Corp",
			identified_products: ["Product A"],
			reasoning: "Found brand in title",
		},
		content_quality: {
			score: 65,
			clarity: 70,
			completeness: 60,
			factual_density: 55,
			reasoning: "Good structure",
		},
		information_gaps: [
			{ category: "pricing", description: "No price info", importance: "high" as const },
		],
		llm_consumption_issues: [{ issue: "No JSON-LD", recommendation: "Add structured data" }],
		overall_assessment: "Decent page with room for improvement",
	};

	function makeLLMResponse(content: string) {
		return {
			content,
			model: "gpt-4o",
			provider: "openai",
			usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
			latency_ms: 300,
			cost_usd: 0.02,
		};
	}

	it("includes llm_assessment when chatLLM provided", async () => {
		const deps = makeDeps();
		const chatLLM = vi.fn().mockResolvedValue(makeLLMResponse(JSON.stringify(mockLLMAssessment)));
		const depsWithLLM = { ...deps, chatLLM };

		const result = await runAnalysis(defaultInput, depsWithLLM);

		expect(result.llm_assessment).not.toBeNull();
		expect(result.llm_assessment!.brand_recognition.score).toBe(80);
		expect(result.llm_assessment!.brand_recognition.identified_brand).toBe("Test Corp");
		expect(result.llm_assessment!.content_quality.score).toBe(65);
		expect(result.llm_assessment!.information_gaps).toHaveLength(1);
		expect(result.llm_assessment!.information_gaps[0].category).toBe("pricing");
		expect(result.llm_assessment!.llm_consumption_issues).toHaveLength(1);
		expect(result.llm_assessment!.overall_assessment).toBe("Decent page with room for improvement");
		expect(chatLLM).toHaveBeenCalledOnce();
	});

	it("llm_assessment is null when chatLLM not provided", async () => {
		const deps = makeDeps();
		const result = await runAnalysis(defaultInput, deps);
		expect(result.llm_assessment).toBeNull();
	});

	it("llm_assessment is null when chatLLM fails", async () => {
		const deps = makeDeps();
		const chatLLM = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));
		const depsWithLLM = { ...deps, chatLLM };

		const result = await runAnalysis(defaultInput, depsWithLLM);
		expect(result.llm_assessment).toBeNull();
		// Should still have all other fields
		expect(result.report).toBeDefined();
		expect(result.geo_scores).toBeDefined();
	});
});

describe("Analysis Agent — smoke test with real classifySite", () => {
	it("works with actual classifySite implementation", async () => {
		const { classifySite } = await import("../prompts/template-engine.js");

		const crawlData = makeCrawlData();
		const deps = {
			crawlTarget: vi.fn().mockResolvedValue(crawlData),
			scoreTarget: vi.fn().mockReturnValue({
				overall_score: 65,
				grade: "Needs Improvement",
				dimensions: [
					{ id: "S1", label: "크롤링", score: 50, weight: 0.15, details: [] },
					{ id: "S2", label: "구조화", score: 80, weight: 0.25, details: [] },
					{ id: "S3", label: "가독성", score: 60, weight: 0.2, details: [] },
					{ id: "S4", label: "팩트", score: 70, weight: 0.1, details: [] },
					{ id: "S5", label: "브랜드", score: 90, weight: 0.1, details: [] },
					{ id: "S6", label: "AI", score: 20, weight: 0.1, details: [] },
					{ id: "S7", label: "네비게이션", score: 60, weight: 0.1, details: [] },
				],
			}),
			classifySite,
		};

		const result = await runAnalysis(defaultInput, deps);

		expect(result.report.report_id).toBeTruthy();
		// Real classifySite should detect manufacturer (Product JSON-LD in mock HTML)
		expect(result.classification.site_type).toBe("manufacturer");
		expect(result.classification.confidence).toBeGreaterThan(0);
	});
});
