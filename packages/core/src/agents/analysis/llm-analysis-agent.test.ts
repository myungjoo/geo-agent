import { describe, it, expect, vi } from "vitest";
import { runAnalysisWithLLM, type LLMAnalysisResult } from "./llm-analysis-agent.js";
import type { AnalysisDeps } from "./analysis-agent.js";
import type { CrawlData } from "../shared/types.js";

// ── Mock Data ──────────────────────────────────────────────

const mockCrawlData: CrawlData = {
	html: `<html>
<head>
	<title>Samsung Galaxy S25</title>
	<meta name="description" content="Samsung Galaxy S25 specs">
	<meta property="og:title" content="Galaxy S25">
	<script type="application/ld+json">{"@type": "Product", "name": "Galaxy S25"}</script>
</head>
<body>
	<h1>Samsung Galaxy S25</h1>
	<article>
		<section>
			<h2>Specifications</h2>
			<p>6.2 inch display, 128GB storage, 50MP camera</p>
		</section>
	</article>
</body>
</html>`,
	url: "https://www.samsung.com",
	status_code: 200,
	content_type: "text/html",
	response_time_ms: 200,
	robots_txt: "User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /",
	llms_txt: null,
	sitemap_xml: "<urlset><url><loc>https://www.samsung.com/</loc></url></urlset>",
	json_ld: [{ "@type": "Product", name: "Galaxy S25" }],
	meta_tags: { description: "Samsung Galaxy S25 specs", "og:title": "Galaxy S25" },
	title: "Samsung Galaxy S25",
	canonical_url: "https://www.samsung.com",
	links: [{ href: "/products", rel: "", text: "Products" }],
	headers: { "content-type": "text/html" },
};

const mockDeps: AnalysisDeps = {
	crawlTarget: vi.fn().mockResolvedValue(mockCrawlData),
	scoreTarget: vi.fn().mockReturnValue({
		overall_score: 65,
		grade: "Needs Improvement",
		dimensions: [
			{ id: "S1", label: "LLM Crawlability", score: 70, weight: 0.15, details: ["robots.txt OK"] },
			{ id: "S2", label: "Structured Data", score: 55, weight: 0.25, details: ["1 JSON-LD block"] },
			{ id: "S3", label: "Content Readability", score: 60, weight: 0.20, details: ["H1 present"] },
			{ id: "S4", label: "Fact Density", score: 50, weight: 0.10, details: [] },
			{ id: "S5", label: "Brand Message", score: 40, weight: 0.10, details: [] },
			{ id: "S6", label: "AI Infrastructure", score: 30, weight: 0.10, details: [] },
			{ id: "S7", label: "Navigation", score: 45, weight: 0.10, details: [] },
		],
	}),
	classifySite: vi.fn().mockReturnValue({
		site_type: "manufacturer",
		confidence: 0.6,
		matched_signals: ["has-product-schema"],
		all_signals: [],
	}),
};

// ── Tests ──────────────────────────────────────────────────

describe("runAnalysisWithLLM", () => {
	describe("without LLM config (rule-based)", () => {
		it("should run rule-based analysis", async () => {
			const result = await runAnalysisWithLLM(
				{ target_id: "t1", target_url: "https://www.samsung.com" },
				mockDeps,
			);

			expect(result.usedLLMAgent).toBe(false);
			expect(result.llmAssessment).toBeNull();
			expect(result.agentLoopResult).toBeNull();
			expect(result.toolCallLog).toEqual([]);
			expect(result.output).toBeTruthy();
			expect(result.output.geo_scores.overall_score).toBe(65);
		});

		it("should produce valid AnalysisOutput", async () => {
			const result = await runAnalysisWithLLM(
				{ target_id: "t1", target_url: "https://www.samsung.com" },
				mockDeps,
			);

			const output = result.output;
			expect(output.report).toBeTruthy();
			expect(output.report.target_id).toBe("t1");
			expect(output.crawl_data).toBeTruthy();
			expect(output.classification.site_type).toBe("manufacturer");
			expect(output.geo_scores.dimensions).toHaveLength(7);
			expect(output.eval_data).toBeTruthy();
		});
	});

	describe("LLMAnalysisResult structure", () => {
		it("should have correct fields", () => {
			const mockResult: LLMAnalysisResult = {
				output: {} as any,
				usedLLMAgent: true,
				llmAssessment: "Good GEO readiness",
				agentLoopResult: null,
				toolCallLog: [
					{ name: "crawl_page", args: { url: "https://example.com" }, result: "{}" },
				],
			};

			expect(mockResult.usedLLMAgent).toBe(true);
			expect(mockResult.toolCallLog).toHaveLength(1);
			expect(mockResult.toolCallLog[0].name).toBe("crawl_page");
		});
	});
});
