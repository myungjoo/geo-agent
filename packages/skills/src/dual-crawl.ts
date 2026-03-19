/**
 * Dual Crawl Skill — Target URL에서 HTML, robots.txt, sitemap.xml, 구조화 데이터 수집
 *
 * "Dual" = 두 관점에서 크롤링:
 * 1. 사용자 관점 (HTML 페이지 콘텐츠)
 * 2. 봇 관점 (robots.txt, llms.txt, sitemap.xml, JSON-LD)
 */
import type { Skill, SkillExecutionContext, SkillResult } from "./index.js";

// ── Crawl Result Types ──────────────────────────────────────

export interface CrawlData {
	html: string;
	url: string;
	status_code: number;
	content_type: string;
	response_time_ms: number;
	robots_txt: string | null;
	llms_txt: string | null;
	sitemap_xml: string | null;
	json_ld: Record<string, unknown>[];
	meta_tags: Record<string, string>;
	title: string;
	canonical_url: string | null;
	links: { href: string; rel: string; text: string }[];
	headers: Record<string, string>;
}

// ── URL helpers ─────────────────────────────────────────────

function getBaseUrl(url: string): string {
	const parsed = new URL(url);
	return `${parsed.protocol}//${parsed.host}`;
}

// ── Fetch helper with timeout ───────────────────────────────

async function safeFetch(
	url: string,
	timeoutMs = 10000,
): Promise<{ body: string; status: number; headers: Record<string, string> } | null> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const res = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "GEO-Agent/1.0 (Generative Engine Optimization)",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
		});
		clearTimeout(timer);
		const body = await res.text();
		const headers: Record<string, string> = {};
		res.headers.forEach((v, k) => {
			headers[k] = v;
		});
		return { body, status: res.status, headers };
	} catch {
		return null;
	}
}

// ── HTML parsers (regex-based, no external dependency) ──────

function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? match[1].trim() : "";
}

function extractMetaTags(html: string): Record<string, string> {
	const tags: Record<string, string> = {};
	const regex =
		/<meta\s+(?:[^>]*?\s+)?(?:name|property)=["']([^"']+)["'][^>]*?\s+content=["']([^"']*)["'][^>]*>/gi;
	let match = regex.exec(html);
	while (match) {
		tags[match[1]] = match[2];
		match = regex.exec(html);
	}
	// Also match reversed order (content before name)
	const regex2 =
		/<meta\s+(?:[^>]*?\s+)?content=["']([^"']*)["'][^>]*?\s+(?:name|property)=["']([^"']+)["'][^>]*>/gi;
	let match2 = regex2.exec(html);
	while (match2) {
		tags[match2[2]] = match2[1];
		match2 = regex2.exec(html);
	}
	return tags;
}

function extractCanonical(html: string): string | null {
	const match = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
	return match ? match[1] : null;
}

function extractJsonLd(html: string): Record<string, unknown>[] {
	const results: Record<string, unknown>[] = [];
	const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let match = regex.exec(html);
	while (match) {
		try {
			const parsed = JSON.parse(match[1]);
			if (Array.isArray(parsed)) {
				results.push(...parsed);
			} else {
				results.push(parsed);
			}
		} catch {
			// Invalid JSON-LD, skip
		}
		match = regex.exec(html);
	}
	return results;
}

function extractLinks(html: string): { href: string; rel: string; text: string }[] {
	const links: { href: string; rel: string; text: string }[] = [];
	const regex =
		/<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'](?:\s+[^>]*?rel=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/a>/gi;
	let match = regex.exec(html);
	while (match && links.length < 200) {
		links.push({
			href: match[1],
			rel: match[2] || "",
			text: match[3]
				.replace(/<[^>]+>/g, "")
				.trim()
				.slice(0, 100),
		});
		match = regex.exec(html);
	}
	return links;
}

// ── Main crawl function ─────────────────────────────────────

export async function crawlTarget(url: string, timeoutMs = 10000): Promise<CrawlData> {
	const baseUrl = getBaseUrl(url);

	// 1. Fetch main page
	const startTime = Date.now();
	const mainPage = await safeFetch(url, timeoutMs);
	const responseTime = Date.now() - startTime;

	if (!mainPage) {
		throw new Error(`Failed to fetch ${url}`);
	}

	const html = mainPage.body;

	// 2. Fetch bot-facing resources in parallel
	const [robotsRes, llmsRes, sitemapRes] = await Promise.all([
		safeFetch(`${baseUrl}/robots.txt`, 5000),
		safeFetch(`${baseUrl}/llms.txt`, 5000),
		safeFetch(`${baseUrl}/sitemap.xml`, 5000),
	]);

	return {
		html,
		url,
		status_code: mainPage.status,
		content_type: mainPage.headers["content-type"] ?? "text/html",
		response_time_ms: responseTime,
		robots_txt: robotsRes?.status === 200 ? robotsRes.body : null,
		llms_txt: llmsRes?.status === 200 ? llmsRes.body : null,
		sitemap_xml: sitemapRes?.status === 200 ? sitemapRes.body : null,
		json_ld: extractJsonLd(html),
		meta_tags: extractMetaTags(html),
		title: extractTitle(html),
		canonical_url: extractCanonical(html),
		links: extractLinks(html),
		headers: mainPage.headers,
	};
}

// ── Multi-page crawling ─────────────────────────────────────

export interface MultiPageCrawlResult {
	homepage: CrawlData;
	pages: Array<{ url: string; path: string; crawl_data: CrawlData }>;
	total_pages: number;
	crawl_duration_ms: number;
}

/** Asset/non-content file extensions to skip */
const SKIP_EXTENSIONS =
	/\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf|zip|woff2?|ttf|eot|mp4|mp3|webp|avif)(\?|$)/i;

/** URL patterns indicating product/category pages (prioritized in crawl order) */
const PRODUCT_PATTERNS = [
	/\/(products?|smartphones?|phones?|tablets?|laptops?|tvs?|televisions?)\//i,
	/\/(category|categories|catalog|shop|store|buy)\//i,
	/\/(home-appliances?|refrigerators?|washers?|computers?|monitors?)\//i,
	/\/(vehicles?|cars?|suv|models?|solutions?|services?)\//i,
	/\/(features?|specifications?|compare|specs)\//i,
];

/**
 * Convert a page URL to a safe filename for clone storage.
 */
export function urlToFilename(pageUrl: string, baseUrl: string): string {
	try {
		const parsed = new URL(pageUrl, baseUrl);
		let p = parsed.pathname.replace(/^\/+|\/+$/g, "");
		if (!p) return "index.html";
		// Replace path separators with hyphens, remove unsafe chars
		p = p.replace(/\//g, "-").replace(/[^a-zA-Z0-9_\-\.]/g, "_");
		if (!p.endsWith(".html")) p += ".html";
		return p;
	} catch {
		return `page-${Date.now()}.html`;
	}
}

/**
 * Extract same-host links from HTML, categorized by priority.
 */
function discoverLinks(
	html: string,
	sourceUrl: string,
	host: string,
	seen: Set<string>,
): { prioritized: string[]; secondary: string[] } {
	const links = extractLinks(html);
	const prioritized: string[] = [];
	const secondary: string[] = [];

	for (const link of links) {
		try {
			const resolved = new URL(link.href, sourceUrl);
			if (resolved.host !== host) continue;
			if (SKIP_EXTENSIONS.test(resolved.pathname)) continue;
			const path = resolved.pathname;
			if (seen.has(path)) continue;
			seen.add(path);

			const fullUrl = resolved.href.split("#")[0];
			if (PRODUCT_PATTERNS.some((p) => p.test(path))) {
				prioritized.push(fullUrl);
			} else {
				secondary.push(fullUrl);
			}
		} catch {
			/* skip */
		}
	}
	return { prioritized, secondary };
}

/**
 * Crawl a single page (simplified — no robots/llms/sitemap).
 */
async function crawlSubPage(
	pageUrl: string,
	homepage: CrawlData,
	baseUrl: string,
	timeoutMs: number,
): Promise<{ url: string; path: string; crawl_data: CrawlData } | null> {
	const res = await safeFetch(pageUrl, timeoutMs);
	if (!res || res.status >= 400) return null;

	const html = res.body;
	const crawlData: CrawlData = {
		html,
		url: pageUrl,
		status_code: res.status,
		content_type: res.headers["content-type"] ?? "text/html",
		response_time_ms: 0,
		robots_txt: homepage.robots_txt,
		llms_txt: homepage.llms_txt,
		sitemap_xml: homepage.sitemap_xml,
		json_ld: extractJsonLd(html),
		meta_tags: extractMetaTags(html),
		title: extractTitle(html),
		canonical_url: extractCanonical(html),
		links: extractLinks(html),
		headers: res.headers,
	};
	return { url: pageUrl, path: urlToFilename(pageUrl, baseUrl), crawl_data: crawlData };
}

/**
 * Multi-depth crawl: depth=1 wide (up to maxWidth), depth=2+ narrow (2-3 per parent).
 *
 * Strategy mimics LLM service information discovery:
 * - Depth 1: Broad scan of homepage links (categories, product lines)
 * - Depth 2: Drill into 2-3 most important links per depth-1 page (PDP, details)
 * - Depth 3: Pick 1-2 links per depth-2 page (specific specs, variants)
 *
 * maxDepth default=3, maxPages default=30.
 */
export async function crawlMultiplePages(
	url: string,
	maxPages = 30,
	timeoutMs = 10000,
	maxDepth = 3,
): Promise<MultiPageCrawlResult> {
	const startTime = Date.now();

	// 1. Crawl homepage (full crawl with robots/llms/sitemap)
	const homepage = await crawlTarget(url, timeoutMs);
	const baseUrl = getBaseUrl(url);
	const host = new URL(url).host;

	if (maxPages <= 1) {
		return { homepage, pages: [], total_pages: 1, crawl_duration_ms: Date.now() - startTime };
	}

	const seen = new Set<string>([new URL(url).pathname]);
	const pages: Array<{ url: string; path: string; crawl_data: CrawlData }> = [];
	const concurrency = 5;

	// Width limits per depth: depth1=wide, depth2+=narrow (LLM-style drill-down)
	const widthByDepth = [0, maxPages - 1, 3, 2]; // index=depth

	// 2. Depth 1: Broad scan from homepage
	const d1Links = discoverLinks(homepage.html, url, host, seen);
	const d1Urls = [...d1Links.prioritized, ...d1Links.secondary].slice(0, widthByDepth[1]);

	// Fetch depth-1 pages
	const toFetch = d1Urls;

	// Helper: batch-fetch pages
	async function fetchBatch(
		urls: string[],
	): Promise<Array<{ url: string; path: string; crawl_data: CrawlData }>> {
		const fetched: Array<{ url: string; path: string; crawl_data: CrawlData }> = [];
		for (let i = 0; i < urls.length; i += concurrency) {
			if (pages.length + fetched.length >= maxPages - 1) break;
			const batch = urls.slice(i, i + concurrency);
			const results = await Promise.allSettled(
				batch.map((u) => crawlSubPage(u, homepage, baseUrl, timeoutMs)),
			);
			for (const r of results) {
				if (r.status === "fulfilled" && r.value) fetched.push(r.value);
			}
		}
		return fetched;
	}

	// Depth 1: broad scan
	const depth1Pages = await fetchBatch(toFetch);
	pages.push(...depth1Pages);

	// Depth 2: narrow drill-down (2-3 links per depth-1 page, prioritized only)
	if (maxDepth >= 2 && pages.length < maxPages - 1) {
		const depth2Parents = depth1Pages
			.filter((p) => PRODUCT_PATTERNS.some((pat) => pat.test(p.url)))
			.slice(0, 5); // max 5 parents to drill from

		for (const parent of depth2Parents) {
			if (pages.length >= maxPages - 1) break;
			const d2Links = discoverLinks(parent.crawl_data.html, parent.url, host, seen);
			const d2Urls = [...d2Links.prioritized, ...d2Links.secondary].slice(0, widthByDepth[2] ?? 3);
			const d2Pages = await fetchBatch(d2Urls);
			pages.push(...d2Pages);

			// Depth 3: even narrower (1-2 links per depth-2 page)
			if (maxDepth >= 3 && pages.length < maxPages - 1) {
				const depth3Parents = d2Pages
					.filter((p) => p.crawl_data.json_ld.length > 0) // pages with schema = interesting
					.slice(0, 2);

				for (const d3Parent of depth3Parents) {
					if (pages.length >= maxPages - 1) break;
					const d3Links = discoverLinks(d3Parent.crawl_data.html, d3Parent.url, host, seen);
					const d3Urls = [...d3Links.prioritized, ...d3Links.secondary].slice(
						0,
						widthByDepth[3] ?? 2,
					);
					const d3Pages = await fetchBatch(d3Urls);
					pages.push(...d3Pages);
				}
			}
		}
	}

	return {
		homepage,
		pages,
		total_pages: 1 + pages.length,
		crawl_duration_ms: Date.now() - startTime,
	};
}

// ── Skill wrapper ───────────────────────────────────────────

export const dualCrawlSkill: Skill = {
	metadata: {
		name: "dual-crawl",
		version: "1.0.0",
		description: "Target URL을 크롤링하여 HTML, 구조화 데이터, robots.txt 등을 수집",
		author: "geo-agent",
		tags: ["crawling", "data-collection"],
		tier: "bundled",
	},
	async execute(
		context: SkillExecutionContext,
		params: Record<string, unknown>,
	): Promise<SkillResult> {
		const startTime = Date.now();
		try {
			const timeout = typeof params.timeout === "number" ? params.timeout : 10000;
			const data = await crawlTarget(context.target_url, timeout);
			return {
				success: true,
				data,
				duration_ms: Date.now() - startTime,
			};
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
				duration_ms: Date.now() - startTime,
			};
		}
	},
};

// ── Pure parsing exports (testable without network) ─────────

export const _parsers = {
	extractTitle,
	extractMetaTags,
	extractCanonical,
	extractJsonLd,
	extractLinks,
	getBaseUrl,
};
