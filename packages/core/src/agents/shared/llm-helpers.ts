/**
 * LLM Helper Utilities for Pipeline Agents
 *
 * - safeLLMCall: wraps LLM calls with 1-retry + throw on failure (4-D: no fallback)
 * - truncateHtml: strips scripts/styles, truncates
 * - buildPageContext: creates compact JSON from HTML for LLM prompts
 * - parseJsonResponse: handles markdown fences + Zod validation
 */
import type { z } from "zod";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";

// ── LLM Auth Error Detection ────────────────────────────────

const AUTH_ERROR_PATTERNS = [
	/401/i,
	/403/i,
	/unauthorized/i,
	/forbidden/i,
	/invalid.*(?:key|token|subscription)/i,
	/access.*denied/i,
	/authentication/i,
	/invalid_api_key/i,
	/incorrect.*api.*key/i,
];

/**
 * Determines if an error is an LLM authentication/authorization error.
 * These errors should NOT be silently handled — pipeline must stop.
 */
export function isLLMAuthError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

// ── Safe LLM Call ───────────────────────────────────────────

export interface SafeLLMResult<T> {
	result: T;
	llm_used: boolean;
	latency_ms?: number;
	error?: string;
}

/**
 * Wraps an LLM call with error handling and 1-retry on transient errors.
 * Throws if chatLLM is undefined (4-D: LLM required, no fallback).
 * Auth errors (401, 403, invalid key) fail immediately without retry.
 * Non-auth errors retry once, then throw with clear error message.
 */
export async function safeLLMCall<T>(
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
	request: LLMRequest,
	parser: (content: string) => T,
): Promise<SafeLLMResult<T>> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const response = await chatLLM(request);
			const parsed = parser(response.content);
			return { result: parsed, llm_used: true, latency_ms: response.latency_ms };
		} catch (err) {
			// Auth errors must not be retried — fail immediately
			if (isLLMAuthError(err)) {
				throw err;
			}
			lastError = err;
			if (attempt === 0) continue; // retry once for transient errors
		}
	}
	const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
	throw new Error(`LLM call failed after retry: ${errorMsg}`);
}

// ── HTML Truncation ─────────────────────────────────────────

/**
 * Strips scripts, styles, and comments from HTML, then truncates.
 * Returns visible text content.
 */
export function truncateHtml(html: string, maxChars = 2000): string {
	let text = html
		// Remove script/style blocks
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		// Remove HTML comments
		.replace(/<!--[\s\S]*?-->/g, "")
		// Remove tags
		.replace(/<[^>]+>/g, " ")
		// Normalize whitespace
		.replace(/\s+/g, " ")
		.trim();

	if (text.length > maxChars) {
		text = `${text.slice(0, maxChars)}...`;
	}
	return text;
}

// ── Page Context Builder ────────────────────────────────────

export interface PageContext {
	url: string;
	title: string;
	meta_description: string | null;
	json_ld_types: string[];
	json_ld_summary: string;
	text_excerpt: string;
	word_count: number;
	headings: string[];
	has_robots_txt: boolean;
	has_llms_txt: boolean;
	og_tags: Record<string, string>;
	site_type: string;
	scores: Record<string, number>;
}

/**
 * Builds a compact page context object suitable for LLM prompts.
 * Never sends raw HTML — always a structured summary.
 */
export function buildPageContext(
	html: string,
	url: string,
	options?: {
		robots_txt?: string | null;
		llms_txt?: string | null;
		json_ld?: unknown[];
		meta_tags?: Record<string, string>;
		title?: string;
		site_type?: string;
		scores?: Record<string, number>;
	},
): PageContext {
	const opts = options ?? {};

	// Extract title
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = opts.title || (titleMatch ? titleMatch[1].trim() : "");

	// Extract meta description
	const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
	const meta_description = metaDescMatch ? metaDescMatch[1] : null;

	// Extract JSON-LD types
	const jsonLd = opts.json_ld ?? [];
	const json_ld_types = jsonLd
		.map((ld) => String((ld as Record<string, unknown>)["@type"] ?? ""))
		.filter(Boolean);
	const json_ld_summary = JSON.stringify(jsonLd).slice(0, 500);

	// Extract headings
	const headings: string[] = [];
	const headingPattern = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
	let hMatch = headingPattern.exec(html);
	while (hMatch && headings.length < 20) {
		headings.push(hMatch[1].replace(/<[^>]+>/g, "").trim());
		hMatch = headingPattern.exec(html);
	}

	// Visible text excerpt
	const text_excerpt = truncateHtml(html, 2000);
	const word_count = text_excerpt.split(/\s+/).filter(Boolean).length;

	// OG tags
	const og_tags: Record<string, string> = {};
	const ogPattern = /<meta\s+property=["'](og:[^"']+)["']\s+content=["']([^"']*)["']/gi;
	let ogMatch = ogPattern.exec(html);
	while (ogMatch) {
		og_tags[ogMatch[1]] = ogMatch[2];
		ogMatch = ogPattern.exec(html);
	}

	return {
		url,
		title,
		meta_description,
		json_ld_types,
		json_ld_summary,
		text_excerpt,
		word_count,
		headings,
		has_robots_txt: !!opts.robots_txt,
		has_llms_txt: !!opts.llms_txt,
		og_tags,
		site_type: opts.site_type ?? "unknown",
		scores: opts.scores ?? {},
	};
}

// ── JSON Response Parser ────────────────────────────────────

/**
 * Parses LLM response content as JSON, handling:
 * - Markdown code fences (```json ... ```)
 * - Plain JSON
 * - Validates with Zod schema
 */
export function parseJsonResponse<T>(content: string, schema: z.ZodType<T>): T {
	// Strip markdown code fences
	let jsonStr = content.trim();
	const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
	if (fenceMatch) {
		jsonStr = fenceMatch[1].trim();
	}

	// Try to find JSON object/array
	if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
		const objStart = jsonStr.indexOf("{");
		const arrStart = jsonStr.indexOf("[");
		const start =
			objStart >= 0 && arrStart >= 0 ? Math.min(objStart, arrStart) : Math.max(objStart, arrStart);
		if (start >= 0) {
			jsonStr = jsonStr.slice(start);
		}
	}

	const parsed = JSON.parse(jsonStr);
	return schema.parse(parsed);
}

// ── HTML Helper ─────────────────────────────────────────────

/**
 * Extract visible text from HTML (for LLM prompts).
 */
export function extractVisibleText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Extract title from HTML.
 */
export function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? match[1].trim() : "";
}

/**
 * Escape HTML special characters for safe attribute insertion.
 */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
