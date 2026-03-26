import { describe, expect, it } from "vitest";
import type { CrawlData } from "../shared/types.js";
import { type FactExtractionInput, type FactSet, buildFactSet } from "./fact-set.js";

// ── Test Fixtures ───────────────────────────────────────────

function makeCrawlData(overrides?: Partial<CrawlData>): CrawlData {
	return {
		html: "<html><head><title>TestCo</title></head><body>Hello</body></html>",
		url: "https://www.testco.com",
		status_code: 200,
		content_type: "text/html",
		response_time_ms: 100,
		robots_txt: null,
		llms_txt: null,
		sitemap_xml: null,
		json_ld: [],
		meta_tags: {},
		title: "TestCo - Best Products",
		canonical_url: null,
		links: [],
		headers: {},
		...overrides,
	};
}

const emptyEvalData: FactExtractionInput = {
	product_info: [],
	marketing_claims: [],
};

// ── Tests ───────────────────────────────────────────────────

describe("fact-set", () => {
	describe("buildFactSet — basic", () => {
		it("returns a valid FactSet with empty data", () => {
			const result = buildFactSet(makeCrawlData(), emptyEvalData);
			expect(result.site_name).toBe("TestCo - Best Products");
			expect(result.site_url).toBe("https://www.testco.com");
			expect(result.brand).toBe("testco");
			expect(result.facts).toEqual([]);
			expect(result.extracted_at).toBeTruthy();
		});

		it("uses provided brand and site_name options", () => {
			const result = buildFactSet(makeCrawlData(), emptyEvalData, {
				brand: "MyBrand",
				site_name: "My Site",
			});
			expect(result.brand).toBe("MyBrand");
			expect(result.site_name).toBe("My Site");
		});
	});

	describe("buildFactSet — JSON-LD extraction", () => {
		it("extracts Product name, price, and specs from JSON-LD", () => {
			const crawl = makeCrawlData({
				json_ld: [
					{
						"@type": "Product",
						name: "Galaxy S25 Ultra",
						description: "The latest flagship smartphone",
						offers: {
							price: "1299.99",
							priceCurrency: "USD",
						},
						additionalProperty: [
							{ name: "Battery", value: "5000mAh" },
							{ name: "Display", value: '6.8"' },
						],
						aggregateRating: {
							ratingValue: "4.5",
							reviewCount: "1200",
						},
					},
				],
			});

			const result = buildFactSet(crawl, emptyEvalData);

			// Product name
			const productFact = result.facts.find(
				(f) => f.category === "PRODUCT_DETAIL" && f.expected_value === "Galaxy S25 Ultra",
			);
			expect(productFact).toBeTruthy();
			expect(productFact?.source).toBe("json_ld");

			// Price
			const priceFact = result.facts.find(
				(f) => f.category === "PRICING" && f.expected_value === "USD 1299.99",
			);
			expect(priceFact).toBeTruthy();

			// Specs
			const batteryFact = result.facts.find(
				(f) => f.category === "FEATURE" && f.expected_value.includes("5000mAh"),
			);
			expect(batteryFact).toBeTruthy();

			// Rating
			const ratingFact = result.facts.find(
				(f) => f.category === "STAT" && f.expected_value.includes("4.5"),
			);
			expect(ratingFact).toBeTruthy();

			// Description as FEATURE
			const descFact = result.facts.find(
				(f) => f.category === "FEATURE" && f.expected_value.includes("flagship"),
			);
			expect(descFact).toBeTruthy();
		});

		it("extracts ItemList as PRODUCT_LIST", () => {
			const crawl = makeCrawlData({
				json_ld: [
					{
						"@type": "ItemList",
						itemListElement: [
							{ item: { name: "Product A" } },
							{ item: { name: "Product B" } },
							{ item: { name: "Product C" } },
						],
					},
				],
			});

			const result = buildFactSet(crawl, emptyEvalData);
			const listFact = result.facts.find((f) => f.category === "PRODUCT_LIST");
			expect(listFact).toBeTruthy();
			expect(listFact?.expected_value).toContain("Product A");
			expect(listFact?.expected_value).toContain("Product B");
		});

		it("extracts Organization from JSON-LD", () => {
			const crawl = makeCrawlData({
				json_ld: [{ "@type": "Organization", name: "TestCo Inc." }],
			});

			const result = buildFactSet(crawl, emptyEvalData);
			const orgFact = result.facts.find(
				(f) => f.category === "CONTACT" && f.expected_value === "TestCo Inc.",
			);
			expect(orgFact).toBeTruthy();
		});

		it("handles nested @graph", () => {
			const crawl = makeCrawlData({
				json_ld: [
					{
						"@graph": [
							{ "@type": "Product", name: "Nested Product" },
							{ "@type": "Organization", name: "Nested Org" },
						],
					},
				],
			});

			const result = buildFactSet(crawl, emptyEvalData);
			expect(result.facts.find((f) => f.expected_value === "Nested Product")).toBeTruthy();
			expect(result.facts.find((f) => f.expected_value === "Nested Org")).toBeTruthy();
		});
	});

	describe("buildFactSet — product_info extraction", () => {
		it("extracts from product_info eval data", () => {
			const evalData: FactExtractionInput = {
				product_info: [
					{
						page_url: "https://www.testco.com/product",
						filename: "product.html",
						info: {
							product_name: "Widget Pro",
							prices: ["$99.99", "$149.99"],
							specs_in_html: ["500 GB", "2.4 GHz"],
							specs_in_schema: ["Storage: 500GB"],
							has_aggregate_rating: true,
							rating_value: "4.2",
							review_count: "350",
						},
					},
				],
				marketing_claims: [],
			};

			const result = buildFactSet(makeCrawlData(), evalData);

			expect(result.facts.find((f) => f.expected_value === "Widget Pro")).toBeTruthy();
			expect(result.facts.find((f) => f.expected_value === "$99.99")).toBeTruthy();
			expect(result.facts.find((f) => f.expected_value === "$149.99")).toBeTruthy();
			expect(result.facts.find((f) => f.expected_value === "500 GB")).toBeTruthy();
			expect(result.facts.find((f) => f.expected_value === "Storage: 500GB")).toBeTruthy();
			expect(result.facts.find((f) => f.expected_value.includes("4.2"))).toBeTruthy();
		});
	});

	describe("buildFactSet — marketing claims", () => {
		it("extracts only verifiable/factual claims", () => {
			const evalData: FactExtractionInput = {
				product_info: [],
				marketing_claims: [
					{
						text: "ISO 9001 certified",
						location: "https://www.testco.com",
						has_source: true,
						verifiability: "verifiable",
					},
					{
						text: "World's best product",
						location: "https://www.testco.com",
						has_source: false,
						verifiability: "unverifiable",
					},
					{
						text: "Founded in 2005",
						location: "https://www.testco.com",
						has_source: true,
						verifiability: "factual",
					},
				],
			};

			const result = buildFactSet(makeCrawlData(), evalData);
			const claimFacts = result.facts.filter((f) => f.source === "marketing_claim");
			expect(claimFacts).toHaveLength(2);
			expect(claimFacts.find((f) => f.expected_value === "ISO 9001 certified")).toBeTruthy();
			expect(claimFacts.find((f) => f.expected_value === "Founded in 2005")).toBeTruthy();
			// "World's best product" (unverifiable) should NOT be included
			expect(claimFacts.find((f) => f.expected_value.includes("World's best"))).toBeFalsy();
		});
	});

	describe("buildFactSet — meta tags", () => {
		it("extracts meta description", () => {
			const crawl = makeCrawlData({
				meta_tags: {
					description: "TestCo provides the best widgets for enterprise customers.",
				},
			});

			const result = buildFactSet(crawl, emptyEvalData);
			const metaFact = result.facts.find((f) => f.source === "meta_tag");
			expect(metaFact).toBeTruthy();
			expect(metaFact?.category).toBe("CUSTOM");
			expect(metaFact?.expected_value).toContain("best widgets");
		});

		it("ignores short meta descriptions", () => {
			const crawl = makeCrawlData({
				meta_tags: { description: "Hi" },
			});

			const result = buildFactSet(crawl, emptyEvalData);
			expect(result.facts.filter((f) => f.source === "meta_tag")).toHaveLength(0);
		});
	});

	describe("buildFactSet — deduplication", () => {
		it("deduplicates facts with same category and expected_value", () => {
			const crawl = makeCrawlData({
				json_ld: [
					{
						"@type": "Product",
						name: "Widget Pro",
						offers: { price: "99.99", priceCurrency: "USD" },
					},
				],
			});

			const evalData: FactExtractionInput = {
				product_info: [
					{
						page_url: "https://www.testco.com",
						filename: "index.html",
						info: {
							product_name: "Widget Pro",
							prices: ["USD 99.99"],
							specs_in_html: [],
							specs_in_schema: [],
							has_aggregate_rating: false,
							rating_value: null,
							review_count: null,
						},
					},
				],
				marketing_claims: [],
			};

			const result = buildFactSet(crawl, evalData);

			// "Widget Pro" appears in both JSON-LD and product_info but should be deduped
			const productFacts = result.facts.filter(
				(f) => f.category === "PRODUCT_DETAIL" && f.expected_value === "Widget Pro",
			);
			expect(productFacts).toHaveLength(1);

			// "USD 99.99" appears in both but should be deduped
			const priceFacts = result.facts.filter(
				(f) => f.category === "PRICING" && f.expected_value === "USD 99.99",
			);
			expect(priceFacts).toHaveLength(1);
		});
	});

	describe("buildFactSet — page title as product_name regression (Bug 2)", () => {
		it("does NOT create product facts from page titles without product signals", () => {
			// Simulates samsung.com: pages with no Product schema, no prices, no specs
			const evalData: FactExtractionInput = {
				product_info: [
					{
						page_url: "https://samsung.com/sec/",
						filename: "sec.html",
						info: {
							product_name: null, // no product signals → null
							prices: [],
							specs_in_html: [],
							specs_in_schema: [],
							has_aggregate_rating: false,
							rating_value: null,
							review_count: null,
						},
					},
					{
						page_url: "https://samsung.com/sec/sustainability/",
						filename: "sustainability.html",
						info: {
							product_name: null,
							prices: [],
							specs_in_html: [],
							specs_in_schema: [],
							has_aggregate_rating: false,
							rating_value: null,
							review_count: null,
						},
					},
				],
				marketing_claims: [],
			};

			const result = buildFactSet(makeCrawlData(), evalData);

			// No PRODUCT_DETAIL facts from page titles
			const productFacts = result.facts.filter((f) => f.category === "PRODUCT_DETAIL");
			expect(productFacts).toHaveLength(0);
		});

		it("creates product facts when product_name is a real product", () => {
			const evalData: FactExtractionInput = {
				product_info: [
					{
						page_url: "https://samsung.com/galaxy-s25/",
						filename: "galaxy-s25.html",
						info: {
							product_name: "Galaxy S25 Ultra",
							prices: ["$1,299.99"],
							specs_in_html: ["200 MP"],
							specs_in_schema: [],
							has_aggregate_rating: false,
							rating_value: null,
							review_count: null,
						},
					},
				],
				marketing_claims: [],
			};

			const result = buildFactSet(makeCrawlData(), evalData);

			const productFacts = result.facts.filter(
				(f) => f.category === "PRODUCT_DETAIL" && f.expected_value === "Galaxy S25 Ultra",
			);
			expect(productFacts).toHaveLength(1);
		});
	});

	describe("buildFactSet — fact_id uniqueness", () => {
		it("generates unique fact_ids", () => {
			const crawl = makeCrawlData({
				json_ld: [
					{
						"@type": "Product",
						name: "A",
						offers: { price: "10", priceCurrency: "USD" },
					},
					{
						"@type": "Product",
						name: "B",
						offers: { price: "20", priceCurrency: "USD" },
					},
				],
			});

			const result = buildFactSet(crawl, emptyEvalData);
			const ids = result.facts.map((f) => f.fact_id);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});
});
