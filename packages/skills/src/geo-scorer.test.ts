import { describe, expect, it } from "vitest";
import type { CrawlData } from "./dual-crawl.js";
import { type GeoScoreData, geoScorerSkill, scoreTarget } from "./geo-scorer.js";

// Helper: create a minimal CrawlData
function makeCrawlData(overrides: Partial<CrawlData> = {}): CrawlData {
	return {
		html: "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>",
		url: "https://example.com",
		status_code: 200,
		content_type: "text/html",
		response_time_ms: 500,
		robots_txt: null,
		llms_txt: null,
		sitemap_xml: null,
		json_ld: [],
		meta_tags: {},
		title: "Test",
		canonical_url: null,
		links: [],
		headers: {},
		...overrides,
	};
}

// Helper: rich CrawlData (manufacturer-like)
function makeRichCrawlData(): CrawlData {
	return makeCrawlData({
		html: `
<html lang="ko">
<head>
	<title>Samsung Galaxy S25 Ultra | Samsung 대한민국</title>
	<meta name="description" content="Galaxy S25 Ultra 스펙, 가격, 리뷰">
	<meta property="og:title" content="Galaxy S25 Ultra">
	<meta property="og:site_name" content="Samsung">
	<meta name="twitter:card" content="summary_large_image">
	<link rel="canonical" href="https://www.samsung.com/galaxy-s25-ultra/">
	<link rel="alternate" type="application/rss+xml" href="/feed.xml">
	<script type="application/ld+json">{"@type":"Product","name":"Galaxy S25 Ultra","offers":{"@type":"Offer","price":"1,799,000"}}</script>
	<script type="application/ld+json">{"@type":"Organization","name":"Samsung Electronics"}</script>
</head>
<body>
	<nav><a href="/">Home</a><a href="/smartphones">Smartphones</a></nav>
	<header>Header</header>
	<main>
		<article>
			<h1>Samsung Galaxy S25 Ultra</h1>
			<h2>스펙</h2>
			<table><tr><td>Display</td><td>6.9" QHD+ Dynamic AMOLED 2X</td></tr></table>
			<ul><li>12GB RAM</li><li>256GB Storage</li></ul>
			<p>무게: 218g, 배터리: 5000mAh, 프로세서: Snapdragon 8 Elite 3.4GHz</p>
			<p>가격: ₩1,799,000부터</p>
			<p>Contact us at email@samsung.com or phone 1-800-SAMSUNG</p>
			<a href="/about">About Samsung</a>
			<a href="/privacy">Privacy Policy</a>
			<a href="https://facebook.com/samsung">Facebook</a>
			<a href="#specs">Specs</a>
			<a href="#camera">Camera</a>
			<a href="#design">Design</a>
			<img src="phone.jpg" alt="Galaxy S25 Ultra front view">
			<img src="back.jpg" alt="Galaxy S25 Ultra back view">
		</article>
	</main>
	<footer>Footer</footer>
</body>
</html>`,
		title: "Samsung Galaxy S25 Ultra | Samsung 대한민국",
		response_time_ms: 300,
		robots_txt: "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /",
		llms_txt: "# Samsung Electronics\nManufacturer of consumer electronics",
		sitemap_xml:
			'<?xml version="1.0"?><urlset><url><loc>https://www.samsung.com/</loc></url></urlset>',
		json_ld: [
			{
				"@type": "Product",
				name: "Galaxy S25 Ultra",
				offers: { "@type": "Offer", price: "1,799,000" },
			},
			{ "@type": "Organization", name: "Samsung Electronics" },
		],
		meta_tags: {
			description: "Galaxy S25 Ultra 스펙, 가격, 리뷰",
			"og:title": "Galaxy S25 Ultra",
			"og:site_name": "Samsung",
			"twitter:card": "summary_large_image",
		},
		canonical_url: "https://www.samsung.com/galaxy-s25-ultra/",
		links: [
			{ href: "/", rel: "", text: "Home" },
			{ href: "/smartphones", rel: "", text: "Smartphones" },
			{ href: "/about", rel: "", text: "About Samsung" },
			{ href: "/privacy", rel: "", text: "Privacy Policy" },
			{ href: "https://facebook.com/samsung", rel: "", text: "Facebook" },
			{ href: "#specs", rel: "", text: "Specs" },
			{ href: "#camera", rel: "", text: "Camera" },
			{ href: "#design", rel: "", text: "Design" },
		],
	});
}

describe("scoreTarget", () => {
	it("returns a valid GeoScoreData structure", () => {
		const result = scoreTarget(makeCrawlData());
		expect(result).toHaveProperty("overall_score");
		expect(result).toHaveProperty("grade");
		expect(result).toHaveProperty("dimensions");
		expect(result).toHaveProperty("weighted_scores");
		expect(result.dimensions).toHaveLength(7);
	});

	it("scores are between 0 and 100 per dimension", () => {
		const result = scoreTarget(makeRichCrawlData());
		for (const dim of result.dimensions) {
			expect(dim.score).toBeGreaterThanOrEqual(0);
			expect(dim.score).toBeLessThanOrEqual(100);
		}
	});

	it("overall score is between 0 and 100", () => {
		const result = scoreTarget(makeRichCrawlData());
		expect(result.overall_score).toBeGreaterThanOrEqual(0);
		expect(result.overall_score).toBeLessThanOrEqual(100);
	});

	it("weights sum to 1.0", () => {
		const result = scoreTarget(makeCrawlData());
		const totalWeight = result.dimensions.reduce((sum, d) => sum + d.weight, 0);
		expect(totalWeight).toBeCloseTo(1.0);
	});

	it("grade reflects score", () => {
		// Rich site should score well
		const rich = scoreTarget(makeRichCrawlData());
		expect(["Excellent", "Good", "Needs Improvement"]).toContain(rich.grade);

		// Minimal site should score poorly
		const minimal = scoreTarget(makeCrawlData());
		expect(["Needs Improvement", "Poor", "Critical"]).toContain(minimal.grade);
	});

	it("each dimension has details", () => {
		const result = scoreTarget(makeRichCrawlData());
		for (const dim of result.dimensions) {
			expect(dim.details.length).toBeGreaterThan(0);
		}
	});
});

describe("Dimension scoring details", () => {
	describe("S1: Crawlability", () => {
		it("scores higher with robots.txt", () => {
			const withRobots = scoreTarget(makeCrawlData({ robots_txt: "User-agent: *\nAllow: /" }));
			const without = scoreTarget(makeCrawlData());
			const s1With = withRobots.dimensions.find((d) => d.id === "S1")!;
			const s1Without = without.dimensions.find((d) => d.id === "S1")!;
			expect(s1With.score).toBeGreaterThan(s1Without.score);
		});

		it("scores higher with llms.txt", () => {
			const withLlms = scoreTarget(makeCrawlData({ llms_txt: "# Info" }));
			const without = scoreTarget(makeCrawlData());
			const s1With = withLlms.dimensions.find((d) => d.id === "S1")!;
			const s1Without = without.dimensions.find((d) => d.id === "S1")!;
			expect(s1With.score).toBeGreaterThan(s1Without.score);
		});

		it("scores higher with fast response time", () => {
			const fast = scoreTarget(makeCrawlData({ response_time_ms: 200 }));
			const slow = scoreTarget(makeCrawlData({ response_time_ms: 5000 }));
			const s1Fast = fast.dimensions.find((d) => d.id === "S1")!;
			const s1Slow = slow.dimensions.find((d) => d.id === "S1")!;
			expect(s1Fast.score).toBeGreaterThan(s1Slow.score);
		});
	});

	describe("S2: Structured Data", () => {
		it("scores higher with JSON-LD", () => {
			const withLd = scoreTarget(
				makeCrawlData({
					json_ld: [{ "@type": "Organization", name: "Test" }],
				}),
			);
			const without = scoreTarget(makeCrawlData());
			const s2With = withLd.dimensions.find((d) => d.id === "S2")!;
			const s2Without = without.dimensions.find((d) => d.id === "S2")!;
			expect(s2With.score).toBeGreaterThan(s2Without.score);
		});

		it("scores higher with OG tags", () => {
			const withOg = scoreTarget(
				makeCrawlData({
					meta_tags: { "og:title": "Test", "og:description": "Desc" },
				}),
			);
			const without = scoreTarget(makeCrawlData());
			expect(withOg.dimensions.find((d) => d.id === "S2")!.score).toBeGreaterThan(
				without.dimensions.find((d) => d.id === "S2")!.score,
			);
		});
	});

	describe("S3: Content Readability", () => {
		it("scores higher with semantic HTML", () => {
			const withSemantic = scoreTarget(
				makeCrawlData({
					html: "<html><body><main><article><section><h1>Title</h1><h2>Sub</h2><nav>Nav</nav></section></article></main></body></html>",
				}),
			);
			const without = scoreTarget(
				makeCrawlData({
					html: "<html><body><div>Hello</div></body></html>",
				}),
			);
			expect(withSemantic.dimensions.find((d) => d.id === "S3")!.score).toBeGreaterThan(
				without.dimensions.find((d) => d.id === "S3")!.score,
			);
		});
	});

	describe("S4: Fact Density", () => {
		it("scores higher with numbers and units", () => {
			const withFacts = scoreTarget(
				makeCrawlData({
					html: '<html><body><table><tr><td>Weight</td><td>218g</td></tr><tr><td>Battery</td><td>5000mAh</td></tr><tr><td>Display</td><td>6.9" 3120x1440px</td></tr><tr><td>RAM</td><td>12GB</td></tr><tr><td>Storage</td><td>256GB</td></tr><tr><td>Speed</td><td>3.4GHz</td></tr></table><p>specs and features</p></body></html>',
				}),
			);
			const without = scoreTarget(makeCrawlData());
			expect(withFacts.dimensions.find((d) => d.id === "S4")!.score).toBeGreaterThan(
				without.dimensions.find((d) => d.id === "S4")!.score,
			);
		});
	});

	describe("S5: Brand Message", () => {
		it("scores higher with brand schema", () => {
			const withBrand = scoreTarget(
				makeCrawlData({
					json_ld: [{ "@type": "Organization", name: "Samsung" }],
					meta_tags: { "og:site_name": "Samsung" },
					title: "Samsung",
				}),
			);
			const without = scoreTarget(makeCrawlData());
			expect(withBrand.dimensions.find((d) => d.id === "S5")!.score).toBeGreaterThan(
				without.dimensions.find((d) => d.id === "S5")!.score,
			);
		});
	});

	describe("S6: AI Infrastructure", () => {
		it("scores higher with llms.txt", () => {
			const withAI = scoreTarget(makeCrawlData({ llms_txt: "# AI Info" }));
			const without = scoreTarget(makeCrawlData());
			expect(withAI.dimensions.find((d) => d.id === "S6")!.score).toBeGreaterThan(
				without.dimensions.find((d) => d.id === "S6")!.score,
			);
		});
	});

	describe("S7: Content Navigation", () => {
		it("scores higher with breadcrumbs and nav", () => {
			const withNav = scoreTarget(
				makeCrawlData({
					html: '<html lang="ko"><body><nav>Nav</nav><div class="breadcrumb">Home &gt; Products</div><a href="#a">A</a><a href="#b">B</a><a href="#c">C</a></body></html>',
					sitemap_xml: "<urlset></urlset>",
					links: [
						{ href: "#a", rel: "", text: "A" },
						{ href: "#b", rel: "", text: "B" },
						{ href: "#c", rel: "", text: "C" },
						{ href: "/page1", rel: "", text: "Page 1" },
						{ href: "/page2", rel: "", text: "Page 2" },
						{ href: "/page3", rel: "", text: "Page 3" },
					],
				}),
			);
			const without = scoreTarget(makeCrawlData());
			expect(withNav.dimensions.find((d) => d.id === "S7")!.score).toBeGreaterThan(
				without.dimensions.find((d) => d.id === "S7")!.score,
			);
		});
	});
});

describe("GEO Scorer Skill Interface", () => {
	it("has correct metadata", () => {
		expect(geoScorerSkill.metadata.name).toBe("geo-scorer");
		expect(geoScorerSkill.metadata.tier).toBe("bundled");
	});

	it("returns error when no crawl_data provided", async () => {
		const result = await geoScorerSkill.execute(
			{ target_id: "t1", target_url: "https://example.com", workspace_dir: "/tmp" },
			{},
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("crawl_data");
	});

	it("scores when crawl_data is provided", async () => {
		const result = await geoScorerSkill.execute(
			{ target_id: "t1", target_url: "https://example.com", workspace_dir: "/tmp" },
			{ crawl_data: makeRichCrawlData() },
		);
		expect(result.success).toBe(true);
		expect(result.data).toHaveProperty("overall_score");
		expect(result.data).toHaveProperty("grade");
	});
});

describe("Grade calculation", () => {
	it("rich site gets Good or Excellent", () => {
		const result = scoreTarget(makeRichCrawlData());
		expect(["Excellent", "Good"]).toContain(result.grade);
	});

	it("minimal site gets Poor or Critical", () => {
		const result = scoreTarget(
			makeCrawlData({
				html: "<html><body>Minimal</body></html>",
				response_time_ms: 5000,
			}),
		);
		expect(["Poor", "Critical"]).toContain(result.grade);
	});
});
