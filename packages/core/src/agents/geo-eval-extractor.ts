/**
 * GEO Evaluation Data Extractor
 *
 * CrawlData로부터 GEO 평가에 필요한 상세 데이터를 추출한다.
 * GEO_Evaluation_Prompt.md의 Phase 1~3에 해당하는 정적 분석.
 *
 * 추출 항목:
 * - robots.txt AI 봇별 허용/차단 상태
 * - llms.txt 존재 여부 및 내용
 * - JSON-LD 스키마 커버리지 매트릭스
 * - 마케팅 클레임 추출 + 검증 가능성
 * - JS 의존성 분석 (정적 HTML 내 스펙 데이터 존재 여부)
 * - 제품/가격/스펙 정보 추출
 */
import type { CrawlData, PageScoreResult } from "./types.js";

// ── AI Bot Policy ──────────────────────────────────────────

export interface BotPolicyEntry {
	bot_name: string;
	service: string;
	status: "allowed" | "partial" | "blocked" | "not_specified";
	disallowed_paths: string[];
}

const AI_BOTS: Array<{ name: string; service: string }> = [
	{ name: "GPTBot", service: "ChatGPT (OpenAI)" },
	{ name: "OAI-SearchBot", service: "ChatGPT Search" },
	{ name: "ChatGPT-User", service: "ChatGPT 브라우징" },
	{ name: "PerplexityBot", service: "Perplexity AI" },
	{ name: "Google-Extended", service: "Gemini / AI Overview" },
	{ name: "ClaudeBot", service: "Claude (Anthropic)" },
	{ name: "Applebot", service: "Apple Intelligence" },
	{ name: "Meta-ExternalAgent", service: "Meta AI" },
];

export function parseRobotsTxt(robotsTxt: string | null): BotPolicyEntry[] {
	if (!robotsTxt) {
		return AI_BOTS.map((bot) => ({
			bot_name: bot.name,
			service: bot.service,
			status: "not_specified" as const,
			disallowed_paths: [],
		}));
	}

	const lines = robotsTxt.split("\n").map((l) => l.trim());

	return AI_BOTS.map((bot) => {
		// Find User-agent block for this bot
		let inBlock = false;
		let inWildcard = false;
		const disallowed: string[] = [];
		const allowed: string[] = [];

		for (const line of lines) {
			const lower = line.toLowerCase();
			if (lower.startsWith("user-agent:")) {
				const agent = line.slice(11).trim();
				inBlock = agent.toLowerCase() === bot.name.toLowerCase();
				inWildcard = agent === "*";
			} else if (inBlock || (inWildcard && !inBlock)) {
				if (lower.startsWith("disallow:")) {
					const path = line.slice(9).trim();
					if (path) disallowed.push(path);
				} else if (lower.startsWith("allow:")) {
					const path = line.slice(6).trim();
					if (path) allowed.push(path);
				}
			}
		}

		// Check if bot name appears anywhere in robots.txt
		const mentioned = robotsTxt.toLowerCase().includes(bot.name.toLowerCase());

		let status: BotPolicyEntry["status"];
		if (!mentioned) {
			status = "not_specified";
		} else if (disallowed.some((p) => p === "/")) {
			status = "blocked";
		} else if (disallowed.length > 0) {
			status = "partial";
		} else {
			status = "allowed";
		}

		return {
			bot_name: bot.name,
			service: bot.service,
			status,
			disallowed_paths: disallowed,
		};
	});
}

// ── Schema Coverage ────────────────────────────────────────

export interface SchemaCoverageEntry {
	schema_type: string;
	present: boolean;
	pages: string[];
	quality: "excellent" | "good" | "partial" | "none";
	details: string;
}

const SCHEMA_TYPES_TO_CHECK = [
	"Organization",
	"Corporation",
	"WebPage",
	"Product",
	"Offer",
	"AggregateRating",
	"ItemList",
	"BreadcrumbList",
	"FAQPage",
	"VideoObject",
	"SpeakableSpecification",
	"SearchAction",
];

export function extractSchemaCoverage(
	pages: Array<{ url: string; filename: string; crawl_data: CrawlData }>,
): SchemaCoverageEntry[] {
	return SCHEMA_TYPES_TO_CHECK.map((schemaType) => {
		const foundOn: string[] = [];
		for (const page of pages) {
			const hasType = page.crawl_data.json_ld.some((ld) => {
				const t = String((ld as Record<string, unknown>)["@type"] ?? "");
				return t.toLowerCase() === schemaType.toLowerCase();
			});
			// Also check nested @graph
			const hasInGraph = page.crawl_data.json_ld.some((ld) => {
				const graph = (ld as Record<string, unknown>)["@graph"];
				if (Array.isArray(graph)) {
					return graph.some(
						(item: Record<string, unknown>) =>
							String(item["@type"] ?? "").toLowerCase() === schemaType.toLowerCase(),
					);
				}
				return false;
			});
			if (hasType || hasInGraph) {
				foundOn.push(page.filename);
			}
		}

		const present = foundOn.length > 0;
		const coverage = foundOn.length / Math.max(pages.length, 1);
		const quality: SchemaCoverageEntry["quality"] =
			coverage >= 0.8 ? "excellent" : coverage >= 0.5 ? "good" : coverage > 0 ? "partial" : "none";

		return {
			schema_type: schemaType,
			present,
			pages: foundOn,
			quality,
			details: present
				? `Found on ${foundOn.length}/${pages.length} pages`
				: "Not implemented",
		};
	});
}

// ── Marketing Claims ───────────────────────────────────────

export interface MarketingClaim {
	text: string;
	location: string;
	has_source: boolean;
	verifiability: "verifiable" | "partial" | "unverifiable" | "factual";
}

/** Superlative/claim patterns that need verification */
const CLAIM_PATTERNS = [
	/world['']?s?\s+(?:first|best|fastest|thinnest|lightest|most|largest|smallest)/gi,
	/(?:the\s+)?most\s+(?:preferred|popular|advanced|powerful|innovative)/gi,
	/(?:industry|market)[\s-]leading/gi,
	/#1\s+(?:in|for|brand)/gi,
	/(?:award[\s-]winning|best[\s-]in[\s-]class)/gi,
	/(?:revolutionary|breakthrough|game[\s-]changing)/gi,
];

export function extractMarketingClaims(
	html: string,
	pageUrl: string,
): MarketingClaim[] {
	const textContent = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const claims: MarketingClaim[] = [];
	const seen = new Set<string>();

	for (const pattern of CLAIM_PATTERNS) {
		// Reset lastIndex for global regex
		pattern.lastIndex = 0;
		let match = pattern.exec(textContent);
		while (match) {
			// Extract surrounding context (up to 80 chars around the match)
			const start = Math.max(0, match.index - 20);
			const end = Math.min(textContent.length, match.index + match[0].length + 40);
			const context = textContent.slice(start, end).trim();

			if (!seen.has(context.toLowerCase().slice(0, 50))) {
				seen.add(context.toLowerCase().slice(0, 50));

				// Check if there's a citation nearby (link, footnote, ™, ®, *)
				const nearby = textContent.slice(
					Math.max(0, match.index - 5),
					Math.min(textContent.length, match.index + match[0].length + 100),
				);
				const hasSource =
					/\bhttps?:\/\/\S+/i.test(nearby) ||
					/\*|†|‡|¹|²|³|®|©/i.test(nearby) ||
					/source:|according to|per\s/i.test(nearby);

				claims.push({
					text: context.slice(0, 120),
					location: pageUrl,
					has_source: hasSource,
					verifiability: hasSource ? "partial" : "unverifiable",
				});
			}
			match = pattern.exec(textContent);
		}
	}

	return claims;
}

// ── Product/Price/Spec Extraction ──────────────────────────

export interface ExtractedProductInfo {
	product_name: string | null;
	prices: string[];
	specs_in_html: string[];
	specs_in_schema: string[];
	has_aggregate_rating: boolean;
	rating_value: string | null;
	review_count: string | null;
}

export function extractProductInfo(crawlData: CrawlData): ExtractedProductInfo {
	const html = crawlData.html;
	const jsonLd = crawlData.json_ld;

	// Product name from JSON-LD or title
	let productName: string | null = null;
	let prices: string[] = [];
	const specsInSchema: string[] = [];
	let hasAggregateRating = false;
	let ratingValue: string | null = null;
	let reviewCount: string | null = null;

	for (const ld of jsonLd) {
		const obj = ld as Record<string, unknown>;
		const type = String(obj["@type"] ?? "").toLowerCase();

		if (type === "product") {
			productName = String(obj.name ?? "");

			// Offers
			const offers = obj.offers as Record<string, unknown> | undefined;
			if (offers?.price) {
				const currency = String(offers.priceCurrency ?? "USD");
				prices.push(`${currency} ${offers.price}`);
			}

			// AggregateRating
			const rating = obj.aggregateRating as Record<string, unknown> | undefined;
			if (rating) {
				hasAggregateRating = true;
				ratingValue = String(rating.ratingValue ?? "");
				reviewCount = String(rating.reviewCount ?? "");
			}

			// additionalProperty (specs)
			const props = obj.additionalProperty;
			if (Array.isArray(props)) {
				for (const prop of props) {
					const p = prop as Record<string, unknown>;
					if (p.name && p.value) {
						specsInSchema.push(`${p.name}: ${p.value}`);
					}
				}
			}
		}

		// ItemList with products
		if (type === "itemlist") {
			const items = obj.itemListElement;
			if (Array.isArray(items)) {
				for (const item of items.slice(0, 5)) {
					const it = (item as Record<string, unknown>).item as Record<string, unknown> | undefined;
					if (it?.name) {
						const offer = it.offers as Record<string, unknown> | undefined;
						if (offer?.price) {
							prices.push(`${it.name}: ${offer.priceCurrency ?? "USD"} ${offer.price}`);
						}
					}
				}
			}
		}
	}

	// Extract specs visible in static HTML (price patterns, spec-like numbers)
	const textContent = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ");

	const specsInHtml: string[] = [];

	// Price patterns
	const priceMatches = textContent.match(/\$[\d,]+\.?\d{0,2}/g) ?? [];
	if (priceMatches.length > 0 && prices.length === 0) {
		prices = priceMatches.slice(0, 5);
	}

	// Spec-like patterns
	const specPatterns = [
		/\d+\.?\d*\s*(?:MP|megapixel)/gi,
		/\d+\.?\d*\s*(?:mAh|Wh)/gi,
		/\d+\.?\d*["″]\s*(?:display|screen|inch)/gi,
		/\d+\s*(?:Hz|GHz|MHz)/gi,
		/\d+\s*(?:GB|TB|MB)\b/gi,
		/\d+\.?\d*\s*(?:cu\.?\s*ft|cubic feet)/gi,
		/\d+\.?\d*\s*(?:lbs?|kg)\b/gi,
		/\d+\s*x\s*\d+\s*(?:pixels?|px|resolution)/gi,
	];
	for (const pat of specPatterns) {
		const matches = textContent.match(pat) ?? [];
		for (const m of matches.slice(0, 3)) {
			specsInHtml.push(m.trim());
		}
	}

	return {
		product_name: productName || crawlData.title || null,
		prices: [...new Set(prices)].slice(0, 10),
		specs_in_html: [...new Set(specsInHtml)].slice(0, 15),
		specs_in_schema: specsInSchema,
		has_aggregate_rating: hasAggregateRating,
		rating_value: ratingValue,
		review_count: reviewCount,
	};
}

// ── JS Dependency Analysis ─────────────────────────────────

export interface JsDependencyInfo {
	script_count: number;
	external_scripts: number;
	inline_scripts: number;
	frameworks_detected: string[];
	/** Estimated ratio of content only accessible via JS (0-1) */
	estimated_js_dependency: number;
}

export function analyzeJsDependency(html: string): JsDependencyInfo {
	const scriptTags = html.match(/<script[^>]*>/gi) ?? [];
	const externalScripts = scriptTags.filter((s) => /src=/i.test(s));
	const inlineScripts = scriptTags.filter((s) => !/src=/i.test(s));

	const frameworks: string[] = [];
	const lowerHtml = html.toLowerCase();
	if (lowerHtml.includes("react") || lowerHtml.includes("__next")) frameworks.push("React/Next.js");
	if (lowerHtml.includes("vue") || lowerHtml.includes("__nuxt")) frameworks.push("Vue/Nuxt");
	if (lowerHtml.includes("angular")) frameworks.push("Angular");
	if (lowerHtml.includes("svelte")) frameworks.push("Svelte");
	if (lowerHtml.includes("jquery")) frameworks.push("jQuery");

	// Estimate JS dependency: high script count + framework = likely JS-heavy
	const textContent = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();

	// If very little text content relative to HTML size, likely JS-rendered
	const textRatio = textContent.length / Math.max(html.length, 1);
	const estimated = textRatio < 0.05 ? 0.9 : textRatio < 0.1 ? 0.7 : textRatio < 0.2 ? 0.4 : 0.2;

	return {
		script_count: scriptTags.length,
		external_scripts: externalScripts.length,
		inline_scripts: inlineScripts.length,
		frameworks_detected: frameworks,
		estimated_js_dependency: Math.round(estimated * 100) / 100,
	};
}

// ── Full Evaluation Data ───────────────────────────────────

export interface GeoEvaluationData {
	/** robots.txt AI 봇별 정책 */
	bot_policies: BotPolicyEntry[];
	/** llms.txt 상태 */
	llms_txt: {
		exists: boolean;
		content_preview: string | null;
	};
	/** 스키마 커버리지 매트릭스 */
	schema_coverage: SchemaCoverageEntry[];
	/** 마케팅 클레임 목록 */
	marketing_claims: MarketingClaim[];
	/** JS 의존성 분석 (홈페이지) */
	js_dependency: JsDependencyInfo;
	/** 제품 정보 추출 (페이지별) */
	product_info: Array<{
		page_url: string;
		filename: string;
		info: ExtractedProductInfo;
	}>;
	/** 블록된 주요 경로 */
	blocked_paths: string[];
}

/**
 * CrawlData + 멀티페이지 결과로부터 전체 GEO 평가 상세 데이터를 추출한다.
 */
export function extractGeoEvaluationData(
	homepage: CrawlData,
	subPages: Array<{ url: string; filename: string; crawl_data: CrawlData }>,
): GeoEvaluationData {
	const allPages = [
		{ url: homepage.url, filename: "index.html", crawl_data: homepage },
		...subPages,
	];

	// 1. robots.txt bot policies
	const botPolicies = parseRobotsTxt(homepage.robots_txt);

	// 2. llms.txt
	const llmsTxt = {
		exists: homepage.llms_txt !== null,
		content_preview: homepage.llms_txt?.slice(0, 500) ?? null,
	};

	// 3. Schema coverage across all pages
	const schemaCoverage = extractSchemaCoverage(allPages);

	// 4. Marketing claims (from all pages)
	const allClaims: MarketingClaim[] = [];
	for (const page of allPages) {
		const claims = extractMarketingClaims(page.crawl_data.html, page.url);
		allClaims.push(...claims);
	}

	// 5. JS dependency (homepage)
	const jsDependency = analyzeJsDependency(homepage.html);

	// 6. Product info per page
	const productInfo = allPages.map((page) => ({
		page_url: page.url,
		filename: page.filename,
		info: extractProductInfo(page.crawl_data),
	}));

	// 7. Blocked paths (unique from all bots)
	const blockedPaths = [
		...new Set(botPolicies.flatMap((b) => b.disallowed_paths)),
	].filter((p) => p !== "/");

	return {
		bot_policies: botPolicies,
		llms_txt: llmsTxt,
		schema_coverage: schemaCoverage,
		marketing_claims: allClaims.slice(0, 20),
		js_dependency: jsDependency,
		product_info: productInfo,
		blocked_paths: blockedPaths,
	};
}
