import { describe, expect, it } from "vitest";
import type { CrawlData } from "./types.js";
import {
	type BotPolicyEntry,
	analyzePathAccess,
	extractGeoEvaluationData,
	extractMarketingClaims,
	extractProductInfo,
	extractSchemaCoverage,
	generateFindings,
	generateImprovements,
	parseRobotsTxt,
} from "./geo-eval-extractor.js";

// ── Helper: minimal CrawlData ──────────────────────────

function makeCrawlData(overrides: Partial<CrawlData> = {}): CrawlData {
	return {
		html: "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>",
		url: "https://example.com",
		status_code: 200,
		content_type: "text/html",
		response_time_ms: 100,
		robots_txt: null,
		llms_txt: null,
		sitemap_xml: null,
		json_ld: [],
		meta_tags: {},
		title: "Test",
		canonical_url: null,
		links: [],
		headers: {},
		...overrides,
	};
}

// ── parseRobotsTxt ──────────────────────────────────────

describe("parseRobotsTxt", () => {
	it("returns not_specified for all bots when robotsTxt is null", () => {
		const result = parseRobotsTxt(null);
		expect(result).toHaveLength(8);
		for (const bot of result) {
			expect(bot.status).toBe("not_specified");
		}
	});

	it("detects allowed bots", () => {
		const robots = `User-agent: GPTBot\nAllow: /\n`;
		const result = parseRobotsTxt(robots);
		const gptBot = result.find((b) => b.bot_name === "GPTBot");
		expect(gptBot?.status).toBe("allowed");
	});

	it("detects blocked bots", () => {
		const robots = `User-agent: ClaudeBot\nDisallow: /\n`;
		const result = parseRobotsTxt(robots);
		const claude = result.find((b) => b.bot_name === "ClaudeBot");
		expect(claude?.status).toBe("blocked");
	});

	it("detects partial access", () => {
		const robots = `User-agent: GPTBot\nDisallow: /search/\nDisallow: /private/\n`;
		const result = parseRobotsTxt(robots);
		const gptBot = result.find((b) => b.bot_name === "GPTBot");
		expect(gptBot?.status).toBe("partial");
		expect(gptBot?.disallowed_paths).toContain("/search/");
	});
});

// ── extractSchemaCoverage ──────────────────────────────

describe("extractSchemaCoverage", () => {
	it("detects JSON-LD schema types", () => {
		const pages = [
			{
				url: "https://example.com",
				filename: "index.html",
				crawl_data: makeCrawlData({
					json_ld: [{ "@type": "Organization", name: "Test Corp" }],
				}),
			},
		];
		const result = extractSchemaCoverage(pages);
		const org = result.find((s) => s.schema_type === "Organization");
		expect(org?.present).toBe(true);
		expect(org?.pages).toContain("index.html");
	});

	it("reports missing schemas", () => {
		const pages = [
			{ url: "https://example.com", filename: "index.html", crawl_data: makeCrawlData() },
		];
		const result = extractSchemaCoverage(pages);
		const product = result.find((s) => s.schema_type === "Product");
		expect(product?.present).toBe(false);
		expect(product?.quality).toBe("none");
	});
});

// ── extractProductInfo ──────────────────────────────────

describe("extractProductInfo", () => {
	it("extracts product from JSON-LD", () => {
		const data = makeCrawlData({
			json_ld: [
				{
					"@type": "Product",
					name: "Galaxy S26",
					offers: { price: "1199.99", priceCurrency: "USD" },
					aggregateRating: { ratingValue: "4.5", reviewCount: "1200" },
				},
			],
		});
		const result = extractProductInfo(data);
		expect(result.product_name).toBe("Galaxy S26");
		expect(result.prices).toContain("USD 1199.99");
		expect(result.has_aggregate_rating).toBe(true);
		expect(result.rating_value).toBe("4.5");
	});

	it("extracts HTML spec patterns", () => {
		const data = makeCrawlData({
			html: '<html><body>Camera: 200 MP, Battery: 5000 mAh, Display: 6.8" display</body></html>',
		});
		const result = extractProductInfo(data);
		expect(result.specs_in_html.length).toBeGreaterThan(0);
	});
});

// ── extractMarketingClaims ──────────────────────────────

describe("extractMarketingClaims", () => {
	it("detects superlative claims", () => {
		const html =
			"<html><body>We are the world's first to bring AI to every device. Award-winning design.</body></html>";
		const result = extractMarketingClaims(html, "https://example.com");
		expect(result.length).toBeGreaterThanOrEqual(1);
	});

	it("returns empty for clean content", () => {
		const html = "<html><body>This product weighs 180g and has a 6.1 inch display.</body></html>";
		const result = extractMarketingClaims(html, "https://example.com");
		expect(result.length).toBe(0);
	});
});

// ── generateFindings ────────────────────────────────────

describe("generateFindings", () => {
	const botPolicies: BotPolicyEntry[] = [
		{ bot_name: "GPTBot", service: "ChatGPT", status: "allowed", disallowed_paths: [] },
		{ bot_name: "ClaudeBot", service: "Claude", status: "not_specified", disallowed_paths: [] },
		{
			bot_name: "PerplexityBot",
			service: "Perplexity",
			status: "partial",
			disallowed_paths: ["/search/"],
		},
		{ bot_name: "Google-Extended", service: "Gemini", status: "allowed", disallowed_paths: [] },
	];

	it("generates strengths for allowed bots", () => {
		const result = generateFindings(
			botPolicies,
			{ exists: false, content_preview: null },
			[
				{
					schema_type: "Organization",
					present: true,
					pages: ["index.html"],
					quality: "good",
					details: "Found",
				},
			],
			[],
			{
				script_count: 5,
				external_scripts: 3,
				inline_scripts: 2,
				frameworks_detected: [],
				estimated_js_dependency: 0.2,
			},
			[],
		);
		expect(result.strengths.length).toBeGreaterThan(0);
		expect(result.strengths.some((s) => s.title.includes("AI 봇 허용"))).toBe(true);
	});

	it("generates weaknesses for missing llms.txt", () => {
		const result = generateFindings(
			botPolicies,
			{ exists: false, content_preview: null },
			[],
			[],
			{
				script_count: 50,
				external_scripts: 30,
				inline_scripts: 20,
				frameworks_detected: ["React/Next.js"],
				estimated_js_dependency: 0.8,
			},
			[],
		);
		expect(result.weaknesses.some((w) => w.title.includes("llms.txt"))).toBe(true);
		expect(result.weaknesses.some((w) => w.title.includes("JavaScript"))).toBe(true);
	});

	it("generates opportunities for missing schemas", () => {
		const schemas = [
			{
				schema_type: "Product",
				present: false,
				pages: [],
				quality: "none" as const,
				details: "Not implemented",
			},
			{
				schema_type: "Offer",
				present: false,
				pages: [],
				quality: "none" as const,
				details: "Not implemented",
			},
		];
		const result = generateFindings(
			botPolicies,
			{ exists: false, content_preview: null },
			schemas,
			[],
			{
				script_count: 5,
				external_scripts: 3,
				inline_scripts: 2,
				frameworks_detected: [],
				estimated_js_dependency: 0.2,
			},
			[],
		);
		expect(result.opportunities.some((o) => o.title.includes("Product Schema"))).toBe(true);
		expect(result.opportunities.some((o) => o.title.includes("llms.txt"))).toBe(true);
	});
});

// ── analyzePathAccess ──────────────────────────────────

describe("analyzePathAccess", () => {
	it("returns empty for null robotsTxt", () => {
		const result = analyzePathAccess(null);
		expect(result).toEqual([]);
	});

	it("extracts paths from AI bot blocks", () => {
		const robots = `User-agent: GPTBot\nDisallow: /search/\nAllow: /products/\n`;
		const result = analyzePathAccess(robots);
		expect(result).toContainEqual({ path: "/search/", status: "blocked" });
		expect(result).toContainEqual({ path: "/products/", status: "allowed" });
	});
});

// ── extractGeoEvaluationData (integration) ─────────────

describe("extractGeoEvaluationData", () => {
	it("produces complete evaluation data structure", () => {
		const homepage = makeCrawlData({
			robots_txt: "User-agent: GPTBot\nAllow: /\n",
			json_ld: [{ "@type": "Organization", name: "Test Corp" }],
		});
		const subPages = [
			{
				url: "https://example.com/product",
				filename: "product.html",
				crawl_data: makeCrawlData({
					json_ld: [
						{ "@type": "Product", name: "Widget", offers: { price: "99", priceCurrency: "USD" } },
					],
				}),
			},
		];
		const dimensions = [
			{ id: "S1", label: "Crawlability", score: 62 },
			{ id: "S2", label: "Structure", score: 30 },
		];
		const result = extractGeoEvaluationData(homepage, subPages, dimensions);

		expect(result.bot_policies).toHaveLength(8);
		expect(result.llms_txt.exists).toBe(false);
		expect(result.schema_coverage.length).toBeGreaterThan(0);
		expect(result.product_info.length).toBe(2); // homepage + 1 sub-page
		expect(result.strengths).toBeDefined();
		expect(result.weaknesses).toBeDefined();
		expect(result.opportunities).toBeDefined();
		expect(result.improvements.length).toBeGreaterThan(0);
		expect(result.path_access).toBeDefined();
	});

	it("includes strengths/weaknesses/opportunities fields", () => {
		const homepage = makeCrawlData();
		const result = extractGeoEvaluationData(homepage, []);
		expect(Array.isArray(result.strengths)).toBe(true);
		expect(Array.isArray(result.weaknesses)).toBe(true);
		expect(Array.isArray(result.opportunities)).toBe(true);
	});
});

// ── generateImprovements ──────────────────────────────

describe("generateImprovements", () => {
	it("recommends llms.txt when missing", () => {
		const data = {
			bot_policies: parseRobotsTxt(null),
			llms_txt: { exists: false, content_preview: null },
			schema_coverage: extractSchemaCoverage([]),
			marketing_claims: [],
			js_dependency: {
				script_count: 2,
				external_scripts: 1,
				inline_scripts: 1,
				frameworks_detected: [],
				estimated_js_dependency: 0.1,
			},
			product_info: [],
			blocked_paths: [],
			path_access: [],
			strengths: [],
			weaknesses: [],
			opportunities: [],
		};
		const result = generateImprovements(data, []);
		expect(result.some((r) => r.title.includes("llms.txt"))).toBe(true);
	});

	it("is sorted by impact descending", () => {
		const data = {
			bot_policies: parseRobotsTxt(null),
			llms_txt: { exists: false, content_preview: null },
			schema_coverage: [
				{
					schema_type: "Product",
					present: false,
					pages: [],
					quality: "none" as const,
					details: "",
				},
				{
					schema_type: "FAQPage",
					present: false,
					pages: [],
					quality: "none" as const,
					details: "",
				},
			],
			marketing_claims: [],
			js_dependency: {
				script_count: 50,
				external_scripts: 30,
				inline_scripts: 20,
				frameworks_detected: [],
				estimated_js_dependency: 0.8,
			},
			product_info: [],
			blocked_paths: [],
			path_access: [],
			strengths: [],
			weaknesses: [],
			opportunities: [],
		};
		const result = generateImprovements(data, []);
		for (let i = 1; i < result.length; i++) {
			expect(result[i - 1].impact).toBeGreaterThanOrEqual(result[i].impact);
		}
	});
});
