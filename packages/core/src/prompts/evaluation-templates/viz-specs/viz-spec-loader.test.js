import { describe, expect, it } from "vitest";
import { COMMON_TABS } from "./common-tabs.js";
import { GENERIC_EXTRA_TABS } from "./generic-tabs.js";
import { MANUFACTURER_EXTRA_TABS } from "./manufacturer-tabs.js";
import { MANUFACTURER_ELECTRONICS_REF } from "./references/manufacturer-electronics.js";
import { RESEARCH_EXTRA_TABS } from "./research-tabs.js";
import {
	classifySubtype,
	findReference,
	getTabSpec,
	listReferences,
	loadVisualizationSpec,
	validateQualityBar,
} from "./viz-spec-loader.js";
import {
	SUBTYPE_BY_SITE_TYPE,
	SUBTYPE_SIGNALS,
	SiteSubtypeSchema,
	TabSpecSchema,
	VisualizationSpecSchema,
	VizElementTypeSchema,
} from "./viz-spec-schema.js";
// ── Schema Validation ──────────────────────────────────────
describe("VizSpec Zod Schemas", () => {
	it("SiteSubtypeSchema accepts valid subtypes", () => {
		expect(SiteSubtypeSchema.parse("electronics")).toBe("electronics");
		expect(SiteSubtypeSchema.parse("automotive")).toBe("automotive");
		expect(SiteSubtypeSchema.parse("general")).toBe("general");
		expect(SiteSubtypeSchema.parse("university")).toBe("university");
		expect(SiteSubtypeSchema.parse("news")).toBe("news");
		expect(SiteSubtypeSchema.parse("saas")).toBe("saas");
	});
	it("SiteSubtypeSchema rejects invalid subtypes", () => {
		expect(() => SiteSubtypeSchema.parse("invalid")).toThrow();
	});
	it("VizElementTypeSchema contains all expected types", () => {
		const types = VizElementTypeSchema.options;
		expect(types).toContain("score_gauge");
		expect(types).toContain("product_radar_chart");
		expect(types).toContain("claim_validation_mapping");
		expect(types).toContain("score_simulation_chart");
		expect(types.length).toBeGreaterThanOrEqual(20);
	});
});
// ── Common Tabs ─────────────────────────────────────────────
describe("Common Tabs", () => {
	it("has expected number of common tabs", () => {
		expect(COMMON_TABS.length).toBe(8);
	});
	it("all common tabs pass schema validation", () => {
		for (const tab of COMMON_TABS) {
			expect(() => TabSpecSchema.parse(tab)).not.toThrow();
		}
	});
	it("common tabs include required ids", () => {
		const ids = COMMON_TABS.map((t) => t.id);
		expect(ids).toContain("overview");
		expect(ids).toContain("crawlability");
		expect(ids).toContain("structure");
		expect(ids).toContain("pages");
		expect(ids).toContain("recommendations");
		expect(ids).toContain("evidence");
		expect(ids).toContain("probes");
		expect(ids).toContain("roadmap");
	});
	it("overview tab has llm_accessibility_chart with derivation", () => {
		const overview = COMMON_TABS.find((t) => t.id === "overview");
		const llmChart = overview?.required_elements.find((e) => e.type === "llm_accessibility_chart");
		expect(llmChart).toBeDefined();
		expect(llmChart?.derivation).toBeDefined();
		expect(llmChart?.derivation).toContain("robots.txt");
	});
	it("probes tab has claim_validation_mapping", () => {
		const probes = COMMON_TABS.find((t) => t.id === "probes");
		const mapping = probes?.required_elements.find((e) => e.type === "claim_validation_mapping");
		expect(mapping).toBeDefined();
		expect(mapping?.columns).toContain("report_claim");
	});
});
// ── Manufacturer Tabs ───────────────────────────────────────
describe("Manufacturer Tabs", () => {
	it("has products and brand tabs", () => {
		const ids = MANUFACTURER_EXTRA_TABS.map((t) => t.id);
		expect(ids).toContain("products");
		expect(ids).toContain("brand");
	});
	it("products tab has category_score_cards with derivation", () => {
		const products = MANUFACTURER_EXTRA_TABS.find((t) => t.id === "products");
		const scoreCards = products?.required_elements.find((e) => e.type === "category_score_cards");
		expect(scoreCards?.derivation).toBeDefined();
		expect(scoreCards?.derivation).toContain("Product Schema");
	});
	it("products tab has product_radar_chart with axes", () => {
		const products = MANUFACTURER_EXTRA_TABS.find((t) => t.id === "products");
		const radar = products?.required_elements.find((e) => e.type === "product_radar_chart");
		expect(radar?.axes?.length).toBeGreaterThanOrEqual(5);
	});
	it("brand tab has llm_response_pattern_cards", () => {
		const brand = MANUFACTURER_EXTRA_TABS.find((t) => t.id === "brand");
		const patterns = brand?.required_elements.find((e) => e.type === "llm_response_pattern_cards");
		expect(patterns?.categories).toEqual([
			"positive_answerable",
			"partial_answerable",
			"unanswerable",
		]);
	});
});
// ── Research Tabs ───────────────────────────────────────────
describe("Research Tabs", () => {
	it("has publications and authority tabs", () => {
		const ids = RESEARCH_EXTRA_TABS.map((t) => t.id);
		expect(ids).toContain("publications");
		expect(ids).toContain("authority");
	});
});
// ── Generic Tabs ────────────────────────────────────────────
describe("Generic Tabs", () => {
	it("has content and trust tabs", () => {
		const ids = GENERIC_EXTRA_TABS.map((t) => t.id);
		expect(ids).toContain("content");
		expect(ids).toContain("trust");
	});
});
// ── Reference Spec ──────────────────────────────────────────
describe("Manufacturer Electronics Reference", () => {
	it("has correct reference_id", () => {
		expect(MANUFACTURER_ELECTRONICS_REF.reference_id).toBe("samsung-geo-2026-03-17");
	});
	it("requires minimum 3 product categories", () => {
		expect(MANUFACTURER_ELECTRONICS_REF.product_categories_minimum).toBe(3);
	});
	it("has smartphone recognition items with ≥7 items", () => {
		const smartphone = MANUFACTURER_ELECTRONICS_REF.product_recognition_items?.smartphone;
		expect(smartphone).toBeDefined();
		expect(smartphone.length).toBeGreaterThanOrEqual(7);
		expect(smartphone).toContain("시작가격");
		expect(smartphone).toContain("프로세서");
	});
	it("has probe customization for P-01 through P-08", () => {
		const probes = MANUFACTURER_ELECTRONICS_REF.probe_customization;
		expect(probes).toBeDefined();
		for (let i = 1; i <= 8; i++) {
			const key = `P-0${i}`;
			expect(probes[key]).toBeDefined();
		}
	});
	it("competitor estimation enabled with ≥3 max", () => {
		expect(MANUFACTURER_ELECTRONICS_REF.competitor_estimation?.enabled).toBe(true);
		expect(
			MANUFACTURER_ELECTRONICS_REF.competitor_estimation?.max_competitors,
		).toBeGreaterThanOrEqual(3);
	});
	it("has ≥7 evidence sections", () => {
		expect(MANUFACTURER_ELECTRONICS_REF.evidence_sections?.length).toBeGreaterThanOrEqual(7);
	});
	it("quality bar requires 10 tabs and 3 simulation lines", () => {
		const qb = MANUFACTURER_ELECTRONICS_REF.quality_bar;
		expect(qb?.min_tabs).toBe(10);
		expect(qb?.score_simulation_lines).toBe(3);
		expect(qb?.claim_validation_mapping).toBe(true);
		expect(qb?.min_probe_detail).toBe(true);
	});
});
// ── Subtype Classification ──────────────────────────────────
describe("classifySubtype", () => {
	it("classifies Samsung-like HTML as electronics", () => {
		const html = `
			<script type="application/ld+json">{"@type":"Product"}</script>
			<a href="/smartphones/galaxy-s26-ultra/">Galaxy S26 Ultra</a>
			<span>6.9" QHD+ OLED display, 200MP camera, 5000mAh battery</span>
			<span>Snapdragon 8 Elite processor, 12GB RAM, 5G, Wi-Fi 7</span>
		`;
		const result = classifySubtype(html, "https://www.samsung.com/us/smartphones/", "manufacturer");
		expect(result.subtype).toBe("electronics");
		expect(result.confidence).toBeGreaterThan(0);
		expect(result.matched_signals.length).toBeGreaterThan(0);
	});
	it("classifies automotive URL as automotive", () => {
		const html = `
			<div>300 horsepower, 350 lb-ft torque</div>
			<span>All-wheel drivetrain, 8-speed transmission</span>
			<a href="/vehicles/suv/tucson">Build and Price</a>
		`;
		const result = classifySubtype(html, "https://www.hyundai.com/us/vehicles/", "manufacturer");
		expect(result.subtype).toBe("automotive");
	});
	it("classifies university HTML as university", () => {
		const html = `
			<span>Professor John Doe, Department of Computer Science</span>
			<a href="/faculty/cs/">Faculty</a>
			<span>Admission deadline, curriculum, semester</span>
		`;
		const result = classifySubtype(html, "https://www.mit.edu/research/", "research");
		expect(result.subtype).toBe("university");
	});
	it("returns general for empty HTML", () => {
		const result = classifySubtype("", "https://example.com", "generic");
		expect(result.subtype).toBe("general");
		expect(result.confidence).toBe(0);
	});
	it("classifies news site correctly", () => {
		const html = `
			<article><span class="byline">By Jane Reporter</span></article>
			<h1>Breaking: headline news</h1>
			<script type="application/ld+json">{"@type":"NewsArticle"}</script>
		`;
		const result = classifySubtype(html, "https://www.nytimes.com/news/", "generic");
		expect(result.subtype).toBe("news");
	});
	it("classifies SaaS site correctly", () => {
		const html = `
			<a href="/pricing">Pricing</a>
			<a href="/docs/api">API Docs</a>
			<span>Free trial, sign up, enterprise integrations</span>
		`;
		const result = classifySubtype(html, "https://www.notion.so/pricing", "generic");
		expect(result.subtype).toBe("saas");
	});
});
// ── Reference Lookup ────────────────────────────────────────
describe("findReference / listReferences", () => {
	it("finds manufacturer-electronics reference", () => {
		const ref = findReference("manufacturer", "electronics");
		expect(ref).toBeDefined();
		expect(ref?.reference_id).toBe("samsung-geo-2026-03-17");
	});
	it("returns undefined for non-existent reference", () => {
		expect(findReference("manufacturer", "automotive")).toBeUndefined();
		expect(findReference("research", "electronics")).toBeUndefined();
	});
	it("listReferences returns all registered references", () => {
		const refs = listReferences();
		expect(refs.length).toBeGreaterThanOrEqual(1);
		expect(refs[0].reference_id).toBe("samsung-geo-2026-03-17");
	});
});
// ── loadVisualizationSpec ───────────────────────────────────
describe("loadVisualizationSpec", () => {
	it("loads manufacturer spec with correct tabs", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		expect(spec.site_type).toBe("manufacturer");
		expect(spec.subtype).toBe("electronics");
		const tabIds = spec.tabs.map((t) => t.id);
		// Common tabs
		expect(tabIds).toContain("overview");
		expect(tabIds).toContain("crawlability");
		expect(tabIds).toContain("structure");
		expect(tabIds).toContain("pages");
		expect(tabIds).toContain("evidence");
		expect(tabIds).toContain("probes");
		expect(tabIds).toContain("roadmap");
		// Manufacturer-specific tabs
		expect(tabIds).toContain("products");
		expect(tabIds).toContain("brand");
		// Should NOT have research/generic tabs
		expect(tabIds).not.toContain("publications");
		expect(tabIds).not.toContain("content");
	});
	it("loads research spec with correct tabs", () => {
		const spec = loadVisualizationSpec({
			siteType: "research",
			subtype: "university",
		});
		const tabIds = spec.tabs.map((t) => t.id);
		expect(tabIds).toContain("publications");
		expect(tabIds).toContain("authority");
		expect(tabIds).not.toContain("products");
		expect(tabIds).not.toContain("brand");
	});
	it("loads generic spec with correct tabs", () => {
		const spec = loadVisualizationSpec({
			siteType: "generic",
			subtype: "news",
		});
		const tabIds = spec.tabs.map((t) => t.id);
		expect(tabIds).toContain("content");
		expect(tabIds).toContain("trust");
		expect(tabIds).not.toContain("products");
		expect(tabIds).not.toContain("publications");
	});
	it("manufacturer/electronics has reference attached", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		expect(spec.reference).toBeDefined();
		expect(spec.reference?.reference_id).toBe("samsung-geo-2026-03-17");
	});
	it("manufacturer/automotive has no reference (not yet registered)", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "automotive",
		});
		expect(spec.reference).toBeUndefined();
	});
	it("auto-classifies subtype from HTML when not provided", () => {
		const html = `
			<script type="application/ld+json">{"@type":"Product"}</script>
			<a href="/smartphones/">Smartphones</a>
			<span>camera, display, battery, processor, ram, 5g, oled</span>
		`;
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			htmlContent: html,
			url: "https://samsung.com/us/smartphones/",
		});
		expect(spec.subtype).toBe("electronics");
	});
	it("defaults to general subtype when no HTML provided", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
		});
		expect(spec.subtype).toBe("general");
	});
	it("tabs are sorted in correct order", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		const tabIds = spec.tabs.map((t) => t.id);
		const overviewIdx = tabIds.indexOf("overview");
		const productsIdx = tabIds.indexOf("products");
		const brandIdx = tabIds.indexOf("brand");
		const roadmapIdx = tabIds.indexOf("roadmap");
		expect(overviewIdx).toBeLessThan(productsIdx);
		expect(productsIdx).toBeLessThan(brandIdx);
		expect(brandIdx).toBeLessThan(roadmapIdx);
	});
	it("manufacturer roadmap has consumer_scenario_cards and vulnerability_score_cards", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		const roadmap = spec.tabs.find((t) => t.id === "roadmap");
		const elementTypes = roadmap?.required_elements.map((e) => e.type);
		expect(elementTypes).toContain("consumer_scenario_cards");
		expect(elementTypes).toContain("vulnerability_score_cards");
	});
	it("manufacturer roadmap simulation chart has 3 lines", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		const roadmap = spec.tabs.find((t) => t.id === "roadmap");
		const simChart = roadmap?.required_elements.find((e) => e.type === "score_simulation_chart");
		expect(simChart?.lines).toEqual(["overall", "exploratory_consumer", "comparative_consumer"]);
	});
	it("passes VisualizationSpecSchema validation", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		expect(() => VisualizationSpecSchema.parse(spec)).not.toThrow();
	});
});
// ── getTabSpec ───────────────────────────────────────────────
describe("getTabSpec", () => {
	it("finds tab by id", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		const tab = getTabSpec(spec, "products");
		expect(tab).toBeDefined();
		expect(tab?.title).toBe("제품 정보 인식");
	});
	it("returns undefined for non-existent tab", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		expect(getTabSpec(spec, "nonexistent")).toBeUndefined();
	});
});
// ── validateQualityBar ──────────────────────────────────────
describe("validateQualityBar", () => {
	it("manufacturer/electronics passes quality bar", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		const result = validateQualityBar(spec);
		expect(result.passed).toBe(true);
		expect(result.failures).toEqual([]);
	});
	it("spec without reference always passes", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "automotive",
		});
		const result = validateQualityBar(spec);
		expect(result.passed).toBe(true);
	});
	it("detects insufficient tabs", () => {
		const spec = loadVisualizationSpec({
			siteType: "manufacturer",
			subtype: "electronics",
		});
		// Artificially reduce tabs
		spec.tabs = spec.tabs.slice(0, 5);
		const result = validateQualityBar(spec);
		expect(result.passed).toBe(false);
		expect(result.failures.some((f) => f.includes("탭 수 부족"))).toBe(true);
	});
});
// ── SUBTYPE_SIGNALS ─────────────────────────────────────────
describe("SUBTYPE_SIGNALS", () => {
	it("has signals for key subtypes", () => {
		const subtypes = SUBTYPE_SIGNALS.map((s) => s.subtype);
		expect(subtypes).toContain("electronics");
		expect(subtypes).toContain("automotive");
		expect(subtypes).toContain("news");
		expect(subtypes).toContain("saas");
		expect(subtypes).toContain("university");
	});
	it("each signal has at least 1 url_pattern and 3 html_keywords", () => {
		for (const signal of SUBTYPE_SIGNALS) {
			expect(signal.url_patterns.length).toBeGreaterThanOrEqual(1);
			expect(signal.html_keywords.length).toBeGreaterThanOrEqual(3);
		}
	});
});
// ── SUBTYPE_BY_SITE_TYPE ────────────────────────────────────
describe("SUBTYPE_BY_SITE_TYPE", () => {
	it("manufacturer includes electronics", () => {
		expect(SUBTYPE_BY_SITE_TYPE.manufacturer).toContain("electronics");
		expect(SUBTYPE_BY_SITE_TYPE.manufacturer).toContain("general");
	});
	it("research includes university", () => {
		expect(SUBTYPE_BY_SITE_TYPE.research).toContain("university");
	});
	it("generic includes news and saas", () => {
		expect(SUBTYPE_BY_SITE_TYPE.generic).toContain("news");
		expect(SUBTYPE_BY_SITE_TYPE.generic).toContain("saas");
	});
});
//# sourceMappingURL=viz-spec-loader.test.js.map
