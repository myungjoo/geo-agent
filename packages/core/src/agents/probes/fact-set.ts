/**
 * Fact Set — Ground Truth (L0) 팩트 추출
 *
 * CrawlData + GeoEvaluationData로부터 개별 Fact를 기계적으로 추출한다.
 * LLM 호출 없음 (4-D 원칙: 기계적 작업은 코드로).
 *
 * 추출 소스:
 * - JSON-LD Product 스키마 → PRODUCT_DETAIL, PRICING, FEATURE
 * - JSON-LD ItemList → PRODUCT_LIST
 * - meta description → CUSTOM
 * - marketing claims (verifiable) → STAT
 * - product_info → PRODUCT_DETAIL, PRICING, FEATURE
 */
import { v4 as uuidv4 } from "uuid";
import type { InfoCategory } from "../../models/info-recognition.js";
import type { ExtractedProductInfo, MarketingClaim } from "../analysis/geo-eval-extractor.js";
import type { CrawlData } from "../shared/types.js";

// ── Types ───────────────────────────────────────────────────

export interface Fact {
	fact_id: string;
	category: InfoCategory;
	label: string;
	expected_value: string;
	source: "json_ld" | "html_text" | "meta_tag" | "marketing_claim";
}

export interface FactSet {
	site_name: string;
	site_url: string;
	brand: string;
	facts: Fact[];
	extracted_at: string;
}

/** Subset of GeoEvaluationData fields needed for fact extraction */
export interface FactExtractionInput {
	product_info: Array<{
		page_url: string;
		filename: string;
		info: ExtractedProductInfo;
	}>;
	marketing_claims: MarketingClaim[];
}

// ── Fact Extraction ─────────────────────────────────────────

function addFact(
	facts: Fact[],
	category: InfoCategory,
	label: string,
	value: string,
	source: Fact["source"],
): void {
	if (!value || value.trim().length === 0) return;
	facts.push({
		fact_id: uuidv4(),
		category,
		label,
		expected_value: value.trim(),
		source,
	});
}

/** Extract facts from JSON-LD Product schema entries */
function extractJsonLdFacts(jsonLd: Record<string, unknown>[], facts: Fact[]): void {
	for (const ld of jsonLd) {
		const type = String(ld["@type"] ?? "").toLowerCase();

		if (type === "product") {
			const name = ld.name as string | undefined;
			if (name) {
				addFact(facts, "PRODUCT_DETAIL", `Product: ${name}`, String(name), "json_ld");
			}

			const desc = ld.description as string | undefined;
			if (desc) {
				addFact(
					facts,
					"FEATURE",
					`Product description: ${name ?? "unknown"}`,
					String(desc).slice(0, 300),
					"json_ld",
				);
			}

			// Offers → pricing
			const offers = ld.offers as Record<string, unknown> | undefined;
			if (offers?.price) {
				const currency = String(offers.priceCurrency ?? "USD");
				addFact(
					facts,
					"PRICING",
					`Price: ${name ?? "product"}`,
					`${currency} ${offers.price}`,
					"json_ld",
				);
			}

			// additionalProperty → feature specs
			const props = ld.additionalProperty;
			if (Array.isArray(props)) {
				for (const prop of props) {
					const p = prop as Record<string, unknown>;
					if (p.name && p.value) {
						addFact(facts, "FEATURE", `Spec: ${p.name}`, `${p.name}: ${p.value}`, "json_ld");
					}
				}
			}

			// AggregateRating
			const rating = ld.aggregateRating as Record<string, unknown> | undefined;
			if (rating?.ratingValue) {
				addFact(
					facts,
					"STAT",
					`Rating: ${name ?? "product"}`,
					`${rating.ratingValue}/5 (${rating.reviewCount ?? "?"} reviews)`,
					"json_ld",
				);
			}
		}

		// ItemList → product list
		if (type === "itemlist") {
			const items = ld.itemListElement;
			if (Array.isArray(items)) {
				const names = items
					.slice(0, 10)
					.map((item) => {
						const it = (item as Record<string, unknown>).item as
							| Record<string, unknown>
							| undefined;
						return it?.name ? String(it.name) : null;
					})
					.filter(Boolean);
				if (names.length > 0) {
					addFact(facts, "PRODUCT_LIST", "Product catalog", names.join(", "), "json_ld");
				}
			}
		}

		// Organization
		if (type === "organization" || type === "corporation") {
			const name = ld.name as string | undefined;
			if (name) {
				addFact(facts, "CONTACT", `Organization: ${name}`, String(name), "json_ld");
			}
		}

		// Check @graph for nested types
		const graph = ld["@graph"];
		if (Array.isArray(graph)) {
			extractJsonLdFacts(graph as Record<string, unknown>[], facts);
		}
	}
}

/** Extract facts from product_info (static extraction results) */
function extractProductInfoFacts(
	productInfos: FactExtractionInput["product_info"],
	facts: Fact[],
): void {
	for (const pi of productInfos) {
		const info = pi.info;

		if (info.product_name) {
			addFact(
				facts,
				"PRODUCT_DETAIL",
				`Product: ${info.product_name}`,
				info.product_name,
				"html_text",
			);
		}

		for (const price of info.prices) {
			addFact(facts, "PRICING", `Price: ${info.product_name ?? "product"}`, price, "html_text");
		}

		for (const spec of info.specs_in_schema) {
			addFact(facts, "FEATURE", `Schema spec: ${info.product_name ?? "product"}`, spec, "json_ld");
		}

		for (const spec of info.specs_in_html) {
			addFact(facts, "FEATURE", `HTML spec: ${info.product_name ?? "product"}`, spec, "html_text");
		}

		if (info.has_aggregate_rating && info.rating_value) {
			addFact(
				facts,
				"STAT",
				`Rating: ${info.product_name ?? "product"}`,
				`${info.rating_value}/5 (${info.review_count ?? "?"} reviews)`,
				"html_text",
			);
		}
	}
}

/** Extract facts from marketing claims (verifiable ones only) */
function extractMarketingClaimFacts(claims: MarketingClaim[], facts: Fact[]): void {
	for (const claim of claims) {
		if (claim.verifiability === "verifiable" || claim.verifiability === "factual") {
			addFact(facts, "STAT", `Claim: ${claim.text.slice(0, 50)}`, claim.text, "marketing_claim");
		}
	}
}

/** Extract fact from meta description */
function extractMetaFacts(metaTags: Record<string, string>, facts: Fact[]): void {
	const desc = metaTags.description;
	if (desc && desc.trim().length > 10) {
		addFact(facts, "CUSTOM", "Meta description", desc.trim(), "meta_tag");
	}
}

// ── Main Entry Point ────────────────────────────────────────

/**
 * Build a FactSet from CrawlData and GeoEvaluationData.
 * Pure mechanical extraction — no LLM calls.
 */
export function buildFactSet(
	crawlData: CrawlData,
	evalData: FactExtractionInput,
	options?: {
		brand?: string;
		site_name?: string;
	},
): FactSet {
	const facts: Fact[] = [];

	// 1. JSON-LD facts
	extractJsonLdFacts(crawlData.json_ld as Record<string, unknown>[], facts);

	// 2. Product info facts (from eval data)
	extractProductInfoFacts(evalData.product_info, facts);

	// 3. Marketing claims (verifiable only)
	extractMarketingClaimFacts(evalData.marketing_claims, facts);

	// 4. Meta tags
	extractMetaFacts(crawlData.meta_tags, facts);

	// Deduplicate by (category, expected_value)
	const seen = new Set<string>();
	const deduped = facts.filter((f) => {
		const key = `${f.category}::${f.expected_value}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const hostname = new URL(crawlData.url).hostname;

	return {
		site_name: options?.site_name ?? crawlData.title ?? hostname,
		site_url: crawlData.url,
		brand: options?.brand ?? hostname.replace("www.", "").split(".")[0],
		facts: deduped,
		extracted_at: new Date().toISOString(),
	};
}
