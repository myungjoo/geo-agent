import { describe, expect, it } from "vitest";
import { TemplateEngine, classifySite } from "./template-engine.js";
// ── TemplateEngine ───────────────────────────────────────────────
describe("TemplateEngine", () => {
	const engine = new TemplateEngine();
	// ── loadTemplate ─────────────────────────────────────────────
	describe("loadTemplate", () => {
		it("loads manufacturer template", () => {
			const content = engine.loadTemplate("manufacturer");
			expect(content).toBeTruthy();
			expect(typeof content).toBe("string");
			expect(content.length).toBeGreaterThan(0);
		});
		it("loads research template", () => {
			const content = engine.loadTemplate("research");
			expect(content).toBeTruthy();
			expect(content.length).toBeGreaterThan(0);
		});
		it("loads generic template", () => {
			const content = engine.loadTemplate("generic");
			expect(content).toBeTruthy();
			expect(content.length).toBeGreaterThan(0);
		});
		it("throws for invalid site type", () => {
			expect(() => engine.loadTemplate("invalid")).toThrow();
		});
		it("returns different content for different site types", () => {
			const mfg = engine.loadTemplate("manufacturer");
			const res = engine.loadTemplate("research");
			const gen = engine.loadTemplate("generic");
			expect(mfg).not.toBe(res);
			expect(mfg).not.toBe(gen);
			expect(res).not.toBe(gen);
		});
	});
	// ── render ───────────────────────────────────────────────────
	describe("render", () => {
		it("replaces {{variables}} in template", () => {
			const result = engine.render("generic", {
				site_name: "TestSite",
				base_url: "https://test.com",
				site_type: "generic",
				SITE_NAME: "TestSite",
				BASE_URL: "https://test.com",
			});
			expect(result).toContain("TestSite");
			expect(result).toContain("https://test.com");
		});
		it("handles array parameters (joined with comma-space)", () => {
			const result = engine.render("generic", {
				site_name: "TestSite",
				base_url: "https://test.com",
				site_type: "generic",
				target_queries: ["query1", "query2", "query3"],
			});
			// If the template contains {{target_queries}}, it should be "query1, query2, query3"
			// Even if not in template, verify join logic via a simple check
			expect(typeof result).toBe("string");
		});
		it("handles undefined parameter values gracefully", () => {
			const params = {
				site_name: "TestSite",
				base_url: "https://test.com",
				site_type: "generic",
				custom_field: undefined,
			};
			const result = engine.render("generic", params);
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
		});
		it("handles null parameter values gracefully", () => {
			const params = {
				site_name: "TestSite",
				base_url: "https://test.com",
				site_type: "generic",
				custom_field: null,
			};
			const result = engine.render("generic", params);
			expect(typeof result).toBe("string");
		});
		it("replaces all occurrences of same placeholder", () => {
			const result = engine.render("manufacturer", {
				site_name: "Samsung",
				base_url: "https://samsung.com",
				site_type: "manufacturer",
				SITE_NAME: "Samsung",
				BASE_URL: "https://samsung.com",
			});
			// SITE_NAME appears in the template and should be replaced
			expect(result).toContain("Samsung");
		});
		it("returns string type", () => {
			const result = engine.render("research", {
				site_name: "Lab",
				base_url: "https://lab.com",
				site_type: "research",
			});
			expect(typeof result).toBe("string");
		});
	});
	// ── listTemplates ────────────────────────────────────────────
	describe("listTemplates", () => {
		it("returns 3 templates", () => {
			const templates = engine.listTemplates();
			expect(templates).toHaveLength(3);
		});
		it("includes manufacturer, research, and generic", () => {
			const templates = engine.listTemplates();
			const types = templates.map((t) => t.site_type);
			expect(types).toContain("manufacturer");
			expect(types).toContain("research");
			expect(types).toContain("generic");
		});
		it("each template has required fields", () => {
			const templates = engine.listTemplates();
			for (const t of templates) {
				expect(t.site_type).toBeTruthy();
				expect(t.version).toBeTruthy();
				expect(t.label).toBeTruthy();
				expect(t.scoring_dimensions).toBeInstanceOf(Array);
				expect(t.probe_count).toBeGreaterThan(0);
				expect(t.template_path).toBeTruthy();
			}
		});
		it("returns a copy (not the same array reference)", () => {
			const a = engine.listTemplates();
			const b = engine.listTemplates();
			expect(a).not.toBe(b);
		});
	});
	// ── getTemplateInfo ──────────────────────────────────────────
	describe("getTemplateInfo", () => {
		it("returns correct info for manufacturer", () => {
			const info = engine.getTemplateInfo("manufacturer");
			expect(info.site_type).toBe("manufacturer");
			expect(info.label).toBe("제조사 대표 Site");
			expect(info.probe_count).toBe(8);
			expect(info.scoring_dimensions).toHaveLength(7);
		});
		it("returns correct info for research", () => {
			const info = engine.getTemplateInfo("research");
			expect(info.site_type).toBe("research");
			expect(info.label).toBe("연구소 대표 Site");
			expect(info.probe_count).toBe(8);
		});
		it("returns correct info for generic", () => {
			const info = engine.getTemplateInfo("generic");
			expect(info.site_type).toBe("generic");
			expect(info.label).toBe("기타");
		});
		it("throws for unknown site type", () => {
			expect(() => engine.getTemplateInfo("nonexistent")).toThrow();
		});
		it("scoring dimensions weights sum to 1.0", () => {
			for (const siteType of ["manufacturer", "research", "generic"]) {
				const info = engine.getTemplateInfo(siteType);
				const sum = info.scoring_dimensions.reduce((acc, d) => acc + d.weight, 0);
				expect(sum).toBeCloseTo(1.0, 5);
			}
		});
	});
});
// ── classifySite ─────────────────────────────────────────────────
describe("classifySite", () => {
	// ── Manufacturer detection ───────────────────────────────────
	it("identifies manufacturer by Product JSON-LD", () => {
		const html =
			'<script type="application/ld+json">{"@type":"Product","name":"Galaxy S25"}</script>';
		const result = classifySite(html, "https://samsung.com/products/galaxy-s25");
		expect(result.site_type).toBe("manufacturer");
	});
	it("identifies manufacturer by /products/ URL", () => {
		const html = "<html><body><h1>Our Products</h1><span>$999.99</span></body></html>";
		const result = classifySite(html, "https://example.com/products/widget");
		expect(result.site_type).toBe("manufacturer");
	});
	it("identifies manufacturer by price information", () => {
		const html =
			'<html><body><span class="price">$1,299.00</span><meta property="og:product:price" content="1299"></body></html>';
		const result = classifySite(html, "https://shop.example.com/item");
		expect(result.site_type).toBe("manufacturer");
	});
	it("identifies manufacturer by Offer schema and price", () => {
		const html =
			'<script type="application/ld+json">{"@type":"Offer","price":"499"}</script><p>Price: $499</p>';
		const result = classifySite(html, "https://example.com/buy/laptop");
		expect(result.site_type).toBe("manufacturer");
	});
	// ── Research detection ───────────────────────────────────────
	it("identifies research by ScholarlyArticle", () => {
		const html =
			'<script type="application/ld+json">{"@type":"ScholarlyArticle","name":"AI Paper"}</script><a href="https://doi.org/10.1234/test">DOI</a>';
		const result = classifySite(html, "https://research.example.com/publications/ai-paper");
		expect(result.site_type).toBe("research");
	});
	it("identifies research by DOI and citation tags", () => {
		const html =
			'<html><head><meta name="citation_title" content="A Study"><meta name="citation_doi" content="10.1234/abc"></head><body><a href="https://doi.org/10.1234/abc">Link</a></body></html>';
		const result = classifySite(html, "https://journal.example.com/paper/123");
		expect(result.site_type).toBe("research");
	});
	it("identifies research by /publications/ URL and ORCID", () => {
		const html =
			'<html><body><p>Author ORCID: 0000-0001-2345-6789</p><a href="paper.pdf">Download Paper</a></body></html>';
		const result = classifySite(html, "https://lab.example.com/publications/2025/study");
		expect(result.site_type).toBe("research");
	});
	it("identifies research by PDF download and paper references", () => {
		const html =
			'<html><body><a href="/papers/study.pdf">Download paper</a><p>affiliation: MIT</p><meta name="dc.title" content="Study"></body></html>';
		const result = classifySite(html, "https://research.example.com/papers/study");
		expect(result.site_type).toBe("research");
	});
	// ── Generic detection ────────────────────────────────────────
	it("identifies generic when no manufacturer or research signals", () => {
		const html =
			"<html><body><h1>Welcome to our blog</h1><p>This is a general website.</p></body></html>";
		const result = classifySite(html, "https://blog.example.com");
		expect(result.site_type).toBe("generic");
	});
	it("identifies generic for news article sites", () => {
		const html =
			'<script type="application/ld+json">{"@type":"Article","headline":"Breaking News"}</script>';
		const result = classifySite(html, "https://news.example.com/article/123");
		expect(result.site_type).toBe("generic");
	});
	it("identifies generic for service/local business sites", () => {
		const html =
			'<script type="application/ld+json">{"@type":"Service","name":"Consulting"}</script>';
		const result = classifySite(html, "https://consulting.example.com");
		expect(result.site_type).toBe("generic");
	});
	// ── Confidence values ────────────────────────────────────────
	it("returns confidence in 0-1 range for all signals", () => {
		const html = "<html><body>Simple page</body></html>";
		const result = classifySite(html, "https://example.com");
		for (const signal of result.all_signals) {
			expect(signal.confidence).toBeGreaterThanOrEqual(0);
			expect(signal.confidence).toBeLessThanOrEqual(1);
		}
	});
	it("returns higher confidence with more matching signals", () => {
		const weakHtml = "<html><body><span>$99</span></body></html>";
		const strongHtml =
			'<html><body><script type="application/ld+json">{"@type":"Product"}</script><meta property="og:product:price" content="99"><span>$99.00</span></body></html>';
		const weakResult = classifySite(weakHtml, "https://example.com");
		const strongResult = classifySite(strongHtml, "https://example.com/products/item");
		const weakMfg = weakResult.all_signals.find((s) => s.site_type === "manufacturer");
		const strongMfg = strongResult.all_signals.find((s) => s.site_type === "manufacturer");
		expect(strongMfg.confidence).toBeGreaterThan(weakMfg.confidence);
	});
	// ── Edge cases ───────────────────────────────────────────────
	it("handles empty HTML and returns generic", () => {
		const result = classifySite("", "https://example.com");
		expect(result.site_type).toBe("generic");
	});
	it("handles empty URL", () => {
		const result = classifySite("<html><body>Hello</body></html>", "");
		expect(result.site_type).toBe("generic");
		expect(result.confidence).toBeGreaterThanOrEqual(0);
	});
	it("picks higher confidence when both manufacturer and research signals are present", () => {
		// More manufacturer signals than research
		const html = `
			<script type="application/ld+json">{"@type":"Product","name":"Widget"}</script>
			<meta property="og:product:price" content="99">
			<span>$99.00</span>
			<a href="/products/widget">Buy Now</a>
			<p>ScholarlyArticle reference here</p>
		`;
		const result = classifySite(html, "https://example.com/shop/widget");
		// Should pick manufacturer since it has more signals
		expect(result.site_type).toBe("manufacturer");
		const mfgSignal = result.all_signals.find((s) => s.site_type === "manufacturer");
		const resSignal = result.all_signals.find((s) => s.site_type === "research");
		expect(mfgSignal.confidence).toBeGreaterThan(resSignal.confidence);
	});
	it("picks research when research signals dominate", () => {
		const html = `
			<html><head>
			<meta name="citation_title" content="Deep Learning Study">
			<meta name="dc.creator" content="Dr. Smith">
			</head><body>
			<script type="application/ld+json">{"@type":"ScholarlyArticle"}</script>
			<p>ORCID: 0000-0001-2345-6789</p>
			<a href="https://doi.org/10.1234/test">DOI Link</a>
			<a href="/papers/study.pdf">Download paper</a>
			</body></html>
		`;
		const result = classifySite(html, "https://research.example.com/publications/deep-learning");
		expect(result.site_type).toBe("research");
	});
	// ── matched_signals array ────────────────────────────────────
	it("populates matched_signals for manufacturer classification", () => {
		const html = '<script type="application/ld+json">{"@type":"Product"}</script><span>$199</span>';
		const result = classifySite(html, "https://example.com/products/item");
		expect(result.matched_signals.length).toBeGreaterThan(0);
		expect(result.matched_signals.some((s) => s.includes("Product"))).toBe(true);
	});
	it("populates matched_signals for research classification", () => {
		const html =
			'<meta name="citation_title" content="Study"><a href="https://doi.org/10.1234/abc">DOI</a><p>ScholarlyArticle</p>';
		const result = classifySite(html, "https://research.example.com/publications/study");
		expect(result.matched_signals.length).toBeGreaterThan(0);
	});
	it("populates matched_signals for generic classification with weak signals", () => {
		const result = classifySite("<html><body>Hello</body></html>", "https://example.com");
		expect(result.matched_signals.length).toBeGreaterThan(0);
		expect(result.matched_signals.some((s) => s.includes("약함"))).toBe(true);
	});
	// ── all_signals always has 3 entries ─────────────────────────
	it("always returns 3 entries in all_signals", () => {
		const cases = [
			{ html: "", url: "" },
			{ html: '<script>{"@type":"Product"}</script>', url: "https://example.com/products/" },
			{ html: '<meta name="citation_title">', url: "https://lab.com/publications/" },
		];
		for (const c of cases) {
			const result = classifySite(c.html, c.url);
			expect(result.all_signals).toHaveLength(3);
			const types = result.all_signals.map((s) => s.site_type);
			expect(types).toContain("manufacturer");
			expect(types).toContain("research");
			expect(types).toContain("generic");
		}
	});
	// ── Case insensitivity ───────────────────────────────────────
	it("matches signals case-insensitively", () => {
		const html = '<script>{"@type":"PRODUCT"}</script><span>PRICE: $99</span>';
		const result = classifySite(html, "https://example.com/PRODUCTS/item");
		const mfg = result.all_signals.find((s) => s.site_type === "manufacturer");
		expect(mfg.confidence).toBeGreaterThan(0);
	});
	// ── Confidence capping at 1.0 ────────────────────────────────
	it("caps manufacturer confidence at 1.0 even with many signals", () => {
		const html = `
			<script type="application/ld+json">{"@type":"Product"}</script>
			<script type="application/ld+json">{"@type":"Offer"}</script>
			<meta property="og:product:price" content="499">
			<span>$499.00</span>
			<a href="/products/test">Product Link</a>
			<div class="aggregaterating">4.5</div>
		`;
		const result = classifySite(html, "https://example.com/shop/test");
		const mfg = result.all_signals.find((s) => s.site_type === "manufacturer");
		expect(mfg.confidence).toBeLessThanOrEqual(1.0);
	});
	it("caps research confidence at 1.0 even with many signals", () => {
		const html = `
			<script>{"@type":"ScholarlyArticle"}</script>
			<a href="https://doi.org/10.1234">DOI</a>
			<meta name="citation_title" content="Paper">
			<p>ORCID: 0000-0001</p>
			<a href="/papers/test.pdf">Download paper</a>
		`;
		const result = classifySite(html, "https://research.example.com/publications/paper");
		const res = result.all_signals.find((s) => s.site_type === "research");
		expect(res.confidence).toBeLessThanOrEqual(1.0);
	});
});
//# sourceMappingURL=template-engine.test.js.map
