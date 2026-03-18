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
