import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
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
import type { CrawlData, PageScoreResult } from "../shared/types.js";

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

/**
 * Collect JSON-LD snippets for a given schema type across pages (truncated for LLM context).
 */
function collectJsonLdSnippets(
	schemaType: string,
	pages: Array<{ url: string; filename: string; crawl_data: CrawlData }>,
	maxSnippets = 3,
	maxSnippetLength = 500,
): string[] {
	const snippets: string[] = [];
	for (const page of pages) {
		if (snippets.length >= maxSnippets) break;
		for (const ld of page.crawl_data.json_ld) {
			if (snippets.length >= maxSnippets) break;
			const obj = ld as Record<string, unknown>;
			const t = String(obj["@type"] ?? "").toLowerCase();
			if (t === schemaType.toLowerCase()) {
				const raw = JSON.stringify(ld);
				snippets.push(raw.length > maxSnippetLength ? `${raw.slice(0, maxSnippetLength)}...` : raw);
				continue;
			}
			// Check @graph
			const graph = obj["@graph"];
			if (Array.isArray(graph)) {
				for (const item of graph) {
					if (snippets.length >= maxSnippets) break;
					const it = item as Record<string, unknown>;
					if (String(it["@type"] ?? "").toLowerCase() === schemaType.toLowerCase()) {
						const raw = JSON.stringify(item);
						snippets.push(
							raw.length > maxSnippetLength ? `${raw.slice(0, maxSnippetLength)}...` : raw,
						);
					}
				}
			}
		}
	}
	return snippets;
}

export async function extractSchemaCoverage(
	pages: Array<{ url: string; filename: string; crawl_data: CrawlData }>,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<SchemaCoverageEntry[]> {
	// Step 1: Hardcoded schema type existence checking
	const entries: Array<{
		schemaType: string;
		foundOn: string[];
		present: boolean;
		snippets: string[];
	}> = SCHEMA_TYPES_TO_CHECK.map((schemaType) => {
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
		const snippets = present ? collectJsonLdSnippets(schemaType, pages) : [];
		return { schemaType, foundOn, present, snippets };
	});

	// Step 2: Quality judgment — LLM-based (필수, ARCHITECTURE.md 9-A.1)
	{
		const presentEntries = entries.filter((e) => e.present);
		if (presentEntries.length > 0) {
			// Build LLM prompt with collected data
			const schemaDataForLLM = presentEntries.map((e) => ({
				schema_type: e.schemaType,
				presence_count: e.foundOn.length,
				total_pages: pages.length,
				sample_snippets: e.snippets,
			}));

			const prompt = `Evaluate the quality of each schema.org type implementation based on completeness of properties, correctness of values, and adherence to best practices.

For each schema type below, I provide the presence count (how many pages have it) and sample JSON-LD snippets.

${JSON.stringify(schemaDataForLLM, null, 2)}

For each schema type, assess quality as one of:
- "excellent": Complete properties, correct values, follows best practices
- "good": Most important properties present, minor issues
- "partial": Minimal implementation, missing key properties
- "none": Should not be used (only for types not present)

Return ONLY a JSON object mapping schema type names to quality values, like:
{"Organization": "good", "Product": "excellent", "WebPage": "partial"}`;

			try {
				const response = await chatLLM({
					prompt,
					system_instruction: "You are a schema.org expert. Return only valid JSON.",
					temperature: 0.1,
					json_mode: false,
				});

				const content = response.content.trim();
				const jsonMatch = content.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const qualityMap = JSON.parse(jsonMatch[0]) as Record<string, string>;
					const validQualities = ["excellent", "good", "partial", "none"];

					return entries.map((e) => {
						const llmQuality = qualityMap[e.schemaType];
						let quality: SchemaCoverageEntry["quality"];
						if (e.present && llmQuality && validQualities.includes(llmQuality)) {
							quality = llmQuality as SchemaCoverageEntry["quality"];
						} else if (!e.present) {
							quality = "none";
						} else {
							// LLM didn't provide quality for this type — use heuristic fallback
							const coverage = e.foundOn.length / Math.max(pages.length, 1);
							quality = coverage >= 0.8 ? "excellent" : coverage >= 0.5 ? "good" : "partial";
						}
						return {
							schema_type: e.schemaType,
							present: e.present,
							pages: e.foundOn,
							quality,
							details: e.present
								? `Found on ${e.foundOn.length}/${pages.length} pages`
								: "Not found on any page",
						};
					});
				}
			} catch {
				// LLM call failed — fall through to heuristic
			}
		}
	}

	// Fallback: coverage-ratio heuristic
	return entries.map((e) => {
		const coverage = e.foundOn.length / Math.max(pages.length, 1);
		const quality: SchemaCoverageEntry["quality"] =
			coverage >= 0.8 ? "excellent" : coverage >= 0.5 ? "good" : coverage > 0 ? "partial" : "none";
		return {
			schema_type: e.schemaType,
			present: e.present,
			pages: e.foundOn,
			quality,
			details: e.present
				? `Found on ${e.foundOn.length}/${pages.length} pages`
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

/**
 * Strip HTML tags and extract visible text content, truncated to a max length.
 */
function stripHtmlToText(html: string, maxLength = 2000): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

/**
 * LLM-based marketing claim extraction.
 *
 * For each page, sends visible text to the LLM and asks it to identify
 * marketing claims matching the MarketingClaim interface.
 */
export async function extractMarketingClaims(
	pages: Array<{ url: string; html: string }>,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<MarketingClaim[]> {
	const allClaims: MarketingClaim[] = [];

	for (const page of pages) {
		const text = stripHtmlToText(page.html);
		if (text.length < 20) continue;

		const prompt = `Analyze the following web page text and identify marketing claims — superlative statements, unverified assertions, award claims, or competitive positioning statements that an LLM fact-checker might question.

Page URL: ${page.url}

--- PAGE TEXT ---
${text}
--- END ---

Return a JSON array of marketing claims. Each claim must have:
- "text": the exact claim text (max 120 chars)
- "location": the page URL "${page.url}"
- "has_source": boolean — true if the claim includes or references a source, citation, trademark symbol, or evidence
- "verifiability": one of "verifiable", "partial", "unverifiable", "factual"
  - "verifiable" = claim can be clearly fact-checked with public data (awards, rankings, patents)
  - "partial" = claim has some supporting evidence but not fully sourced
  - "unverifiable" = factual-sounding claim with no evidence ("world's first", "#1 brand")
  - "factual" = objectively true and easily confirmed fact

If there are no marketing claims, return an empty array: []

Respond with ONLY the JSON array, no other text.`;

		try {
			const response = await chatLLM({
				prompt,
				system_instruction: "You are a marketing claim analyzer. Return only valid JSON arrays.",
				temperature: 0.1,
				json_mode: false,
			});

			const content = response.content.trim();
			// Extract JSON array from response (handle markdown code blocks)
			const jsonMatch = content.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as unknown[];
				for (const item of parsed) {
					const claim = item as Record<string, unknown>;
					if (
						typeof claim.text === "string" &&
						typeof claim.location === "string" &&
						typeof claim.has_source === "boolean" &&
						typeof claim.verifiability === "string" &&
						["verifiable", "partial", "unverifiable", "factual"].includes(claim.verifiability)
					) {
						allClaims.push({
							text: String(claim.text).slice(0, 120),
							location: String(claim.location),
							has_source: Boolean(claim.has_source),
							verifiability: claim.verifiability as MarketingClaim["verifiability"],
						});
					}
				}
			}
		} catch {
			// LLM call failed for this page — skip silently
		}
	}

	return allClaims;
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

	// Only fall back to page title as product_name if the page has product signals
	// (prices, specs, ratings). Without signals, page titles like
	// "Samsung 대한민국 | 모바일 | TV | 가전 | IT" pollute the FactSet.
	const hasProductSignals =
		prices.length > 0 || specsInHtml.length > 0 || specsInSchema.length > 0 || hasAggregateRating;

	return {
		product_name: productName || (hasProductSignals ? crawlData.title : null) || null,
		prices: [...new Set(prices)].slice(0, 10),
		specs_in_html: [...new Set(specsInHtml)].slice(0, 15),
		specs_in_schema: specsInSchema,
		has_aggregate_rating: hasAggregateRating,
		rating_value: ratingValue,
		review_count: reviewCount,
	};
}

// ── JS Dependency Analysis ─────────────────────────────────

/**
 * Extract script-related content from HTML for framework detection.
 * Returns script src URLs and truncated inline script content.
 */
function extractScriptEvidence(html: string): string {
	const parts: string[] = [];

	// Extract script src attributes
	const srcMatches = html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi);
	for (const m of srcMatches) {
		parts.push(`src: ${m[1]}`);
	}

	// Extract inline script content (truncated)
	const inlineMatches = html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi);
	for (const m of inlineMatches) {
		const content = m[1].trim();
		if (content.length > 0) {
			parts.push(`inline: ${content.slice(0, 500)}`);
		}
	}

	return parts.join("\n");
}

/**
 * Detect frameworks from script tags only (avoiding body text false positives).
 * When chatLLM is provided, uses LLM for accurate detection.
 * Otherwise, applies heuristics scoped to script tags and known DOM markers.
 */
async function detectFrameworks(
	html: string,
	scriptTags: string[],
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<string[]> {
	return detectFrameworksLLM(html, chatLLM);
}

/**
 * Heuristic framework detection: only examines script tags (src + inline content)
 * and a small set of reliable DOM markers (e.g., id="__next", data-reactroot).
 */
function detectFrameworksHeuristic(html: string, scriptTags: string[]): string[] {
	const frameworks: string[] = [];

	// Collect script src URLs and inline content for matching
	const scriptContent = extractScriptEvidence(html).toLowerCase();

	// Check script-related evidence
	if (
		scriptContent.includes("react") ||
		scriptContent.includes("__next") ||
		scriptContent.includes("next.js")
	) {
		frameworks.push("React/Next.js");
	}
	if (
		scriptContent.includes("vue") ||
		scriptContent.includes("__nuxt") ||
		scriptContent.includes("nuxt")
	) {
		frameworks.push("Vue/Nuxt");
	}
	if (scriptContent.includes("angular")) {
		frameworks.push("Angular");
	}
	if (scriptContent.includes("svelte")) {
		frameworks.push("Svelte");
	}
	if (scriptContent.includes("jquery") || scriptContent.includes("jquery.min.js")) {
		frameworks.push("jQuery");
	}

	// Also check reliable DOM markers (these are framework-generated, not body text)
	const lowerHtml = html.toLowerCase();
	if (
		!frameworks.includes("React/Next.js") &&
		(lowerHtml.includes('id="__next"') ||
			lowerHtml.includes("data-reactroot") ||
			lowerHtml.includes("data-react-helmet"))
	) {
		frameworks.push("React/Next.js");
	}
	if (
		!frameworks.includes("Vue/Nuxt") &&
		(lowerHtml.includes('id="__nuxt"') ||
			lowerHtml.includes("data-v-") ||
			lowerHtml.includes("data-server-rendered"))
	) {
		frameworks.push("Vue/Nuxt");
	}
	if (
		!frameworks.includes("Angular") &&
		(lowerHtml.includes("ng-version") || lowerHtml.includes("_ngcontent"))
	) {
		frameworks.push("Angular");
	}

	return frameworks;
}

/**
 * LLM-based framework detection using script tag evidence.
 */
async function detectFrameworksLLM(
	html: string,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<string[]> {
	const evidence = extractScriptEvidence(html);
	if (!evidence) {
		return [];
	}

	const prompt = `Analyze these script tags from a web page and identify which JavaScript frameworks are used.

## Script evidence
${evidence.slice(0, 3000)}

## Instructions
Based ONLY on the script tag evidence above (src URLs and inline code), identify which JavaScript frameworks or libraries are used on this page. Only report frameworks you can confirm from the script evidence.

Use these canonical names: "React/Next.js", "Vue/Nuxt", "Angular", "Svelte", "jQuery", or other framework names.

Return ONLY a JSON object: {"frameworks": ["React/Next.js", "jQuery"]}
If no frameworks are detected, return: {"frameworks": []}`;

	try {
		const response = await chatLLM({
			prompt,
			system_instruction:
				"You are a web technology expert. Identify JavaScript frameworks from script tags. Return only valid JSON.",
			temperature: 0.1,
			json_mode: false,
		});

		const content = response.content.trim();
		const jsonMatch = content.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
			if (Array.isArray(parsed.frameworks)) {
				return parsed.frameworks.filter(
					(f: unknown): f is string => typeof f === "string" && f.length > 0,
				);
			}
		}
	} catch {
		// LLM call failed — fall back to heuristic
	}

	// Fallback: use heuristic if LLM fails
	const scriptTags = html.match(/<script[^>]*>/gi) ?? [];
	return detectFrameworksHeuristic(html, scriptTags);
}

export interface LLMAccessImpact {
	blocks_access: boolean;
	severity: "none" | "low" | "moderate" | "high";
	reasoning: string;
}

export interface JsDependencyInfo {
	script_count: number;
	external_scripts: number;
	inline_scripts: number;
	frameworks_detected: string[];
	/** Estimated ratio of content only accessible via JS (0-1) */
	estimated_js_dependency: number;
	/** LLM-based judgment of whether JS blocks LLM content access (present only when chatLLM provided) */
	llm_access_impact?: LLMAccessImpact;
}

export async function analyzeJsDependency(
	html: string,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
): Promise<JsDependencyInfo> {
	const scriptTags = html.match(/<script[^>]*>/gi) ?? [];
	const externalScripts = scriptTags.filter((s) => /src=/i.test(s));
	const inlineScripts = scriptTags.filter((s) => !/src=/i.test(s));

	// Extract framework info from script tags only (not body text) to avoid false positives
	const frameworks: string[] = await detectFrameworks(html, scriptTags, chatLLM);

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

	const result: JsDependencyInfo = {
		script_count: scriptTags.length,
		external_scripts: externalScripts.length,
		inline_scripts: inlineScripts.length,
		frameworks_detected: frameworks,
		estimated_js_dependency: Math.round(estimated * 100) / 100,
	};

	// LLM-based judgment of whether JS blocks LLM crawler content access (필수)
	{
		const textExcerpt = textContent.slice(0, 1500);
		const prompt = `You are analyzing a web page's JavaScript dependency to determine if JS blocks LLM crawlers from accessing key content.

## Metrics
- Total script tags: ${scriptTags.length}
- External scripts: ${externalScripts.length}
- Inline scripts: ${inlineScripts.length}
- Frameworks detected: ${frameworks.length > 0 ? frameworks.join(", ") : "none"}
- Text-to-HTML ratio: ${(textRatio * 100).toFixed(1)}%
- Estimated JS dependency: ${(estimated * 100).toFixed(0)}%

## Static HTML text excerpt (first 1500 chars after stripping scripts/styles/tags)
${textExcerpt || "(empty — no visible text in static HTML)"}

## Question
Based on these JS metrics and the static HTML content, does JavaScript block LLM crawlers from accessing the page's key content? Most LLM crawlers only read static HTML and do not execute JavaScript.

Return ONLY a JSON object:
{"blocks_access": true/false, "severity": "none"|"low"|"moderate"|"high", "reasoning": "one sentence explanation"}`;

		try {
			const response = await chatLLM({
				prompt,
				system_instruction:
					"You are a web accessibility and crawlability expert. Return only valid JSON.",
				temperature: 0.1,
				json_mode: false,
			});

			const content = response.content.trim();
			const jsonMatch = content.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
				const validSeverities = ["none", "low", "moderate", "high"];
				if (
					typeof parsed.blocks_access === "boolean" &&
					typeof parsed.severity === "string" &&
					validSeverities.includes(parsed.severity) &&
					typeof parsed.reasoning === "string"
				) {
					result.llm_access_impact = {
						blocks_access: parsed.blocks_access,
						severity: parsed.severity as LLMAccessImpact["severity"],
						reasoning: String(parsed.reasoning).slice(0, 500),
					};
				}
			}
		} catch {
			// LLM call failed — leave llm_access_impact undefined
		}
	}

	return result;
}

// ── Strengths / Weaknesses / Opportunities ──────────────────

export interface Finding {
	title: string;
	description: string;
	icon: string;
}

/**
 * Build a concise text summary of all evaluation data for the LLM prompt.
 */
function buildFindingsSummary(
	botPolicies: BotPolicyEntry[],
	llmsTxt: { exists: boolean; content_preview: string | null },
	schemaCoverage: SchemaCoverageEntry[],
	productInfo: Array<{ page_url: string; filename: string; info: ExtractedProductInfo }>,
	jsDependency: JsDependencyInfo,
	marketingClaims: MarketingClaim[],
	dimensions?: Array<{ id: string; label: string; score: number }>,
): string {
	const lines: string[] = [];

	// Bot policies
	const allowed = botPolicies.filter((b) => b.status === "allowed");
	const partial = botPolicies.filter((b) => b.status === "partial");
	const blocked = botPolicies.filter((b) => b.status === "blocked");
	const notSpec = botPolicies.filter((b) => b.status === "not_specified");
	lines.push("## AI Bot Policies (robots.txt)");
	if (allowed.length > 0) lines.push(`- Allowed: ${allowed.map((b) => b.bot_name).join(", ")}`);
	if (partial.length > 0)
		lines.push(
			`- Partial: ${partial.map((b) => `${b.bot_name} (blocked: ${b.disallowed_paths.join(", ")})`).join("; ")}`,
		);
	if (blocked.length > 0) lines.push(`- Blocked: ${blocked.map((b) => b.bot_name).join(", ")}`);
	if (notSpec.length > 0)
		lines.push(`- Not specified: ${notSpec.map((b) => b.bot_name).join(", ")}`);

	// llms.txt
	lines.push("\n## llms.txt");
	lines.push(`- Exists: ${llmsTxt.exists}`);

	// Schema coverage
	const present = schemaCoverage.filter((s) => s.present);
	const missing = schemaCoverage.filter((s) => !s.present);
	lines.push("\n## Schema Coverage");
	if (present.length > 0)
		lines.push(`- Present: ${present.map((s) => `${s.schema_type} (${s.quality})`).join(", ")}`);
	if (missing.length > 0) lines.push(`- Missing: ${missing.map((s) => s.schema_type).join(", ")}`);

	// JS dependency
	lines.push("\n## JS Dependency");
	lines.push(
		`- Script count: ${jsDependency.script_count}, Estimated JS dependency: ${Math.round(jsDependency.estimated_js_dependency * 100)}%`,
	);
	if (jsDependency.frameworks_detected.length > 0)
		lines.push(`- Frameworks: ${jsDependency.frameworks_detected.join(", ")}`);

	// Product info
	const pagesWithProduct = productInfo.filter(
		(p) => p.info.product_name || p.info.specs_in_schema.length > 0,
	);
	lines.push("\n## Product Info");
	lines.push(`- Pages with product data: ${pagesWithProduct.length}/${productInfo.length}`);
	for (const p of pagesWithProduct.slice(0, 3)) {
		lines.push(
			`  - ${p.filename}: ${p.info.product_name ?? "unnamed"}, prices: ${p.info.prices.length}, schema specs: ${p.info.specs_in_schema.length}, html specs: ${p.info.specs_in_html.length}, rating: ${p.info.has_aggregate_rating}`,
		);
	}

	// Marketing claims
	if (marketingClaims.length > 0) {
		const unverifiable = marketingClaims.filter((c) => c.verifiability === "unverifiable").length;
		lines.push("\n## Marketing Claims");
		lines.push(`- Total: ${marketingClaims.length}, Unverifiable: ${unverifiable}`);
	}

	// Dimensions
	if (dimensions && dimensions.length > 0) {
		lines.push("\n## GEO Dimension Scores");
		for (const d of dimensions) {
			lines.push(`- ${d.id} ${d.label}: ${d.score.toFixed(0)}/100`);
		}
	}

	return lines.join("\n");
}

/**
 * LLM 기반 Findings 생성.
 *
 * 수집된 정적 분석 데이터 요약을 LLM에 전달하여
 * GEO 관점의 강점/약점/기회를 생성한다.
 */
export async function generateFindingsLLM(
	botPolicies: BotPolicyEntry[],
	llmsTxt: { exists: boolean; content_preview: string | null },
	schemaCoverage: SchemaCoverageEntry[],
	productInfo: Array<{ page_url: string; filename: string; info: ExtractedProductInfo }>,
	jsDependency: JsDependencyInfo,
	marketingClaims: MarketingClaim[],
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
	dimensions?: Array<{ id: string; label: string; score: number }>,
): Promise<{ strengths: Finding[]; weaknesses: Finding[]; opportunities: Finding[] }> {
	const summary = buildFindingsSummary(
		botPolicies,
		llmsTxt,
		schemaCoverage,
		productInfo,
		jsDependency,
		marketingClaims,
		dimensions,
	);

	const prompt = `You are a GEO (Generative Engine Optimization) expert. Analyze the following website evaluation data and generate findings from a GEO perspective — how well this site is optimized for LLM-based search engines (ChatGPT, Claude, Gemini, Perplexity).

${summary}

Based on this data, generate:
1. **strengths**: Things the site does well for GEO (max 5)
2. **weaknesses**: Issues that hurt GEO performance (max 5)
3. **opportunities**: Actionable improvements that could significantly boost GEO (max 5)

Each finding must have:
- "title": concise title in Korean (max 40 chars)
- "description": detailed explanation in Korean (1-2 sentences)
- "icon": emoji icon ("✅" for strengths, "❌" or "⚠️" for weaknesses, "🚀" for opportunities)

Return ONLY a JSON object with this structure:
{
  "strengths": [{"title": "...", "description": "...", "icon": "✅"}],
  "weaknesses": [{"title": "...", "description": "...", "icon": "❌"}],
  "opportunities": [{"title": "...", "description": "...", "icon": "🚀"}]
}`;

	const response = await chatLLM({
		prompt,
		system_instruction:
			"You are a GEO analysis expert. Return only valid JSON. All titles and descriptions must be in Korean.",
		temperature: 0.3,
		json_mode: false,
	});

	const content = response.content.trim();
	// Extract JSON object from response (handle markdown code blocks)
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return { strengths: [], weaknesses: [], opportunities: [] };
	}

	const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
	const result: { strengths: Finding[]; weaknesses: Finding[]; opportunities: Finding[] } = {
		strengths: [],
		weaknesses: [],
		opportunities: [],
	};

	for (const key of ["strengths", "weaknesses", "opportunities"] as const) {
		const arr = parsed[key];
		if (!Array.isArray(arr)) continue;
		for (const item of arr) {
			const f = item as Record<string, unknown>;
			if (typeof f.title === "string" && typeof f.description === "string") {
				result[key].push({
					title: String(f.title).slice(0, 60),
					description: String(f.description).slice(0, 300),
					icon:
						typeof f.icon === "string"
							? f.icon
							: key === "strengths"
								? "✅"
								: key === "weaknesses"
									? "❌"
									: "🚀",
				});
			}
		}
		result[key] = result[key].slice(0, 5);
	}

	return result;
}

/**
 * Rule-based fallback: 분석 데이터로부터 잘 된 점 / 취약점 / 기회를 자동 생성한다.
 * chatLLM이 없거나 LLM 호출 실패 시 사용.
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
export async function extractGeoEvaluationData(
	homepage: CrawlData,
	subPages: Array<{ url: string; filename: string; crawl_data: CrawlData }>,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
	dimensions?: Array<{ id: string; label: string; score: number }>,
): Promise<GeoEvaluationData> {
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

	// 3. Schema coverage across all pages (LLM-enhanced quality if chatLLM available)
	const schemaCoverage = await extractSchemaCoverage(allPages, chatLLM);

	// 4. Marketing claims (from all pages, LLM-based — 필수)
	const claimPages = allPages.map((p) => ({ url: p.url, html: p.crawl_data.html }));
	const allClaims = await extractMarketingClaims(claimPages, chatLLM);

	// 5. JS dependency (homepage) — LLM-enhanced if chatLLM available
	const jsDependency = await analyzeJsDependency(homepage.html, chatLLM);

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

	// 9. Strengths / Weaknesses / Opportunities (LLM-based — 필수)
	const findings = await generateFindingsLLM(
		botPolicies,
		llmsTxt,
		schemaCoverage,
		productInfo,
		jsDependency,
		allClaims,
		chatLLM,
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
