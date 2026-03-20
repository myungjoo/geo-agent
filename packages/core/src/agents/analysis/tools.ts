/**
 * Analysis Tools — pi-ai Tool definitions wrapping existing extractors
 *
 * Each tool uses TypeBox schemas for parameter validation (pi-ai format).
 * Tool handlers are factory functions that capture dependencies via closure.
 */
import { Type, type Tool } from "@mariozechner/pi-ai";
import type { ToolHandler } from "../../llm/pi-ai-bridge.js";
import type { CrawlData, MultiPageCrawlResult } from "../shared/types.js";
import { extractGeoEvaluationData, type GeoEvaluationData } from "./geo-eval-extractor.js";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";

// ── Tool Parameter Schemas (TypeBox) ────────────────────────

const CrawlPageParams = Type.Object({
	url: Type.String({ description: "The URL of the page to crawl" }),
	timeout_ms: Type.Optional(Type.Number({ description: "Crawl timeout in milliseconds (default: 15000)" })),
});

const CrawlMultiplePagesParams = Type.Object({
	url: Type.String({ description: "The base URL to start multi-page crawl from" }),
	max_pages: Type.Optional(Type.Number({ description: "Maximum number of pages to crawl (default: 20)" })),
	timeout_ms: Type.Optional(Type.Number({ description: "Per-page timeout in milliseconds (default: 15000)" })),
});

const ScoreGeoParams = Type.Object({
	crawl_data_key: Type.String({ description: "Key identifying which crawl data to score: 'homepage' or a page URL from multi-page crawl" }),
});

const ClassifySiteParams = Type.Object({
	crawl_data_key: Type.Optional(Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" })),
});

const ExtractEvalDataParams = Type.Object({
	crawl_data_key: Type.Optional(Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" })),
});

const RunProbesParams = Type.Object({
	site_name: Type.String({ description: "Name of the site (e.g., 'Samsung')" }),
	topics: Type.Array(Type.String(), { description: "Key topics of the site" }),
	products: Type.Optional(Type.Array(Type.String(), { description: "Products found on the site" })),
	prices: Type.Optional(Type.Array(Type.String(), { description: "Prices found on the site" })),
});

// ── Tool Definitions ────────────────────────────────────────

export const ANALYSIS_TOOLS: Tool[] = [
	{
		name: "crawl_page",
		description: "Crawl a single web page. Returns HTML, robots.txt, llms.txt, sitemap.xml, JSON-LD, meta tags, links, and response metadata.",
		parameters: CrawlPageParams,
	},
	{
		name: "crawl_multiple_pages",
		description: "Discover and crawl multiple pages from a site (up to max_pages). Follows internal links with priority to product/category pages. Returns homepage + sub-pages data.",
		parameters: CrawlMultiplePagesParams,
	},
	{
		name: "score_geo",
		description: "Score crawl data across 7 GEO dimensions (S1-S7): LLM Crawlability, Structured Data, Content Machine-Readability, Fact Density, Brand Message, AI Infrastructure, Content Navigation. Returns overall score (0-100), grade, and per-dimension breakdowns.",
		parameters: ScoreGeoParams,
	},
	{
		name: "classify_site",
		description: "Classify the site type (manufacturer, research, or generic) based on HTML content and URL patterns. Returns site_type, confidence score, and matched classification signals.",
		parameters: ClassifySiteParams,
	},
	{
		name: "extract_evaluation_data",
		description: "Extract detailed GEO evaluation data: AI bot policies (robots.txt analysis), schema coverage matrix (12 types), marketing claims with verifiability, JS dependency ratio, product information, and automated improvement recommendations.",
		parameters: ExtractEvalDataParams,
	},
	{
		name: "run_synthetic_probes",
		description: "Run 8 synthetic probe queries (P-01 to P-08) against the LLM to test citation rate and accuracy. Probes cover: product specs, pricing, comparisons, brand positioning, recommendations, facts, latest info, and problem solving.",
		parameters: RunProbesParams,
	},
];

// ── Tool Dependencies ───────────────────────────────────────

export interface AnalysisToolDeps {
	crawlTarget: (url: string, timeout?: number) => Promise<CrawlData>;
	scoreTarget: (data: CrawlData) => {
		overall_score: number;
		grade: string;
		dimensions: Array<{
			id: string;
			label: string;
			score: number;
			weight: number;
			details: string[];
		}>;
	};
	classifySite: (html: string, url: string) => {
		site_type: string;
		confidence: number;
		matched_signals: string[];
		all_signals: Array<{ site_type: string; confidence: number; signals: string[] }>;
	};
	crawlMultiplePages?: (
		url: string,
		maxPages?: number,
		timeoutMs?: number,
	) => Promise<MultiPageCrawlResult>;
	chatLLM?: (req: LLMRequest) => Promise<LLMResponse>;
}

// ── Shared State (accumulated across tool calls) ────────────

export interface AnalysisToolState {
	homepageCrawl: CrawlData | null;
	multiPageResult: MultiPageCrawlResult | null;
	pageScores: Map<string, ReturnType<AnalysisToolDeps["scoreTarget"]>>;
	classification: { site_type: string; confidence: number; matched_signals: string[] } | null;
	evalData: GeoEvaluationData | null;
	probeResults: unknown | null;
}

export function createAnalysisToolState(): AnalysisToolState {
	return {
		homepageCrawl: null,
		multiPageResult: null,
		pageScores: new Map(),
		classification: null,
		evalData: null,
		probeResults: null,
	};
}

// ── Tool Handlers Factory ───────────────────────────────────

/**
 * Create tool handler map from dependencies.
 * State is shared across all handlers in one agent loop session.
 */
export function createAnalysisToolHandlers(
	deps: AnalysisToolDeps,
	state: AnalysisToolState,
): Record<string, ToolHandler> {
	return {
		crawl_page: async (params: any) => {
			const data = await deps.crawlTarget(params.url, params.timeout_ms ?? 15000);
			state.homepageCrawl = data;
			// Return a compact summary (not the full HTML)
			return JSON.stringify({
				url: data.url,
				status_code: data.status_code,
				content_type: data.content_type,
				response_time_ms: data.response_time_ms,
				title: data.title,
				has_robots_txt: !!data.robots_txt,
				has_llms_txt: !!data.llms_txt,
				has_sitemap: !!data.sitemap_xml,
				json_ld_count: data.json_ld.length,
				json_ld_types: data.json_ld.map((ld) => (ld as Record<string, unknown>)["@type"]).filter(Boolean),
				meta_tags: data.meta_tags,
				canonical_url: data.canonical_url,
				links_count: data.links.length,
				html_length: data.html.length,
				// Include robots.txt content for analysis
				robots_txt_excerpt: data.robots_txt?.slice(0, 2000) ?? null,
				llms_txt_excerpt: data.llms_txt?.slice(0, 1000) ?? null,
			});
		},

		crawl_multiple_pages: async (params: any) => {
			if (!deps.crawlMultiplePages) {
				return JSON.stringify({ error: "Multi-page crawling not available" });
			}
			const result = await deps.crawlMultiplePages(
				params.url,
				params.max_pages ?? 20,
				params.timeout_ms ?? 15000,
			);
			state.multiPageResult = result;
			return JSON.stringify({
				total_pages: result.total_pages,
				crawl_duration_ms: result.crawl_duration_ms,
				homepage_url: result.homepage.url,
				pages: result.pages.map((p) => ({
					url: p.url,
					path: p.path,
					status_code: p.crawl_data.status_code,
					title: p.crawl_data.title,
					json_ld_count: p.crawl_data.json_ld.length,
					has_product_schema: p.crawl_data.json_ld.some(
						(ld) => (ld as Record<string, unknown>)["@type"] === "Product",
					),
				})),
			});
		},

		score_geo: async (params: any) => {
			let crawlData: CrawlData | null = null;

			if (params.crawl_data_key === "homepage" || !params.crawl_data_key) {
				crawlData = state.homepageCrawl;
			} else if (state.multiPageResult) {
				const page = state.multiPageResult.pages.find((p) => p.url === params.crawl_data_key);
				crawlData = page?.crawl_data ?? null;
			}

			if (!crawlData) {
				return JSON.stringify({ error: "No crawl data found. Call crawl_page first." });
			}

			const scores = deps.scoreTarget(crawlData);
			state.pageScores.set(params.crawl_data_key ?? "homepage", scores);
			return JSON.stringify(scores);
		},

		classify_site: async (_params: any) => {
			const crawlData = state.homepageCrawl;
			if (!crawlData) {
				return JSON.stringify({ error: "No crawl data found. Call crawl_page first." });
			}
			const result = deps.classifySite(crawlData.html, crawlData.url);
			state.classification = result;
			return JSON.stringify(result);
		},

		extract_evaluation_data: async (_params: any) => {
			const crawlData = state.homepageCrawl;
			if (!crawlData) {
				return JSON.stringify({ error: "No crawl data found. Call crawl_page first." });
			}

			const dimensions = state.pageScores.get("homepage")?.dimensions ?? [];
			const subPages = state.multiPageResult?.pages.map((p) => ({
				url: p.url,
				filename: p.path,
				crawl_data: p.crawl_data,
			})) ?? [];

			const evalData = extractGeoEvaluationData(crawlData, subPages, dimensions);
			state.evalData = evalData;
			return JSON.stringify(evalData);
		},

		run_synthetic_probes: async (params: any) => {
			if (!deps.chatLLM) {
				return JSON.stringify({ error: "LLM not available — cannot run synthetic probes" });
			}

			// Dynamic import to avoid circular dependencies
			const { runProbes } = await import("../probes/synthetic-probes.js");

			const context = {
				site_name: params.site_name,
				site_url: state.homepageCrawl?.url ?? "",
				site_type: state.classification?.site_type ?? "generic",
				topics: params.topics,
				products: params.products ?? [],
				prices: params.prices ?? [],
				brand: params.site_name,
			};

			const result = await runProbes(context, { chatLLM: deps.chatLLM });
			state.probeResults = result;
			return JSON.stringify({
				summary: result.summary,
				probes: result.probes.map((r) => ({
					probe_id: r.probe_id,
					query: r.query,
					verdict: r.verdict,
					cited: r.cited,
					accuracy: r.accuracy,
				})),
			});
		},
	};
}
