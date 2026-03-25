/**
 * Analysis Tools — pi-ai Tool definitions wrapping existing extractors
 *
 * Each tool uses TypeBox schemas for parameter validation (pi-ai format).
 * Tool handlers are factory functions that capture dependencies via closure.
 */
import { type Tool, Type } from "@mariozechner/pi-ai";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import type { ToolHandler } from "../../llm/pi-ai-bridge.js";
import type { CrawlData, MultiPageCrawlResult } from "../shared/types.js";
import { type GeoEvaluationData, extractGeoEvaluationData } from "./geo-eval-extractor.js";

// ── Tool Parameter Schemas (TypeBox) ────────────────────────

const CrawlPageParams = Type.Object({
	url: Type.String({ description: "The URL of the page to crawl" }),
	timeout_ms: Type.Optional(
		Type.Number({ description: "Crawl timeout in milliseconds (default: 15000)" }),
	),
});

const CrawlMultiplePagesParams = Type.Object({
	url: Type.String({ description: "The base URL to start multi-page crawl from" }),
	max_pages: Type.Optional(
		Type.Number({ description: "Maximum number of pages to crawl (default: 20)" }),
	),
	timeout_ms: Type.Optional(
		Type.Number({ description: "Per-page timeout in milliseconds (default: 15000)" }),
	),
});

const ScoreGeoParams = Type.Object({
	crawl_data_key: Type.String({
		description:
			"Key identifying which crawl data to score: 'homepage' or a page URL from multi-page crawl",
	}),
});

const ClassifySiteParams = Type.Object({
	crawl_data_key: Type.Optional(
		Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" }),
	),
});

const ExtractEvalDataParams = Type.Object({
	crawl_data_key: Type.Optional(
		Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" }),
	),
});

const RunProbesParams = Type.Object({
	site_name: Type.String({ description: "Name of the site (e.g., 'Samsung')" }),
	topics: Type.Array(Type.String(), { description: "Key topics of the site" }),
	products: Type.Optional(Type.Array(Type.String(), { description: "Products found on the site" })),
	prices: Type.Optional(Type.Array(Type.String(), { description: "Prices found on the site" })),
});

const AnalyzeBrandParams = Type.Object({
	crawl_data_key: Type.Optional(
		Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" }),
	),
});

const AnalyzeProductParams = Type.Object({
	crawl_data_key: Type.Optional(
		Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" }),
	),
});

const CollectEvidenceParams = Type.Object({
	crawl_data_key: Type.Optional(
		Type.String({ description: "Key identifying which crawl data to use (default: 'homepage')" }),
	),
});

// ── Tool Definitions ────────────────────────────────────────

export const ANALYSIS_TOOLS: Tool[] = [
	{
		name: "crawl_page",
		description:
			"Crawl a single web page. Returns HTML, robots.txt, llms.txt, sitemap.xml, JSON-LD, meta tags, links, and response metadata.",
		parameters: CrawlPageParams,
	},
	{
		name: "crawl_multiple_pages",
		description:
			"Discover and crawl multiple pages from a site (up to max_pages). Follows internal links with priority to product/category pages. Returns homepage + sub-pages data.",
		parameters: CrawlMultiplePagesParams,
	},
	{
		name: "score_geo",
		description:
			"Score crawl data across 7 GEO dimensions (S1-S7): LLM Crawlability, Structured Data, Content Machine-Readability, Fact Density, Brand Message, AI Infrastructure, Content Navigation. Returns overall score (0-100), grade, and per-dimension breakdowns.",
		parameters: ScoreGeoParams,
	},
	{
		name: "classify_site",
		description:
			"Classify the site type (manufacturer, research, or generic) based on HTML content and URL patterns. Returns site_type, confidence score, and matched classification signals.",
		parameters: ClassifySiteParams,
	},
	{
		name: "extract_evaluation_data",
		description:
			"Extract detailed GEO evaluation data: AI bot policies (robots.txt analysis), schema coverage matrix (12 types), marketing claims with verifiability, JS dependency ratio, product information, and automated improvement recommendations.",
		parameters: ExtractEvalDataParams,
	},
	{
		name: "run_synthetic_probes",
		description:
			"Run 8 synthetic probe queries (P-01 to P-08) against the LLM to test citation rate and accuracy. Probes cover: product specs, pricing, comparisons, brand positioning, recommendations, facts, latest info, and problem solving.",
		parameters: RunProbesParams,
	},
	{
		name: "analyze_brand_message",
		description:
			"Analyze brand messaging from crawled pages. Extracts marketing claims with their location, sentiment (positive/neutral/negative), and verifiability (verifiable/claim_no_source/unverifiable/emotional). Also scores brand perception dimensions: innovation, AI leadership, premium positioning, sustainability, factual verifiability, competitive differentiation.",
		parameters: AnalyzeBrandParams,
	},
	{
		name: "analyze_product_recognition",
		description:
			"Analyze product information recognition across categories. For each product category found, scores how well product data (name, price, specs, ratings, reviews) is machine-readable in static HTML vs JavaScript-only. Returns per-category scores, product lists with recognition status, and per-product spec recognition breakdown.",
		parameters: AnalyzeProductParams,
	},
	{
		name: "collect_evidence",
		description:
			"Collect raw evidence for the evaluation report. Returns: JSON-LD code snippets, robots.txt AI bot sections, schema implementation matrix (which schemas exist on which pages), JavaScript dependency details (which data items are in static HTML vs JS-only), and marketing claim verification evidence.",
		parameters: CollectEvidenceParams,
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
	classifySite: (
		html: string,
		url: string,
	) => {
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
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>;
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

// ── Helpers ─────────────────────────────────────────────────

/** Score how strongly a set of keywords appears across all pages (0-100) */
function assessDimension(pages: CrawlData[], keywords: string[]): number {
	let totalHits = 0;
	let totalPages = 0;
	for (const page of pages) {
		totalPages++;
		const text = page.html.toLowerCase();
		for (const kw of keywords) {
			const regex = new RegExp(kw, "gi");
			const matches = text.match(regex);
			if (matches) totalHits += Math.min(matches.length, 5); // Cap at 5 per keyword per page
		}
	}
	const maxHits = totalPages * keywords.length * 3; // 3 hits per keyword per page = good coverage
	return Math.min(Math.round((totalHits / Math.max(maxHits, 1)) * 100), 100);
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
				json_ld_types: data.json_ld
					.map((ld) => (ld as Record<string, unknown>)["@type"])
					.filter(Boolean),
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
			const subPages =
				state.multiPageResult?.pages.map((p) => ({
					url: p.url,
					filename: p.path,
					crawl_data: p.crawl_data,
				})) ?? [];

			const evalData = await extractGeoEvaluationData(
				crawlData,
				subPages,
				deps.chatLLM,
				dimensions,
			);
			state.evalData = evalData;
			return JSON.stringify(evalData);
		},

		analyze_brand_message: async (_params: any) => {
			const crawlData = state.homepageCrawl;
			if (!crawlData) {
				return JSON.stringify({ error: "No crawl data found. Call crawl_page first." });
			}

			const allPages = [
				crawlData,
				...(state.multiPageResult?.pages.map((p) => p.crawl_data) ?? []),
			];
			const claims: Array<{
				message: string;
				location: string;
				sentiment: string;
				verifiability: string;
			}> = [];

			// Extract marketing claims from all pages
			const claimPatterns = [
				/world['']?s?\s+(?:first|best|most|largest|smallest|thinnest|fastest)/gi,
				/(?:most|best)\s+(?:preferred|advanced|innovative|popular|powerful)/gi,
				/(?:industry|market)\s*[-\s]?leading/gi,
				/#\d+\s+(?:in|brand|company)/gi,
				/award[-\s]?winning/gi,
				/revolutionary|groundbreaking|game[-\s]?chang/gi,
			];

			for (const page of allPages) {
				const textContent = page.html
					.replace(/<script[\s\S]*?<\/script>/gi, "")
					.replace(/<style[\s\S]*?<\/style>/gi, "")
					.replace(/<[^>]+>/g, " ")
					.replace(/\s+/g, " ");
				for (const pattern of claimPatterns) {
					pattern.lastIndex = 0;
					let match = pattern.exec(textContent);
					while (match) {
						const contextStart = Math.max(0, match.index - 40);
						const contextEnd = Math.min(textContent.length, match.index + match[0].length + 60);
						const context = textContent.slice(contextStart, contextEnd).trim();
						const hasSource = /according|source|study|report|survey|certified|award/i.test(
							textContent.slice(match.index, match.index + 200),
						);
						claims.push({
							message: context,
							location: page.url,
							sentiment: "very_positive",
							verifiability: hasSource ? "verifiable" : "claim_no_source",
						});
						match = pattern.exec(textContent);
					}
				}
			}

			// Brand perception dimensions
			const html = crawlData.html.toLowerCase();
			const dimensions = [
				{
					label: "Innovation/Leadership Image",
					score: assessDimension(allPages, [
						"innovation",
						"innovative",
						"leading",
						"pioneer",
						"first",
					]),
				},
				{
					label: "AI/Tech Leadership",
					score: assessDimension(allPages, [
						"ai",
						"artificial intelligence",
						"machine learning",
						"smart",
						"intelligent",
					]),
				},
				{
					label: "Premium Brand Positioning",
					score: assessDimension(allPages, ["premium", "luxury", "flagship", "pro", "ultra"]),
				},
				{
					label: "Sustainability/ESG",
					score: assessDimension(allPages, [
						"sustainable",
						"eco",
						"recycle",
						"carbon",
						"green",
						"environment",
					]),
				},
				{
					label: "Factual Claim Verifiability",
					score:
						claims.length > 0
							? Math.round(
									(claims.filter((c) => c.verifiability === "verifiable").length / claims.length) *
										100,
								)
							: 0,
				},
				{
					label: "Competitive Differentiation",
					score: assessDimension(allPages, [
						"only",
						"exclusive",
						"unique",
						"patented",
						"proprietary",
					]),
				},
			];

			return JSON.stringify({ dimensions, claims: claims.slice(0, 20) });
		},

		analyze_product_recognition: async (_params: any) => {
			const crawlData = state.homepageCrawl;
			if (!crawlData) {
				return JSON.stringify({ error: "No crawl data found. Call crawl_page first." });
			}

			const allPages = [
				{ url: crawlData.url, crawl_data: crawlData },
				...(state.multiPageResult?.pages.map((p) => ({ url: p.url, crawl_data: p.crawl_data })) ??
					[]),
			];

			// Categorize pages and extract product data
			const categories: Record<string, { pages: typeof allPages; score: number }> = {};

			for (const page of allPages) {
				const url = page.url.toLowerCase();
				const jsonLd = page.crawl_data.json_ld;
				const hasProduct = jsonLd.some((ld) => {
					const t = (ld as Record<string, unknown>)["@type"];
					return t === "Product" || t === "ItemList";
				});

				let category = "Other";
				if (/phone|smartphone|galaxy\s*s|galaxy\s*z/i.test(url)) category = "Smartphones";
				else if (/tv|television|qled|oled|neo/i.test(url)) category = "TV";
				else if (/refrigerator|washer|dryer|appliance|bespoke/i.test(url))
					category = "Home Appliances";
				else if (/laptop|tablet|book|pc|computer/i.test(url)) category = "PC/Tablets";
				else if (/watch|buds|wearable/i.test(url)) category = "Wearables";

				if (!categories[category]) categories[category] = { pages: [], score: 0 };
				categories[category].pages.push(page);
			}

			// Score each category
			const categoryScores = Object.entries(categories).map(([name, data]) => {
				let score = 0;
				let total = 0;
				for (const page of data.pages) {
					total++;
					const ld = page.crawl_data.json_ld;
					if (ld.some((l) => (l as Record<string, unknown>)["@type"] === "Product")) score += 3;
					if (ld.some((l) => (l as Record<string, unknown>)["@type"] === "ItemList")) score += 2;
					if (ld.some((l) => (l as Record<string, unknown>).offers)) score += 2;
					if (ld.some((l) => (l as Record<string, unknown>).aggregateRating)) score += 2;
					if (page.crawl_data.meta_tags.description) score += 1;
				}
				const maxPerPage = 10;
				return {
					category: name,
					score: Math.min(Math.round((score / (total * maxPerPage)) * 100), 100),
				};
			});

			// Extract product lists from pages with Product schema
			const productLists: Array<{ category: string; products: any[] }> = [];
			for (const page of allPages) {
				for (const ld of page.crawl_data.json_ld) {
					const obj = ld as Record<string, unknown>;
					if (obj["@type"] === "Product") {
						const offer = obj.offers as Record<string, unknown> | undefined;
						const rating = obj.aggregateRating as Record<string, unknown> | undefined;
						const product = {
							name: obj.name ?? "Unknown",
							price: offer?.price ? `$${offer.price}` : undefined,
							rating: rating?.ratingValue ? Number(rating.ratingValue) : undefined,
							review_count: rating?.reviewCount ? Number(rating.reviewCount) : undefined,
							llm_recognition: offer && rating ? "full" : offer || rating ? "partial" : "none",
						};
						// Find matching category
						const url = page.url.toLowerCase();
						let cat = "Other";
						if (/tv|television/i.test(url)) cat = "TV";
						else if (/phone|smartphone/i.test(url)) cat = "Smartphones";
						let list = productLists.find((l) => l.category === cat);
						if (!list) {
							list = { category: cat, products: [] };
							productLists.push(list);
						}
						list.products.push(product);
					}
				}
			}

			// Spec recognition for key products (check what's in static HTML vs JS)
			const specRecognition: Array<{ product_name: string; specs: any[] }> = [];
			for (const page of allPages) {
				if (
					page.crawl_data.json_ld.some(
						(ld) => (ld as Record<string, unknown>)["@type"] === "Product",
					)
				)
					continue;
				// Pages WITHOUT Product schema but likely product pages
				const title = page.crawl_data.title;
				if (!title || !/galaxy|phone|tv|laptop/i.test(title)) continue;

				const html = page.crawl_data.html;
				const specChecks = [
					{ spec_name: "Product Name/Model", pattern: /<h1[^>]*>[^<]+<\/h1>/i },
					{ spec_name: "Price", pattern: /\$[\d,]+\.?\d*/i },
					{ spec_name: "Camera Specs", pattern: /\d+\s*MP|megapixel/i },
					{ spec_name: "Display Specs", pattern: /\d+\.?\d*["\s]*inch|AMOLED|OLED/i },
					{ spec_name: "Battery", pattern: /\d+\s*mAh/i },
					{ spec_name: "Processor", pattern: /snapdragon|exynos|chip|processor/i },
					{ spec_name: "Storage Options", pattern: /\d+\s*(?:GB|TB)\s*(?:storage|memory)/i },
					{ spec_name: "Colors", pattern: /(?:available\s+in|colors?:)\s*[\w\s,]+/i },
				];

				const specs = specChecks.map((check) => ({
					spec_name: check.spec_name,
					status: check.pattern.test(html) ? "recognized" : "not_recognized",
					score: check.pattern.test(html) ? 80 : 10,
				}));

				specRecognition.push({ product_name: title, specs });
			}

			return JSON.stringify({
				category_scores: categoryScores,
				product_lists: productLists.map((l) => ({ ...l, products: l.products.slice(0, 15) })),
				spec_recognition: specRecognition.slice(0, 5),
			});
		},

		collect_evidence: async (_params: any) => {
			const crawlData = state.homepageCrawl;
			if (!crawlData) {
				return JSON.stringify({ error: "No crawl data found. Call crawl_page first." });
			}

			const allPages = [
				{ url: crawlData.url, crawl_data: crawlData },
				...(state.multiPageResult?.pages.map((p) => ({ url: p.url, crawl_data: p.crawl_data })) ??
					[]),
			];

			// Evidence sections
			const sections: Array<{ id: string; title: string; content: string }> = [];

			// 1. llms.txt evidence
			sections.push({
				id: "E-1",
				title: "llms.txt status",
				content: crawlData.llms_txt
					? `llms.txt found:\n${crawlData.llms_txt.slice(0, 500)}`
					: "llms.txt not found (HTTP 404 or missing)",
			});

			// 2. robots.txt AI bot section
			if (crawlData.robots_txt) {
				const lines = crawlData.robots_txt.split("\n");
				const aiSection: string[] = [];
				let inAiBlock = false;
				for (const line of lines) {
					if (
						/user-agent:\s*(GPTBot|ClaudeBot|Google-Extended|PerplexityBot|OAI|ChatGPT|Applebot|Meta-External)/i.test(
							line,
						)
					) {
						inAiBlock = true;
					}
					if (inAiBlock) {
						aiSection.push(line);
						if (line.trim() === "" && aiSection.length > 1) inAiBlock = false;
					}
				}
				if (aiSection.length > 0) {
					sections.push({
						id: "E-2",
						title: "robots.txt AI bot rules",
						content: aiSection.join("\n"),
					});
				}
			}

			// Schema implementation matrix
			const schemaTypes = [
				"ItemList",
				"Product",
				"Offer",
				"AggregateRating",
				"BreadcrumbList",
				"FAQPage",
				"SpeakableSpecification",
			];
			const schemaMatrix = allPages.map((page) => {
				const types = page.crawl_data.json_ld.map((ld) =>
					String((ld as Record<string, unknown>)["@type"] ?? ""),
				);
				const hasOffer = page.crawl_data.json_ld.some(
					(ld) => !!(ld as Record<string, unknown>).offers,
				);
				const hasRating = page.crawl_data.json_ld.some(
					(ld) => !!(ld as Record<string, unknown>).aggregateRating,
				);
				const implemented = schemaTypes.filter((t) => {
					if (t === "Offer") return hasOffer;
					if (t === "AggregateRating") return hasRating;
					return types.includes(t);
				});
				return {
					page_url: page.url,
					item_list: types.includes("ItemList"),
					product: types.includes("Product"),
					offer: hasOffer,
					aggregate_rating: hasRating,
					breadcrumb: types.includes("BreadcrumbList"),
					faq_page: types.includes("FAQPage"),
					speakable: types.includes("SpeakableSpecification"),
					llm_availability_pct: Math.round((implemented.length / schemaTypes.length) * 100),
				};
			});

			// JS dependency analysis
			const jsDeps: Array<{
				data_item: string;
				in_static_html: boolean;
				llm_accessible: string;
				geo_impact: string;
			}> = [];
			for (const page of allPages.slice(0, 5)) {
				const html = page.crawl_data.html;
				const scriptBlocks = (html.match(/<script[\s\S]*?<\/script>/gi) || []).length;
				const totalSize = html.length;
				const scriptSize = (html.match(/<script[\s\S]*?<\/script>/gi) || []).reduce(
					(s, b) => s + b.length,
					0,
				);
				const jsRatio = scriptSize / Math.max(totalSize, 1);

				if (jsRatio > 0.3) {
					jsDeps.push({
						data_item: `JS-heavy page: ${page.url}`,
						in_static_html: false,
						llm_accessible: "partial",
						geo_impact: `${Math.round(jsRatio * 100)}% of page is script — much content may be JS-rendered only`,
					});
				}
			}

			// JSON-LD snippets (first from each page)
			for (const page of allPages.slice(0, 5)) {
				if (page.crawl_data.json_ld.length > 0) {
					sections.push({
						id: `E-LD-${sections.length}`,
						title: `JSON-LD from ${page.url}`,
						content: JSON.stringify(page.crawl_data.json_ld[0], null, 2).slice(0, 800),
					});
				}
			}

			return JSON.stringify({
				sections,
				schema_implementation_matrix: schemaMatrix,
				js_dependency_details: jsDeps,
			});
		},

		run_synthetic_probes: async (params: any) => {
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

			const result = await runProbes(context, { chatLLM: deps.chatLLM }, { web_search: true });
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
