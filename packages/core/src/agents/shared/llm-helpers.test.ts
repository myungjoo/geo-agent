import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import {
	buildPageContext,
	escapeHtml,
	extractTitle,
	extractVisibleText,
	parseJsonResponse,
	safeLLMCall,
	truncateHtml,
} from "./llm-helpers.js";

// ── Mock LLM Response Factory ────────────────────────────────

function makeLLMResponse(content: string): LLMResponse {
	return {
		content,
		model: "gpt-4o",
		provider: "openai",
		usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
		latency_ms: 200,
		cost_usd: 0.01,
	};
}

// ── safeLLMCall ─────────────────────────────────────────────

describe("safeLLMCall", () => {
	it("throws when chatLLM is undefined (4-D: LLM required)", async () => {
		await expect(
			safeLLMCall(undefined, { prompt: "test", json_mode: false }, (c) => c),
		).rejects.toThrow("LLM provider is not configured");
	});

	it("returns parsed result when chatLLM succeeds", async () => {
		const chatLLM = vi.fn().mockResolvedValue(makeLLMResponse("hello world"));
		const result = await safeLLMCall(
			chatLLM,
			{ prompt: "test", json_mode: false },
			(c) => c.toUpperCase(),
		);
		expect(result.result).toBe("HELLO WORLD");
		expect(result.llm_used).toBe(true);
		expect(result.latency_ms).toBe(200);
	});

	it("retries once on transient error then throws", async () => {
		const chatLLM = vi.fn().mockRejectedValue(new Error("API error"));
		await expect(
			safeLLMCall(chatLLM, { prompt: "test", json_mode: false }, (c) => c),
		).rejects.toThrow("LLM call failed after retry: API error");
		expect(chatLLM).toHaveBeenCalledTimes(2); // 1 original + 1 retry
	});

	it("succeeds on retry after first transient failure", async () => {
		const chatLLM = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce(makeLLMResponse("ok"));
		const result = await safeLLMCall(
			chatLLM,
			{ prompt: "x", json_mode: false },
			(c) => c,
		);
		expect(result.result).toBe("ok");
		expect(result.llm_used).toBe(true);
		expect(chatLLM).toHaveBeenCalledTimes(2);
	});

	it("throws immediately on auth error without retry", async () => {
		const chatLLM = vi.fn().mockRejectedValue(new Error("401 Unauthorized"));
		await expect(
			safeLLMCall(chatLLM, { prompt: "x", json_mode: false }, (c) => c),
		).rejects.toThrow("401 Unauthorized");
		expect(chatLLM).toHaveBeenCalledTimes(1); // no retry for auth errors
	});

	it("throws when parser throws after retry", async () => {
		const chatLLM = vi.fn().mockResolvedValue(makeLLMResponse("not json"));
		await expect(
			safeLLMCall(chatLLM, { prompt: "test", json_mode: false }, () => {
				throw new Error("parse error");
			}),
		).rejects.toThrow("LLM call failed after retry: parse error");
		expect(chatLLM).toHaveBeenCalledTimes(2); // retried once
	});
});

// ── truncateHtml ────────────────────────────────────────────

describe("truncateHtml", () => {
	it("strips script tags", () => {
		const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
		const result = truncateHtml(html);
		expect(result).not.toContain("alert");
		expect(result).not.toContain("script");
		expect(result).toContain("Hello");
		expect(result).toContain("World");
	});

	it("strips style tags", () => {
		const html = "<p>Hello</p><style>body{color:red}</style><p>World</p>";
		const result = truncateHtml(html);
		expect(result).not.toContain("color:red");
		expect(result).not.toContain("style");
		expect(result).toContain("Hello");
	});

	it("strips HTML comments", () => {
		const html = "<p>Hello</p><!-- secret comment --><p>World</p>";
		const result = truncateHtml(html);
		expect(result).not.toContain("secret comment");
		expect(result).not.toContain("<!--");
		expect(result).toContain("Hello");
	});

	it("removes HTML tags and normalizes whitespace", () => {
		const html = "<div>  <p>Hello</p>   <span>World</span>  </div>";
		const result = truncateHtml(html);
		expect(result).toBe("Hello World");
	});

	it("truncates to maxChars with '...'", () => {
		const html = "<p>A very long text that should be truncated at some point</p>";
		const result = truncateHtml(html, 20);
		expect(result.length).toBe(23); // 20 + "..."
		expect(result.endsWith("...")).toBe(true);
	});

	it("does not truncate text shorter than maxChars", () => {
		const result = truncateHtml("<p>Short</p>", 1000);
		expect(result).toBe("Short");
		expect(result).not.toContain("...");
	});
});

// ── buildPageContext ────────────────────────────────────────

describe("buildPageContext", () => {
	const sampleHtml = `<html><head>
		<title>Test Page Title</title>
		<meta name="description" content="A test description">
		<meta property="og:title" content="OG Title">
		<meta property="og:image" content="https://example.com/img.png">
	</head><body>
		<h1>Main Heading</h1>
		<h2>Sub Heading</h2>
		<h3>Minor Heading</h3>
		<p>Some content here</p>
	</body></html>`;

	it("extracts title from HTML", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.title).toBe("Test Page Title");
	});

	it("uses options.title if provided", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com", {
			title: "Override Title",
		});
		expect(ctx.title).toBe("Override Title");
	});

	it("extracts meta description", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.meta_description).toBe("A test description");
	});

	it("returns null meta_description when not present", () => {
		const ctx = buildPageContext("<html><body>No meta</body></html>", "https://example.com");
		expect(ctx.meta_description).toBeNull();
	});

	it("extracts JSON-LD types", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com", {
			json_ld: [{ "@type": "Product" }, { "@type": "Organization" }],
		});
		expect(ctx.json_ld_types).toEqual(["Product", "Organization"]);
	});

	it("returns empty json_ld_types when no JSON-LD", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.json_ld_types).toEqual([]);
	});

	it("extracts headings (H1-H3)", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.headings).toContain("Main Heading");
		expect(ctx.headings).toContain("Sub Heading");
		expect(ctx.headings).toContain("Minor Heading");
		expect(ctx.headings).toHaveLength(3);
	});

	it("extracts OG tags", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.og_tags["og:title"]).toBe("OG Title");
		expect(ctx.og_tags["og:image"]).toBe("https://example.com/img.png");
	});

	it("handles empty HTML", () => {
		const ctx = buildPageContext("", "https://example.com");
		expect(ctx.title).toBe("");
		expect(ctx.meta_description).toBeNull();
		expect(ctx.json_ld_types).toEqual([]);
		expect(ctx.headings).toEqual([]);
		expect(ctx.word_count).toBe(0);
		expect(ctx.og_tags).toEqual({});
	});

	it("sets url correctly", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com/page");
		expect(ctx.url).toBe("https://example.com/page");
	});

	it("sets has_robots_txt and has_llms_txt from options", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com", {
			robots_txt: "User-agent: *\nAllow: /",
			llms_txt: "# Site info",
		});
		expect(ctx.has_robots_txt).toBe(true);
		expect(ctx.has_llms_txt).toBe(true);
	});

	it("defaults site_type to unknown", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.site_type).toBe("unknown");
	});

	it("uses provided site_type", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com", {
			site_type: "manufacturer",
		});
		expect(ctx.site_type).toBe("manufacturer");
	});

	it("computes word_count from visible text", () => {
		const ctx = buildPageContext(sampleHtml, "https://example.com");
		expect(ctx.word_count).toBeGreaterThan(0);
	});
});

// ── parseJsonResponse ───────────────────────────────────────

describe("parseJsonResponse", () => {
	const TestSchema = z.object({
		name: z.string(),
		value: z.number(),
	});

	it("parses plain JSON", () => {
		const result = parseJsonResponse('{"name": "test", "value": 42}', TestSchema);
		expect(result).toEqual({ name: "test", value: 42 });
	});

	it("parses JSON wrapped in ```json code fences", () => {
		const result = parseJsonResponse('```json\n{"name": "fenced", "value": 99}\n```', TestSchema);
		expect(result).toEqual({ name: "fenced", value: 99 });
	});

	it("parses JSON with preceding text", () => {
		const result = parseJsonResponse(
			'Here is the result:\n{"name": "preceded", "value": 7}',
			TestSchema,
		);
		expect(result).toEqual({ name: "preceded", value: 7 });
	});

	it("throws on invalid JSON", () => {
		expect(() => parseJsonResponse("not json at all", TestSchema)).toThrow();
	});

	it("validates with Zod schema and rejects invalid data", () => {
		// Missing required field
		expect(() => parseJsonResponse('{"name": "test"}', TestSchema)).toThrow();
		// Wrong type
		expect(() => parseJsonResponse('{"name": 123, "value": 42}', TestSchema)).toThrow();
	});

	it("parses JSON wrapped in ``` fences without json label", () => {
		const result = parseJsonResponse('```\n{"name": "bare", "value": 1}\n```', TestSchema);
		expect(result).toEqual({ name: "bare", value: 1 });
	});
});

// ── extractVisibleText ──────────────────────────────────────

describe("extractVisibleText", () => {
	it("removes script and style tags", () => {
		const html = "<p>Hello</p><script>var x=1;</script><style>.x{}</style><p>World</p>";
		const result = extractVisibleText(html);
		expect(result).toBe("Hello World");
	});

	it("removes HTML tags and normalizes whitespace", () => {
		const html = "<div><p>  Hello  </p><span>World</span></div>";
		const result = extractVisibleText(html);
		expect(result).toBe("Hello World");
	});

	it("returns empty string for empty input", () => {
		expect(extractVisibleText("")).toBe("");
	});
});

// ── extractTitle ────────────────────────────────────────────

describe("extractTitle", () => {
	it("extracts title from HTML", () => {
		expect(extractTitle("<title>My Page</title>")).toBe("My Page");
	});

	it("returns empty string when no title", () => {
		expect(extractTitle("<html><body></body></html>")).toBe("");
	});

	it("trims whitespace from title", () => {
		expect(extractTitle("<title>  Spaced Title  </title>")).toBe("Spaced Title");
	});
});

// ── escapeHtml ──────────────────────────────────────────────

describe("escapeHtml", () => {
	it("escapes ampersands", () => {
		expect(escapeHtml("a & b")).toBe("a &amp; b");
	});

	it("escapes angle brackets", () => {
		expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
	});

	it("escapes quotes", () => {
		expect(escapeHtml("He said \"hello\" & 'bye'")).toBe(
			"He said &quot;hello&quot; &amp; &#39;bye&#39;",
		);
	});

	it("returns empty string unchanged", () => {
		expect(escapeHtml("")).toBe("");
	});
});
