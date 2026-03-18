import { describe, expect, it } from "vitest";
import { type CrawlData, _parsers } from "./dual-crawl.js";

const { extractTitle, extractMetaTags, extractCanonical, extractJsonLd, extractLinks, getBaseUrl } =
	_parsers;

describe("Dual Crawl Parsers", () => {
	describe("getBaseUrl", () => {
		it("extracts base URL from full URL", () => {
			expect(getBaseUrl("https://www.samsung.com/smartphones/galaxy-s25/")).toBe(
				"https://www.samsung.com",
			);
		});

		it("handles URL with port", () => {
			expect(getBaseUrl("http://localhost:3000/api/test")).toBe("http://localhost:3000");
		});

		it("handles URL without path", () => {
			expect(getBaseUrl("https://example.com")).toBe("https://example.com");
		});
	});

	describe("extractTitle", () => {
		it("extracts title from HTML", () => {
			const html = "<html><head><title>Samsung Galaxy S25 | Samsung</title></head></html>";
			expect(extractTitle(html)).toBe("Samsung Galaxy S25 | Samsung");
		});

		it("returns empty string when no title", () => {
			expect(extractTitle("<html><head></head></html>")).toBe("");
		});

		it("trims whitespace in title", () => {
			expect(extractTitle("<title>  Hello World  </title>")).toBe("Hello World");
		});

		it("handles multiline title", () => {
			expect(extractTitle("<title>\n  Test Title\n  </title>")).toBe("Test Title");
		});
	});

	describe("extractMetaTags", () => {
		it("extracts name-content meta tags", () => {
			const html = '<meta name="description" content="Test description">';
			const tags = extractMetaTags(html);
			expect(tags.description).toBe("Test description");
		});

		it("extracts property-content meta tags (Open Graph)", () => {
			const html = '<meta property="og:title" content="OG Title">';
			const tags = extractMetaTags(html);
			expect(tags["og:title"]).toBe("OG Title");
		});

		it("extracts multiple meta tags", () => {
			const html = `
				<meta name="description" content="Desc">
				<meta property="og:title" content="Title">
				<meta name="keywords" content="a,b,c">
			`;
			const tags = extractMetaTags(html);
			expect(tags.description).toBe("Desc");
			expect(tags["og:title"]).toBe("Title");
			expect(tags.keywords).toBe("a,b,c");
		});

		it("returns empty object for no meta tags", () => {
			expect(extractMetaTags("<html></html>")).toEqual({});
		});
	});

	describe("extractCanonical", () => {
		it("extracts canonical URL", () => {
			const html = '<link rel="canonical" href="https://example.com/page">';
			expect(extractCanonical(html)).toBe("https://example.com/page");
		});

		it("returns null when no canonical", () => {
			expect(extractCanonical("<html></html>")).toBeNull();
		});
	});

	describe("extractJsonLd", () => {
		it("extracts single JSON-LD block", () => {
			const html = `<script type="application/ld+json">{"@type":"Organization","name":"Samsung"}</script>`;
			const result = extractJsonLd(html);
			expect(result).toHaveLength(1);
			expect(result[0]["@type"]).toBe("Organization");
		});

		it("extracts multiple JSON-LD blocks", () => {
			const html = `
				<script type="application/ld+json">{"@type":"Organization","name":"Samsung"}</script>
				<script type="application/ld+json">{"@type":"Product","name":"Galaxy S25"}</script>
			`;
			const result = extractJsonLd(html);
			expect(result).toHaveLength(2);
		});

		it("handles JSON-LD array", () => {
			const html = `<script type="application/ld+json">[{"@type":"A"},{"@type":"B"}]</script>`;
			const result = extractJsonLd(html);
			expect(result).toHaveLength(2);
		});

		it("skips invalid JSON-LD", () => {
			const html = `<script type="application/ld+json">not valid json</script>`;
			const result = extractJsonLd(html);
			expect(result).toHaveLength(0);
		});

		it("returns empty array when no JSON-LD", () => {
			expect(extractJsonLd("<html></html>")).toEqual([]);
		});
	});

	describe("extractLinks", () => {
		it("extracts links with href and text", () => {
			const html = '<a href="/about">About Us</a>';
			const links = extractLinks(html);
			expect(links).toHaveLength(1);
			expect(links[0].href).toBe("/about");
			expect(links[0].text).toBe("About Us");
		});

		it("extracts link rel attribute", () => {
			const html = '<a href="/next" rel="next">Next Page</a>';
			const links = extractLinks(html);
			expect(links[0].rel).toBe("next");
		});

		it("strips HTML from link text", () => {
			const html = '<a href="/"><strong>Home</strong> Page</a>';
			const links = extractLinks(html);
			expect(links[0].text).toBe("Home Page");
		});

		it("limits to 200 links", () => {
			let html = "";
			for (let i = 0; i < 250; i++) {
				html += `<a href="/page${i}">Link ${i}</a>`;
			}
			const links = extractLinks(html);
			expect(links.length).toBeLessThanOrEqual(200);
		});

		it("returns empty array when no links", () => {
			expect(extractLinks("<html></html>")).toEqual([]);
		});
	});
});

describe("Dual Crawl Skill Interface", () => {
	it("exports dualCrawlSkill with correct metadata", async () => {
		const { dualCrawlSkill } = await import("./dual-crawl.js");
		expect(dualCrawlSkill.metadata.name).toBe("dual-crawl");
		expect(dualCrawlSkill.metadata.tier).toBe("bundled");
		expect(dualCrawlSkill.metadata.version).toBe("1.0.0");
	});

	it("skill execute returns error for invalid URL", async () => {
		const { dualCrawlSkill } = await import("./dual-crawl.js");
		const result = await dualCrawlSkill.execute(
			{ target_id: "t1", target_url: "http://localhost:99999/nonexistent", workspace_dir: "/tmp" },
			{ timeout: 1000 },
		);
		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
		expect(result.duration_ms).toBeGreaterThanOrEqual(0);
	});
});
