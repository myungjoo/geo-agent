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
				: "Not found on any page",
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

export function extractMarketingClaims(html: string, pageUrl: string): MarketingClaim[] {
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

// ── Strengths / Weaknesses / Opportunities ──────────────────

export interface Finding {
	title: string;
	description: string;
	icon: string;
}

/**
 * 분석 데이터로부터 잘 된 점 / 취약점 / 기회를 자동 생성한다.
 */
export function generateFindings(
	botPolicies: BotPolicyEntry[],
	llmsTxt: { exists: boolean; content_preview: string | null },
	schemaCoverage: SchemaCoverageEntry[],
	productInfo: Array<{ page_url: string; filename: string; info: ExtractedProductInfo }>,
	jsDependency: JsDependencyInfo,
	marketingClaims: MarketingClaim[],
	dimensions?: Array<{ id: string; label: string; score: number }>,
): { strengths: Finding[]; weaknesses: Finding[]; opportunities: Finding[] } {
	const strengths: Finding[] = [];
	const weaknesses: Finding[] = [];
	const opportunities: Finding[] = [];

	// ── Strengths ──
	const allowedBots = botPolicies.filter((b) => b.status === "allowed" || b.status === "partial");
	if (allowedBots.length >= 3) {
		strengths.push({
			title: "주요 AI 봇 허용",
			description: `${allowedBots.map((b) => b.bot_name).join(", ")} 등 ${allowedBots.length}개 AI 봇에 대해 크롤링 허용/부분 허용. LLM이 제품 정보에 접근 가능.`,
			icon: "✅",
		});
	}

	const presentSchemas = schemaCoverage.filter((s) => s.present);
	if (presentSchemas.length >= 3) {
		const types = presentSchemas.map((s) => s.schema_type).join(", ");
		strengths.push({
			title: "다수 Schema.org 타입 구현",
			description: `${types} 등 ${presentSchemas.length}개 스키마 타입 구현. LLM이 구조적으로 정보를 파싱 가능.`,
			icon: "✅",
		});
	}

	const pagesWithProduct = productInfo.filter(
		(p) => p.info.product_name || p.info.specs_in_schema.length > 0 || p.info.has_aggregate_rating,
	);
	if (pagesWithProduct.length > 0) {
		const names = pagesWithProduct
			.slice(0, 3)
			.map((p) => p.info.product_name ?? p.filename)
			.join(", ");
		strengths.push({
			title: "제품 구조화 데이터 존재",
			description: `${pagesWithProduct.length}개 페이지에서 제품 정보 구조화 (${names}). LLM이 제품명/가격/평점 파악 가능.`,
			icon: "✅",
		});
	}

	const orgSchema = schemaCoverage.find(
		(s) => (s.schema_type === "Organization" || s.schema_type === "Corporation") && s.present,
	);
	if (orgSchema) {
		strengths.push({
			title: `${orgSchema.schema_type} 스키마 구현`,
			description:
				"홈페이지에 기업 스키마 구현으로 LLM이 회사 정보(설립 연도, 사업 분야)를 인식 가능.",
			icon: "✅",
		});
	}

	if (dimensions) {
		const highDims = dimensions.filter((d) => d.score >= 70);
		for (const dim of highDims.slice(0, 2)) {
			strengths.push({
				title: `${dim.label} 우수 (${dim.score.toFixed(0)}점)`,
				description: `${dim.id} ${dim.label} 영역에서 높은 점수를 기록. GEO 최적화가 잘 된 영역.`,
				icon: "✅",
			});
		}
	}

	// ── Weaknesses ──
	if (!llmsTxt.exists) {
		weaknesses.push({
			title: "llms.txt 미존재",
			description:
				"GEO 필수 요소인 llms.txt 파일이 없음. LLM에게 사이트 구조, 인용 허용 범위, 제품 정보 소스를 안내하지 못함.",
			icon: "❌",
		});
	}

	const missingCritical = schemaCoverage.filter(
		(s) => !s.present && ["Product", "Offer", "AggregateRating"].includes(s.schema_type),
	);
	if (missingCritical.length > 0) {
		weaknesses.push({
			title: `핵심 스키마 미구현: ${missingCritical.map((s) => s.schema_type).join(", ")}`,
			description:
				"주력 제품 페이지에 표준 Product/Offer/AggregateRating 스키마 없음. LLM이 제품 정보를 구조적으로 파싱 불가.",
			icon: "❌",
		});
	}

	if (jsDependency.estimated_js_dependency > 0.5) {
		weaknesses.push({
			title: "JavaScript 과의존 · 스펙 데이터 부재",
			description: `JS 의존도 ${Math.round(jsDependency.estimated_js_dependency * 100)}%. 주요 스펙이 JS 렌더링 후에만 노출. LLM 크롤러 대부분이 정적 HTML만 수집하므로 정보 손실.`,
			icon: "❌",
		});
	}

	const notSpecBots = botPolicies.filter((b) => b.status === "not_specified");
	if (notSpecBots.length >= 2) {
		weaknesses.push({
			title: `${notSpecBots.length}개 AI 봇 미명시`,
			description: `${notSpecBots.map((b) => b.bot_name).join(", ")}에 대한 정책 미명시. 기본 크롤러 규칙만 적용.`,
			icon: "⚠️",
		});
	}

	const unverified = marketingClaims.filter((c) => c.verifiability === "unverifiable");
	if (unverified.length >= 2) {
		weaknesses.push({
			title: `${unverified.length}개 마케팅 클레임 출처 없음`,
			description: "출처 없는 마케팅 주장이 다수. LLM 팩트 체크 시 신뢰도 저하 위험.",
			icon: "⚠️",
		});
	}

	if (dimensions) {
		const lowDims = dimensions.filter((d) => d.score < 30);
		for (const dim of lowDims.slice(0, 2)) {
			weaknesses.push({
				title: `${dim.label} 매우 미흡 (${dim.score.toFixed(0)}점)`,
				description: `${dim.id} 영역이 심각하게 낮음. 구조화 데이터와 콘텐츠 보강 시급.`,
				icon: "❌",
			});
		}
	}

	// ── Opportunities ──
	if (missingCritical.length > 0) {
		opportunities.push({
			title: "Product Schema + 스펙 additionalProperty 추가",
			description:
				"주력 제품에 Product + Offer + AggregateRating 스키마 적용 시 LLM 인용률 대폭 향상 기대. 업계 데이터: 스키마 적용 시 AI 정답률 16%→54%.",
			icon: "🚀",
		});
	}

	if (!llmsTxt.exists) {
		opportunities.push({
			title: "llms.txt 도입",
			description:
				"llms.txt 생성으로 LLM에게 제품 데이터 소스, 인용 가이드라인, API 엔드포인트를 명시적으로 제공 가능.",
			icon: "🚀",
		});
	}

	const faqMissing = !schemaCoverage.find((s) => s.schema_type === "FAQPage" && s.present);
	if (faqMissing) {
		opportunities.push({
			title: "FAQPage 스키마 추가",
			description: "주요 질의 패턴에 맞는 FAQ 구조화 데이터 추가로 AI Overview 노출 증가 가능.",
			icon: "🚀",
		});
	}

	if (jsDependency.estimated_js_dependency > 0.3) {
		opportunities.push({
			title: "SSR/SSG로 정적 HTML 콘텐츠 강화",
			description:
				"핵심 스펙/가격 데이터를 정적 HTML에 포함 시 LLM 크롤러가 JS 없이도 정보 수집 가능.",
			icon: "🚀",
		});
	}

	return {
		strengths: strengths.slice(0, 5),
		weaknesses: weaknesses.slice(0, 5),
		opportunities: opportunities.slice(0, 5),
	};
}

// ── Allowed Paths Analysis ──────────────────────────────────

export interface PathAccessEntry {
	path: string;
	status: "allowed" | "blocked";
}

export function analyzePathAccess(robotsTxt: string | null): PathAccessEntry[] {
	if (!robotsTxt) return [];

	const entries: PathAccessEntry[] = [];
	const lines = robotsTxt.split("\n").map((l) => l.trim());
	let inAiBlock = false;

	for (const line of lines) {
		const lower = line.toLowerCase();
		if (lower.startsWith("user-agent:")) {
			const agent = line.slice(11).trim();
			inAiBlock = AI_BOTS.some((b) => b.name.toLowerCase() === agent.toLowerCase());
		} else if (inAiBlock) {
			if (lower.startsWith("disallow:")) {
				const path = line.slice(9).trim();
				if (path && path !== "/") entries.push({ path, status: "blocked" });
			} else if (lower.startsWith("allow:")) {
				const path = line.slice(6).trim();
				if (path) entries.push({ path, status: "allowed" });
			}
		}
	}

	return entries;
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
	/** 허용/차단 경로 상세 */
	path_access: PathAccessEntry[];
	/** 잘 된 점 */
	strengths: Finding[];
	/** 취약점 */
	weaknesses: Finding[];
	/** 기회 */
	opportunities: Finding[];
	/** 개선 권고사항 (impact/difficulty/sprint 포함) */
	improvements: ImprovementRecommendation[];
}

// ── Improvement Recommendations ────────────────────────────

export interface ImprovementRecommendation {
	id: string;
	title: string;
	description: string;
	impact: 1 | 2 | 3 | 4 | 5;
	difficulty: 1 | 2 | 3 | 4 | 5;
	sprint: 1 | 2 | 3;
	affected_dimensions: string[];
	current_state: string;
}

/**
 * 분석 데이터로부터 개선 권고사항을 자동 생성한다.
 */
export function generateImprovements(
	evalData: Omit<GeoEvaluationData, "improvements">,
	dimensions: Array<{ id: string; label: string; score: number }>,
): ImprovementRecommendation[] {
	const recs: ImprovementRecommendation[] = [];
	let counter = 1;

	// llms.txt
	if (!evalData.llms_txt.exists) {
		recs.push({
			id: `R-${counter++}`,
			title: "llms.txt 파일 생성 및 배포",
			description:
				"LLM에게 사이트 구조, 제품 카탈로그 위치, 인용 가이드라인을 명시적으로 안내하는 llms.txt 파일을 생성하세요.",
			impact: 5,
			difficulty: 1,
			sprint: 1,
			affected_dimensions: ["S1", "S6"],
			current_state: "llms.txt 미존재 (HTTP 404)",
		});
	}

	// ClaudeBot / Applebot not specified
	const unspecifiedBots = evalData.bot_policies.filter((b) => b.status === "not_specified");
	if (unspecifiedBots.length > 0) {
		recs.push({
			id: `R-${counter++}`,
			title: `robots.txt에 ${unspecifiedBots.map((b) => b.bot_name).join(", ")} 명시 추가`,
			description:
				"주요 AI 봇에 대한 접근 정책을 robots.txt에 명시적으로 추가하여 크롤링 허용/차단을 명확히 하세요.",
			impact: 3,
			difficulty: 1,
			sprint: 1,
			affected_dimensions: ["S1"],
			current_state: `${unspecifiedBots.length}개 AI 봇 미명시 (기본 규칙 적용)`,
		});
	}

	// Missing schemas
	const missingSchemas = evalData.schema_coverage.filter((s) => !s.present);
	const criticalMissing = missingSchemas.filter((s) =>
		["Product", "Offer", "AggregateRating", "BreadcrumbList", "FAQPage"].includes(s.schema_type),
	);
	if (criticalMissing.length > 0) {
		for (const schema of criticalMissing) {
			const schemaImpact = ["Product", "Offer"].includes(schema.schema_type) ? 5 : 4;
			recs.push({
				id: `R-${counter++}`,
				title: `${schema.schema_type} Schema 구현`,
				description: `${schema.schema_type} JSON-LD 스키마를 구현하여 LLM이 제품/서비스 정보를 구조적으로 파싱할 수 있도록 하세요.`,
				impact: schemaImpact as 1 | 2 | 3 | 4 | 5,
				difficulty: schema.schema_type === "BreadcrumbList" ? 1 : 2,
				sprint: schemaImpact >= 5 ? 1 : 2,
				affected_dimensions: ["S2", "S3"],
				current_state: `${schema.schema_type} 미구현`,
			});
		}
	}

	// Unverifiable marketing claims
	const unverifiedClaims = evalData.marketing_claims.filter(
		(c) => c.verifiability === "unverifiable",
	);
	if (unverifiedClaims.length >= 2) {
		recs.push({
			id: `R-${counter++}`,
			title: "마케팅 클레임에 검증 가능한 근거 추가",
			description: `${unverifiedClaims.length}개 마케팅 클레임에 출처(수상 기관, 조사 기관, 특허 번호 등)를 인용 마크업으로 추가하세요. LLM 팩트 체크 시 신뢰도가 향상됩니다.`,
			impact: 3,
			difficulty: 2,
			sprint: 2,
			affected_dimensions: ["S4", "S5"],
			current_state: `${unverifiedClaims.length}개 클레임 출처 없음`,
		});
	}

	// High JS dependency
	if (evalData.js_dependency.estimated_js_dependency > 0.5) {
		recs.push({
			id: `R-${counter++}`,
			title: "핵심 콘텐츠 정적 HTML 노출 (SSR/SSG)",
			description:
				"JavaScript 렌더링 후에만 보이는 스펙/가격 데이터를 정적 HTML에도 포함하세요. LLM 크롤러 대부분이 JS를 실행하지 않습니다.",
			impact: 5,
			difficulty: 4,
			sprint: 2,
			affected_dimensions: ["S3", "S4"],
			current_state: `JS 의존도 ${Math.round(evalData.js_dependency.estimated_js_dependency * 100)}%`,
		});
	}

	// Product info gaps: pages with no schema but HTML specs
	const pagesWithGaps = evalData.product_info.filter(
		(p) => p.info.specs_in_html.length > 0 && p.info.specs_in_schema.length === 0,
	);
	if (pagesWithGaps.length > 0) {
		recs.push({
			id: `R-${counter++}`,
			title: "제품 스펙 데이터를 Schema additionalProperty로 구조화",
			description: `${pagesWithGaps.length}개 페이지에서 스펙 데이터가 HTML에 존재하지만 Schema.org로 구조화되지 않았습니다. additionalProperty/PropertyValue를 추가하세요.`,
			impact: 5,
			difficulty: 2,
			sprint: 2,
			affected_dimensions: ["S2", "S3"],
			current_state: `${pagesWithGaps.length}개 페이지 스펙 비구조화`,
		});
	}

	// Low-scoring dimensions
	for (const dim of dimensions) {
		if (dim.score < 30 && !recs.some((r) => r.affected_dimensions.includes(dim.id))) {
			recs.push({
				id: `R-${counter++}`,
				title: `${dim.id} ${dim.label} 개선 필요`,
				description: `${dim.label} 점수가 ${dim.score.toFixed(0)}점으로 매우 낮습니다. 해당 영역의 구조화 데이터와 콘텐츠를 보강하세요.`,
				impact: 4,
				difficulty: 3,
				sprint: 2,
				affected_dimensions: [dim.id],
				current_state: `${dim.score.toFixed(0)}/100`,
			});
		}
	}

	// Organization sameAs (Wikipedia/Wikidata)
	const orgSchema = evalData.schema_coverage.find(
		(s) => s.schema_type === "Organization" || s.schema_type === "Corporation",
	);
	if (orgSchema?.present) {
		recs.push({
			id: `R-${counter++}`,
			title: "Corporation sameAs에 Wikipedia/Wikidata URL 추가",
			description:
				"Organization/Corporation 스키마의 sameAs 배열에 Wikipedia, Wikidata URL을 추가하여 LLM Knowledge Graph 연결을 강화하세요.",
			impact: 3,
			difficulty: 1,
			sprint: 1,
			affected_dimensions: ["S5", "S6"],
			current_state: "sameAs에 소셜 링크만 존재 (추정)",
		});
	}

	// dateModified recommendation
	const webPageSchema = evalData.schema_coverage.find((s) => s.schema_type === "WebPage");
	if (webPageSchema?.present) {
		recs.push({
			id: `R-${counter++}`,
			title: "dateModified / datePublished 전면 적용",
			description:
				"모든 WebPage/Product 스키마에 dateModified를 추가하여 LLM이 정보 최신성을 판단할 수 있게 하세요.",
			impact: 2,
			difficulty: 1,
			sprint: 1,
			affected_dimensions: ["S6"],
			current_state: "dateModified 미적용 (추정)",
		});
	}

	// Sort by impact desc, then difficulty asc
	recs.sort((a, b) => b.impact - a.impact || a.difficulty - b.difficulty);

	return recs;
}

/**
 * CrawlData + 멀티페이지 결과로부터 전체 GEO 평가 상세 데이터를 추출한다.
 */
export function extractGeoEvaluationData(
	homepage: CrawlData,
	subPages: Array<{ url: string; filename: string; crawl_data: CrawlData }>,
	dimensions?: Array<{ id: string; label: string; score: number }>,
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
	const blockedPaths = [...new Set(botPolicies.flatMap((b) => b.disallowed_paths))].filter(
		(p) => p !== "/",
	);

	// 8. Path access analysis
	const pathAccess = analyzePathAccess(homepage.robots_txt);

	// 9. Strengths / Weaknesses / Opportunities
	const findings = generateFindings(
		botPolicies,
		llmsTxt,
		schemaCoverage,
		productInfo,
		jsDependency,
		allClaims,
		dimensions,
	);

	const baseData = {
		bot_policies: botPolicies,
		llms_txt: llmsTxt,
		schema_coverage: schemaCoverage,
		marketing_claims: allClaims.slice(0, 20),
		js_dependency: jsDependency,
		product_info: productInfo,
		blocked_paths: blockedPaths,
		path_access: pathAccess,
		strengths: findings.strengths,
		weaknesses: findings.weaknesses,
		opportunities: findings.opportunities,
	};

	// 10. Generate improvement recommendations
	const improvements = generateImprovements(baseData, dimensions ?? []);

	return {
		...baseData,
		improvements,
	};
}
