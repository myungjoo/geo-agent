import { describe, expect, it } from "vitest";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import type { CrawlData } from "../shared/types.js";
import {
	type BotPolicyEntry,
	analyzeJsDependency,
	analyzePathAccess,
	extractGeoEvaluationData,
	extractMarketingClaims,
	extractProductInfo,
	extractSchemaCoverage,
	generateFindings,
	generateFindingsLLM,
	generateImprovements,
	parseRobotsTxt,
} from "./geo-eval-extractor.js";

// ── Mock chatLLM ────────────────────────────────────────────

const MOCK_FINDINGS_RESPONSE = {
	strengths: [
		{
			title: "AI 봇 크롤링 허용",
			description: "주요 AI 봇이 사이트에 접근 가능합니다.",
			icon: "✅",
		},
	],
	weaknesses: [
		{ title: "llms.txt 미존재", description: "llms.txt가 없어 LLM 안내가 불가합니다.", icon: "❌" },
	],
	opportunities: [
		{
			title: "스키마 확장",
			description: "Product 스키마를 추가하면 GEO 점수가 향상됩니다.",
			icon: "🚀",
		},
	],
};

const MOCK_SCHEMA_QUALITY_RESPONSE: Record<string, string> = {
	Organization: "good",
	Product: "excellent",
	WebPage: "partial",
};

const MOCK_JS_IMPACT_RESPONSE = {
	blocks_access: false,
	severity: "low",
	reasoning:
		"Static HTML contains meaningful text content; JS enhances but does not gate key information.",
};

const MOCK_JS_IMPACT_HIGH_RESPONSE = {
	blocks_access: true,
	severity: "high",
	reasoning: "Almost no text in static HTML; page relies entirely on JS rendering for content.",
};

const MOCK_FRAMEWORKS_RESPONSE = {
	frameworks: ["React/Next.js"],
};

function createMockChatLLM(
	claimsResponse: unknown[] = [],
	jsImpactOverride?: unknown,
	frameworksOverride?: unknown,
): (req: LLMRequest) => Promise<LLMResponse> {
	return async (req: LLMRequest): Promise<LLMResponse> => {
		const promptText = req.prompt ?? "";
		// Detect framework detection prompts
		if (promptText.includes("JavaScript frameworks") && promptText.includes("Script evidence")) {
			return {
				content: JSON.stringify(frameworksOverride ?? MOCK_FRAMEWORKS_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
				latency_ms: 10,
				cost_usd: 0,
			};
		}
		// Detect JS impact prompts
		if (promptText.includes("JavaScript dependency") && promptText.includes("blocks_access")) {
			return {
				content: JSON.stringify(jsImpactOverride ?? MOCK_JS_IMPACT_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
				latency_ms: 15,
				cost_usd: 0,
			};
		}
		// Detect findings-related prompts
		if (
			promptText.includes("strengths") &&
			promptText.includes("weaknesses") &&
			promptText.includes("opportunities")
		) {
			return {
				content: JSON.stringify(MOCK_FINDINGS_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 },
				latency_ms: 20,
				cost_usd: 0,
			};
		}
		// Detect schema quality prompts
		if (promptText.includes("schema.org") && promptText.includes("completeness of properties")) {
			return {
				content: JSON.stringify(MOCK_SCHEMA_QUALITY_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
				latency_ms: 15,
				cost_usd: 0,
			};
		}
		return {
			content: JSON.stringify(claimsResponse),
			model: "mock-model",
			provider: "mock",
			usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
			latency_ms: 10,
			cost_usd: 0,
		};
	};
}

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
		const robots = "User-agent: GPTBot\nAllow: /\n";
		const result = parseRobotsTxt(robots);
		const gptBot = result.find((b) => b.bot_name === "GPTBot");
		expect(gptBot?.status).toBe("allowed");
	});

	it("detects blocked bots", () => {
		const robots = "User-agent: ClaudeBot\nDisallow: /\n";
		const result = parseRobotsTxt(robots);
		const claude = result.find((b) => b.bot_name === "ClaudeBot");
		expect(claude?.status).toBe("blocked");
	});

	it("detects partial access", () => {
		const robots = "User-agent: GPTBot\nDisallow: /search/\nDisallow: /private/\n";
		const result = parseRobotsTxt(robots);
		const gptBot = result.find((b) => b.bot_name === "GPTBot");
		expect(gptBot?.status).toBe("partial");
		expect(gptBot?.disallowed_paths).toContain("/search/");
	});
});

// ── extractSchemaCoverage ──────────────────────────────

describe("extractSchemaCoverage", () => {
	it("detects JSON-LD schema types (no LLM)", async () => {
		const pages = [
			{
				url: "https://example.com",
				filename: "index.html",
				crawl_data: makeCrawlData({
					json_ld: [{ "@type": "Organization", name: "Test Corp" }],
				}),
			},
		];
		const result = await extractSchemaCoverage(pages);
		const org = result.find((s) => s.schema_type === "Organization");
		expect(org?.present).toBe(true);
		expect(org?.pages).toContain("index.html");
	});

	it("reports missing schemas (no LLM)", async () => {
		const pages = [
			{ url: "https://example.com", filename: "index.html", crawl_data: makeCrawlData() },
		];
		const result = await extractSchemaCoverage(pages);
		const product = result.find((s) => s.schema_type === "Product");
		expect(product?.present).toBe(false);
		expect(product?.quality).toBe("none");
	});

	it("uses LLM for quality judgment when chatLLM provided", async () => {
		const mockLLM = createMockChatLLM();
		const pages = [
			{
				url: "https://example.com",
				filename: "index.html",
				crawl_data: makeCrawlData({
					json_ld: [{ "@type": "Organization", name: "Test Corp", url: "https://example.com" }],
				}),
			},
		];
		const result = await extractSchemaCoverage(pages, mockLLM);
		const org = result.find((s) => s.schema_type === "Organization");
		expect(org?.present).toBe(true);
		// Mock returns "good" for Organization
		expect(org?.quality).toBe("good");
	});

	it("falls back to heuristic when LLM call fails", async () => {
		const failingLLM = async (_req: LLMRequest): Promise<never> => {
			throw new Error("LLM unavailable");
		};
		const pages = [
			{
				url: "https://example.com",
				filename: "index.html",
				crawl_data: makeCrawlData({
					json_ld: [{ "@type": "Organization", name: "Test Corp" }],
				}),
			},
		];
		const result = await extractSchemaCoverage(pages, failingLLM);
		const org = result.find((s) => s.schema_type === "Organization");
		expect(org?.present).toBe(true);
		// With 1 page and 1 found: coverage = 1.0 >= 0.8 → "excellent"
		expect(org?.quality).toBe("excellent");
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
	it("detects superlative claims via LLM", async () => {
		const html =
			"<html><body>We are the world's first to bring AI to every device. Award-winning design.</body></html>";
		const mockLLM = createMockChatLLM([
			{
				text: "world's first to bring AI to every device",
				location: "https://example.com",
				has_source: false,
				verifiability: "unverifiable",
			},
			{
				text: "Award-winning design",
				location: "https://example.com",
				has_source: false,
				verifiability: "unverifiable",
			},
		]);
		const result = await extractMarketingClaims([{ url: "https://example.com", html }], mockLLM);
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0].verifiability).toBe("unverifiable");
	});

	it("returns empty for clean content", async () => {
		const html = "<html><body>This product weighs 180g and has a 6.1 inch display.</body></html>";
		const mockLLM = createMockChatLLM([]);
		const result = await extractMarketingClaims([{ url: "https://example.com", html }], mockLLM);
		expect(result.length).toBe(0);
	});

	it("handles LLM failure gracefully", async () => {
		const html = "<html><body>Some content here</body></html>";
		const failingLLM = async (_req: LLMRequest): Promise<never> => {
			throw new Error("LLM unavailable");
		};
		const result = await extractMarketingClaims([{ url: "https://example.com", html }], failingLLM);
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

// ── generateFindingsLLM ────────────────────────────────

describe("generateFindingsLLM", () => {
	const botPolicies: BotPolicyEntry[] = [
		{ bot_name: "GPTBot", service: "ChatGPT", status: "allowed", disallowed_paths: [] },
		{ bot_name: "ClaudeBot", service: "Claude", status: "not_specified", disallowed_paths: [] },
	];
	const mockLLM = createMockChatLLM();

	it("generates findings via LLM call", async () => {
		const result = await generateFindingsLLM(
			botPolicies,
			{ exists: false, content_preview: null },
			[],
			[],
			{
				script_count: 5,
				external_scripts: 3,
				inline_scripts: 2,
				frameworks_detected: [],
				estimated_js_dependency: 0.2,
			},
			[],
			mockLLM,
		);
		expect(result.strengths.length).toBeGreaterThan(0);
		expect(result.weaknesses.length).toBeGreaterThan(0);
		expect(result.opportunities.length).toBeGreaterThan(0);
		expect(result.strengths[0].title).toBe("AI 봇 크롤링 허용");
	});

	it("returns empty arrays on LLM failure", async () => {
		const failingLLM = async (_req: LLMRequest): Promise<never> => {
			throw new Error("LLM unavailable");
		};
		await expect(
			generateFindingsLLM(
				botPolicies,
				{ exists: false, content_preview: null },
				[],
				[],
				{
					script_count: 5,
					external_scripts: 3,
					inline_scripts: 2,
					frameworks_detected: [],
					estimated_js_dependency: 0.2,
				},
				[],
				failingLLM,
			),
		).rejects.toThrow("LLM unavailable");
	});

	it("handles malformed LLM response gracefully", async () => {
		const badLLM = async (_req: LLMRequest): Promise<LLMResponse> => ({
			content: "not valid json at all",
			model: "mock-model",
			provider: "mock",
			usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
			latency_ms: 10,
			cost_usd: 0,
		});
		const result = await generateFindingsLLM(
			botPolicies,
			{ exists: false, content_preview: null },
			[],
			[],
			{
				script_count: 5,
				external_scripts: 3,
				inline_scripts: 2,
				frameworks_detected: [],
				estimated_js_dependency: 0.2,
			},
			[],
			badLLM,
		);
		expect(result.strengths).toEqual([]);
		expect(result.weaknesses).toEqual([]);
		expect(result.opportunities).toEqual([]);
	});
});

// ── analyzeJsDependency ────────────────────────────────

describe("analyzeJsDependency", () => {
	it("returns mechanical metrics and LLM access impact with chatLLM", async () => {
		const html =
			'<html><head><script src="app.js"></script></head><body><h1>Hello World</h1><p>Some content here.</p></body></html>';
		const mockLLM = createMockChatLLM();
		const result = await analyzeJsDependency(html, mockLLM);
		expect(result.script_count).toBe(1);
		expect(result.external_scripts).toBe(1);
		expect(result.inline_scripts).toBe(0);
		expect(result.estimated_js_dependency).toBeGreaterThanOrEqual(0);
	});

	it("includes LLM access impact when chatLLM provided", async () => {
		const html =
			'<html><head><script src="app.js"></script></head><body><h1>Hello World</h1><p>Visible content.</p></body></html>';
		const mockLLM = createMockChatLLM();
		const result = await analyzeJsDependency(html, mockLLM);
		expect(result.llm_access_impact).toBeDefined();
		expect(result.llm_access_impact?.blocks_access).toBe(false);
		expect(result.llm_access_impact?.severity).toBe("low");
		expect(typeof result.llm_access_impact?.reasoning).toBe("string");
	});

	it("reports high severity for JS-heavy pages", async () => {
		const html =
			'<html><head><script src="bundle.js"></script><script src="vendor.js"></script></head><body><div id="root"></div></body></html>';
		const mockLLM = createMockChatLLM([], MOCK_JS_IMPACT_HIGH_RESPONSE);
		const result = await analyzeJsDependency(html, mockLLM);
		expect(result.llm_access_impact).toBeDefined();
		expect(result.llm_access_impact?.blocks_access).toBe(true);
		expect(result.llm_access_impact?.severity).toBe("high");
	});

	it("leaves llm_access_impact undefined when LLM fails", async () => {
		const html = "<html><body><h1>Content</h1></body></html>";
		const failingLLM = async (_req: LLMRequest): Promise<never> => {
			throw new Error("LLM unavailable");
		};
		const result = await analyzeJsDependency(html, failingLLM);
		expect(result.script_count).toBe(0);
		expect(result.llm_access_impact).toBeUndefined();
	});

	it("leaves llm_access_impact undefined when LLM returns malformed JSON", async () => {
		const html = "<html><body><h1>Content</h1></body></html>";
		const badLLM = async (_req: LLMRequest): Promise<LLMResponse> => ({
			content: "not valid json",
			model: "mock-model",
			provider: "mock",
			usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
			latency_ms: 10,
			cost_usd: 0,
		});
		const result = await analyzeJsDependency(html, badLLM);
		expect(result.llm_access_impact).toBeUndefined();
	});

	it("leaves llm_access_impact undefined when LLM returns invalid severity", async () => {
		const html = "<html><body><h1>Content</h1></body></html>";
		const badSeverityLLM = createMockChatLLM([], {
			blocks_access: true,
			severity: "critical", // invalid severity
			reasoning: "Something wrong",
		});
		const result = await analyzeJsDependency(html, badSeverityLLM);
		expect(result.llm_access_impact).toBeUndefined();
	});

	it("detects frameworks from script tags (heuristic fallback when LLM framework detection fails)", async () => {
		const html =
			'<html><head><script src="https://cdn.example.com/react.production.min.js"></script></head><body><h1>Hello</h1></body></html>';
		const failingLLM = async (req: LLMRequest): Promise<LLMResponse> => {
			const promptText = req.prompt ?? "";
			if (promptText.includes("JavaScript frameworks")) {
				throw new Error("LLM unavailable");
			}
			return {
				content: JSON.stringify(MOCK_JS_IMPACT_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
				latency_ms: 15,
				cost_usd: 0,
			};
		};
		const result = await analyzeJsDependency(html, failingLLM);
		expect(result.frameworks_detected).toContain("React/Next.js");
	});

	it("detects frameworks from DOM markers (heuristic fallback when LLM framework detection fails)", async () => {
		// Must include a <script> tag so extractScriptEvidence is non-empty and LLM path is attempted
		const html = '<html><head><script src="bundle.js"></script></head><body><div id="__next">React SSR content</div></body></html>';
		const failingLLM = async (req: LLMRequest): Promise<LLMResponse> => {
			const promptText = req.prompt ?? "";
			if (promptText.includes("JavaScript frameworks")) {
				throw new Error("LLM unavailable");
			}
			return {
				content: JSON.stringify(MOCK_JS_IMPACT_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
				latency_ms: 15,
				cost_usd: 0,
			};
		};
		const result = await analyzeJsDependency(html, failingLLM);
		expect(result.frameworks_detected).toContain("React/Next.js");
	});

	it("does NOT false-positive on body text mentioning framework names", async () => {
		const html =
			"<html><body><p>React is great for building UIs. Angular is also popular. We love jQuery.</p></body></html>";
		const mockLLM = createMockChatLLM([], undefined, { frameworks: [] });
		const result = await analyzeJsDependency(html, mockLLM);
		expect(result.frameworks_detected).toEqual([]);
	});

	it("uses LLM for framework detection when chatLLM provided", async () => {
		const html =
			'<html><head><script src="/static/js/main.chunk.js"></script></head><body><div id="root"></div></body></html>';
		const mockLLM = createMockChatLLM([], undefined, { frameworks: ["React/Next.js"] });
		const result = await analyzeJsDependency(html, mockLLM);
		expect(result.frameworks_detected).toContain("React/Next.js");
	});

	it("falls back to heuristic when LLM framework detection fails", async () => {
		const html =
			'<html><head><script src="https://cdn.example.com/jquery.min.js"></script></head><body><h1>Hello</h1></body></html>';
		const failingLLM = async (req: LLMRequest): Promise<LLMResponse> => {
			const promptText = req.prompt ?? "";
			// Fail on framework prompts, succeed on JS impact
			if (promptText.includes("JavaScript frameworks")) {
				throw new Error("LLM unavailable");
			}
			return {
				content: JSON.stringify(MOCK_JS_IMPACT_RESPONSE),
				model: "mock-model",
				provider: "mock",
				usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
				latency_ms: 15,
				cost_usd: 0,
			};
		};
		const result = await analyzeJsDependency(html, failingLLM);
		expect(result.frameworks_detected).toContain("jQuery");
	});
});

// ── analyzePathAccess ──────────────────────────────────

describe("analyzePathAccess", () => {
	it("returns empty for null robotsTxt", () => {
		const result = analyzePathAccess(null);
		expect(result).toEqual([]);
	});

	it("extracts paths from AI bot blocks", () => {
		const robots = "User-agent: GPTBot\nDisallow: /search/\nAllow: /products/\n";
		const result = analyzePathAccess(robots);
		expect(result).toContainEqual({ path: "/search/", status: "blocked" });
		expect(result).toContainEqual({ path: "/products/", status: "allowed" });
	});
});

// ── extractGeoEvaluationData (integration) ─────────────

describe("extractGeoEvaluationData", () => {
	const mockLLM = createMockChatLLM([]);

	it("produces complete evaluation data structure", async () => {
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
		const result = await extractGeoEvaluationData(homepage, subPages, dimensions, mockLLM);

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

	it("includes LLM-generated strengths/weaknesses/opportunities when chatLLM provided", async () => {
		const homepage = makeCrawlData();
		const result = await extractGeoEvaluationData(homepage, [], undefined, mockLLM);
		expect(Array.isArray(result.strengths)).toBe(true);
		expect(Array.isArray(result.weaknesses)).toBe(true);
		expect(Array.isArray(result.opportunities)).toBe(true);
		// Should be LLM-generated (from mock)
		expect(result.strengths[0]?.title).toBe("AI 봇 크롤링 허용");
		expect(result.weaknesses[0]?.title).toBe("llms.txt 미존재");
		expect(result.opportunities[0]?.title).toBe("스키마 확장");
	});

	it("produces rule-based findings with a mock chatLLM", async () => {
		const homepage = makeCrawlData();
		const result = await extractGeoEvaluationData(homepage, [], undefined, mockLLM);
		expect(Array.isArray(result.strengths)).toBe(true);
		expect(Array.isArray(result.weaknesses)).toBe(true);
		expect(Array.isArray(result.opportunities)).toBe(true);
	});

	it("throws when LLM findings call fails", async () => {
		const failingLLM = async (req: LLMRequest): Promise<LLMResponse> => {
			const promptText = req.prompt ?? "";
			// Allow marketing claims call to succeed (returns empty)
			if (promptText.includes("marketing claim")) {
				return {
					content: "[]",
					model: "mock-model",
					provider: "mock",
					usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
					latency_ms: 10,
					cost_usd: 0,
				};
			}
			// Fail on all other prompts
			throw new Error("LLM unavailable");
		};
		const homepage = makeCrawlData();
		await expect(
			extractGeoEvaluationData(homepage, [], undefined, failingLLM),
		).rejects.toThrow("LLM unavailable");
	});
});

// ── generateImprovements ──────────────────────────────

describe("generateImprovements", () => {
	it("recommends llms.txt when missing", async () => {
		const data = {
			bot_policies: parseRobotsTxt(null),
			llms_txt: { exists: false, content_preview: null },
			schema_coverage: await extractSchemaCoverage([]),
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
