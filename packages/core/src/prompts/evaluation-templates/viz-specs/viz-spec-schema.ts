/**
 * Visualization Specification Schema
 *
 * 사이트 유형별 대시보드 시각화 요구사항 정의.
 * 3-계층 구조: common → site_type → reference(subtype)
 */
import { z } from "zod";

// Inline SiteTypeSchema to avoid circular import (../index.js re-exports this module)
const SiteTypeSchema = z.enum(["manufacturer", "research", "generic"]);

// ── Site Subtype ─────────────────────────────────────────────

export const SiteSubtypeSchema = z.enum([
	"electronics",
	"automotive",
	"appliance",
	"fashion",
	"university",
	"corporate_lab",
	"government_lab",
	"news",
	"saas",
	"ecommerce",
	"general",
]);
export type SiteSubtype = z.infer<typeof SiteSubtypeSchema>;

/**
 * 사이트 유형 → 가능한 서브타입 매핑
 */
export const SUBTYPE_BY_SITE_TYPE: Record<string, SiteSubtype[]> = {
	manufacturer: ["electronics", "automotive", "appliance", "fashion", "general"],
	research: ["university", "corporate_lab", "government_lab", "general"],
	generic: ["news", "saas", "ecommerce", "general"],
};

// ── Subtype Classification Signals ──────────────────────────

export interface SubtypeSignal {
	subtype: SiteSubtype;
	url_patterns: RegExp[];
	html_keywords: string[];
	schema_types: string[];
}

export const SUBTYPE_SIGNALS: SubtypeSignal[] = [
	{
		subtype: "electronics",
		url_patterns: [
			/\/(smartphones?|phones?|tablets?|laptops?|tvs?|televisions?|computers?)\//i,
			/\/(galaxy|iphone|pixel|xperia|thinkpad)\//i,
		],
		html_keywords: [
			"smartphone",
			"camera",
			"display",
			"battery",
			"processor",
			"5g",
			"oled",
			"qled",
			"megapixel",
			"mah",
			"ghz",
			"ram",
			"storage",
			"wi-fi",
			"bluetooth",
		],
		schema_types: ["Product", "Offer", "AggregateRating"],
	},
	{
		subtype: "automotive",
		url_patterns: [
			/\/(vehicles?|cars?|models?|suv|sedan|truck|ev|hybrid)\//i,
			/\/(configurator|build-and-price|test-drive)\//i,
		],
		html_keywords: [
			"horsepower",
			"torque",
			"mpg",
			"engine",
			"transmission",
			"drivetrain",
			"ev range",
			"kwh",
			"seating capacity",
		],
		schema_types: ["Vehicle", "Car", "Product"],
	},
	{
		subtype: "appliance",
		url_patterns: [
			/\/(appliances?|refrigerators?|washers?|dryers?|dishwashers?|ovens?)\//i,
			/\/(kitchen|laundry|home-appliance)\//i,
		],
		html_keywords: [
			"cu.ft",
			"cubic feet",
			"energy star",
			"btu",
			"watt",
			"decibel",
			"capacity",
			"cycle",
			"spin speed",
		],
		schema_types: ["Product", "Offer"],
	},
	{
		subtype: "fashion",
		url_patterns: [
			/\/(clothing|shoes|accessories|collections?|runway|lookbook)\//i,
			/\/(mens?|womens?|kids|apparel)\//i,
		],
		html_keywords: [
			"size",
			"color",
			"fabric",
			"cotton",
			"polyester",
			"collection",
			"season",
			"style",
			"fit",
		],
		schema_types: ["Product", "Offer", "ClothingStore"],
	},
	{
		subtype: "university",
		url_patterns: [/\.(edu|ac\.)/i, /\/(faculty|department|admissions|campus|alumni)\//i],
		html_keywords: [
			"professor",
			"faculty",
			"department",
			"admission",
			"curriculum",
			"thesis",
			"semester",
			"enrollment",
		],
		schema_types: ["EducationalOrganization", "CollegeOrUniversity", "ScholarlyArticle"],
	},
	{
		subtype: "corporate_lab",
		url_patterns: [/\/(research|labs?|innovation|ai-research|publications?)\//i, /research\./i],
		html_keywords: [
			"research",
			"publication",
			"arxiv",
			"conference",
			"paper",
			"experiment",
			"benchmark",
		],
		schema_types: ["ScholarlyArticle", "TechArticle"],
	},
	{
		subtype: "news",
		url_patterns: [/\/(news|articles?|stories?|opinion|editorial)\//i],
		html_keywords: ["byline", "dateline", "reporter", "journalist", "breaking", "headline"],
		schema_types: ["NewsArticle", "Article", "ReportageNewsArticle"],
	},
	{
		subtype: "saas",
		url_patterns: [/\/(pricing|features|docs|api|integrations?|changelog)\//i],
		html_keywords: ["pricing", "free trial", "sign up", "api", "integration", "enterprise"],
		schema_types: ["SoftwareApplication", "WebApplication", "Product"],
	},
];

// ── Derivation Formula ──────────────────────────────────────

/**
 * 데이터 산출 공식. 자연어로 기술하며 에이전트가 해석·실행한다.
 */
export const DerivationSchema = z.string().describe("데이터 산출 공식 (자연어)");

// ── Viz Element ─────────────────────────────────────────────

export const VizElementTypeSchema = z.enum([
	"score_gauge",
	"dimension_bars",
	"llm_accessibility_chart",
	"strength_weakness_opportunity",
	"bot_policy_table",
	"blocked_paths_list",
	"llms_txt_status_cards",
	"schema_doughnut_chart",
	"page_type_quality_bars",
	"schema_detail_table",
	"category_score_cards",
	"extracted_data_table",
	"product_recognition_bars",
	"product_radar_chart",
	"brand_sub_dimensions",
	"claim_verification_table",
	"llm_response_pattern_cards",
	"page_score_list",
	"evidence_section",
	"probe_summary_table",
	"probe_detail_cards",
	"claim_validation_mapping",
	"consumer_scenario_cards",
	"vulnerability_score_cards",
	"improvement_matrix_table",
	"impact_difficulty_bubble_chart",
	"sprint_roadmap",
	"score_simulation_chart",
]);
export type VizElementType = z.infer<typeof VizElementTypeSchema>;

export const VizElementSchema = z.object({
	type: VizElementTypeSchema,
	data_source: z.string().optional(),
	derivation: DerivationSchema.optional(),
	description: z.string().optional(),
	condition: z.string().optional(),
	// 유형별 커스터마이징
	columns: z.array(z.string()).optional(),
	items: z.array(z.string()).optional(),
	axes: z.array(z.string()).optional(),
	max_rows: z.number().optional(),
	count: z.number().optional(),
	card_count: z.string().optional(),
	categories: z.array(z.string()).optional(),
	datasets_per: z.string().optional(),
	lines: z.array(z.string()).optional(),
	sprints: z.array(z.string()).optional(),
	scenarios: z.array(z.string()).optional(),
	prefix_rule: z.string().optional(),
	tags_rule: z.string().optional(),
});
export type VizElement = z.infer<typeof VizElementSchema>;

// ── Tab Spec ────────────────────────────────────────────────

export const TabSpecSchema = z.object({
	id: z.string(),
	title: z.string(),
	icon: z.string().optional(),
	required_elements: z.array(VizElementSchema),
	/** 이 탭이 특정 site_type에서만 보여야 하는 경우 */
	site_types: z.array(SiteTypeSchema).optional(),
	/** 이 탭이 특정 subtype에서만 보여야 하는 경우 */
	subtypes: z.array(SiteSubtypeSchema).optional(),
});
export type TabSpec = z.infer<typeof TabSpecSchema>;

// ── Evidence Section Spec ───────────────────────────────────

export const EvidenceSectionSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
});
export type EvidenceSection = z.infer<typeof EvidenceSectionSchema>;

// ── Product Recognition Item ────────────────────────────────

export const ProductRecognitionItemSchema = z.object({
	name: z.string(),
	derivation: z.string().optional(),
});
export type ProductRecognitionItem = z.infer<typeof ProductRecognitionItemSchema>;

// ── Competitor Estimation Config ────────────────────────────

export const CompetitorEstimationSchema = z.object({
	enabled: z.boolean().default(true),
	max_competitors: z.number().default(3),
	comparison_items: z.array(z.string()),
});
export type CompetitorEstimation = z.infer<typeof CompetitorEstimationSchema>;

// ── Quality Bar (참조 대시보드 품질 기준) ────────────────────

export const QualityBarSchema = z.object({
	min_tabs: z.number().default(10),
	min_probe_detail: z.boolean().default(true),
	claim_validation_mapping: z.boolean().default(true),
	score_simulation_lines: z.number().default(3),
	min_evidence_sections: z.number().default(5),
});
export type QualityBar = z.infer<typeof QualityBarSchema>;

// ── Probe Customization ─────────────────────────────────────

export const ProbeCustomizationSchema = z.record(z.string(), z.string());
export type ProbeCustomization = z.infer<typeof ProbeCustomizationSchema>;

// ── Reference Spec (참조 대시보드 기반 구체 요구사항) ─────────

export const ReferenceSpecSchema = z.object({
	reference_id: z.string(),
	site_type: SiteTypeSchema,
	subtype: SiteSubtypeSchema,
	source_dashboard: z.string().optional(),

	product_categories_minimum: z.number().optional(),
	product_recognition_items: z.record(z.string(), z.array(z.string())).optional(),
	probe_customization: ProbeCustomizationSchema.optional(),
	competitor_estimation: CompetitorEstimationSchema.optional(),
	evidence_sections: z.array(EvidenceSectionSchema).optional(),
	quality_bar: QualityBarSchema.optional(),
});
export type ReferenceSpec = z.infer<typeof ReferenceSpecSchema>;

// ── Full Visualization Spec (병합 결과) ──────────────────────

export const VisualizationSpecSchema = z.object({
	site_type: SiteTypeSchema,
	subtype: SiteSubtypeSchema,
	tabs: z.array(TabSpecSchema),
	scoring_system: z.enum(["readiness", "performance"]).default("readiness"),
	reference: ReferenceSpecSchema.optional(),
});
export type VisualizationSpec = z.infer<typeof VisualizationSpecSchema>;
