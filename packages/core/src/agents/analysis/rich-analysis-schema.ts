/**
 * Rich Analysis Report Schema
 *
 * Captures the full 10-tab dashboard structure from the samsung_geo_dashboard reference.
 * This is the target output format for the LLM-driven analysis agent.
 *
 * Tabs:
 *  1. overview    — 종합 개요 (scores, dimensions, strengths/weaknesses/opportunities)
 *  2. crawlability — 크롤링 접근성 (bot policies, blocked/allowed paths, llms.txt)
 *  3. structure   — 구조화 데이터 (schema matrix, page-level quality)
 *  4. products    — 제품 정보 인식 (per-category scores, product lists, spec recognition)
 *  5. brand       — 브랜드 메시지 (claim analysis, brand perception dimensions)
 *  6. pages       — 페이지별 분석 (individual page scores + tags)
 *  7. recommendations — 개선 권고 (prioritized, with effort/impact + competitive comparison)
 *  8. evidence    — 실증 데이터 (raw evidence snippets, JS dependency, schema vs implementation)
 *  9. probes      — Synthetic Probe 결과 (P-01~P-08 with detailed verdicts)
 * 10. roadmap     — 개선 로드맵 (consumer scenarios, vulnerability scorecard, opportunity matrix)
 */

// ── Tab 1: Overview ────────────────────────────────────────

export interface OverviewTab {
	/** 4-card summary metrics (0-100) */
	summary_cards: Array<{
		label: string;
		score: number;
		icon: string;
	}>;
	/** 7-dimension scores */
	dimensions: Array<{
		id: string;
		label: string;
		score: number;
		weight: number;
		details: string[];
	}>;
	/** LLM service accessibility estimates */
	llm_accessibility: Array<{
		service: string;
		accessibility: number;
	}>;
	strengths: Array<{ title: string; description: string }>;
	weaknesses: Array<{ title: string; description: string }>;
	opportunities: Array<{ title: string; description: string }>;
}

// ── Tab 2: Crawlability ────────────────────────────────────

export interface BotPolicy {
	bot_name: string;
	service: string;
	status: "allowed" | "partial" | "blocked" | "not_specified";
	note: string;
	disallowed_paths: string[];
}

export interface CrawlabilityTab {
	bot_policies: BotPolicy[];
	blocked_paths: Array<{ path: string; reason: string }>;
	allowed_paths: Array<{ path: string; status: "allowed" | "blocked"; description: string }>;
	llms_txt: {
		exists: boolean;
		urls_checked: string[];
		content_preview: string | null;
	};
	robots_txt_ai_section: string | null;
}

// ── Tab 3: Structured Data ─────────────────────────────────

export interface SchemaTypeAnalysis {
	schema_type: string;
	applied_pages: string[];
	quality: "excellent" | "good" | "partial" | "none";
	llm_utility: string;
	issues: string;
}

export interface StructuredDataTab {
	/** Per-page structured data quality scores */
	page_quality: Array<{
		page: string;
		url: string;
		score: number;
	}>;
	/** Schema type × page matrix */
	schema_analysis: SchemaTypeAnalysis[];
	/** Schema type implementation counts for chart */
	schema_counts: Record<string, number>;
}

// ── Tab 4: Product Information ──────────────────────────────

export interface ProductCategoryScore {
	category: string;
	icon: string;
	score: number;
}

export interface ProductItem {
	name: string;
	size?: string;
	price?: string;
	rating?: number;
	review_count?: number;
	llm_recognition: "full" | "partial" | "none";
}

export interface SpecRecognition {
	spec_name: string;
	status: "recognized" | "partial" | "not_recognized";
	score: number;
}

export interface ProductsTab {
	category_scores: ProductCategoryScore[];
	/** Best-in-class product list (e.g., TV with full schema) */
	product_lists: Array<{
		category: string;
		products: ProductItem[];
	}>;
	/** Per-product spec recognition (e.g., Galaxy S26 Ultra) */
	spec_recognition: Array<{
		product_name: string;
		specs: SpecRecognition[];
	}>;
}

// ── Tab 5: Brand Message ───────────────────────────────────

export interface BrandDimension {
	label: string;
	score: number;
}

export interface BrandClaim {
	message: string;
	location: string;
	sentiment: "very_positive" | "positive" | "neutral" | "negative";
	verifiability: "verifiable" | "claim_no_source" | "unverifiable" | "emotional";
}

export interface BrandTab {
	dimensions: BrandDimension[];
	claims: BrandClaim[];
}

// ── Tab 6: Page-by-Page Analysis ───────────────────────────

export interface PageAnalysis {
	url: string;
	title: string;
	score: number;
	description: string;
	tags: Array<{
		label: string;
		type: "good" | "bad" | "neutral";
	}>;
}

export interface PagesTab {
	pages: PageAnalysis[];
}

// ── Tab 7: Recommendations ─────────────────────────────────

export interface Recommendation {
	id: string;
	title: string;
	priority: "high" | "medium" | "low";
	impact: string;
	effort: string;
	expected_improvement: string;
	description: string;
}

export interface CompetitorComparison {
	item: string;
	scores: Record<string, string>;
}

export interface RecommendationsTab {
	high_priority: Recommendation[];
	medium_priority: Recommendation[];
	low_priority: Recommendation[];
	competitive_comparison: {
		competitors: string[];
		items: CompetitorComparison[];
	} | null;
}

// ── Tab 8: Evidence ────────────────────────────────────────

export interface RichEvidenceSection {
	id: string;
	title: string;
	content: string;
}

export interface SchemaImplementationRow {
	product_category: string;
	page_url: string;
	item_list: boolean;
	product: boolean;
	offer: boolean;
	aggregate_rating: boolean;
	specs: boolean;
	breadcrumb: boolean;
	faq_page: boolean;
	llm_availability_pct: number;
}

export interface JsDependencyItem {
	data_item: string;
	example_value: string;
	in_static_html: boolean;
	llm_accessible: "yes" | "partial" | "no";
	geo_impact: string;
}

export interface ClaimVerification {
	claim: string;
	source_page: string;
	evidence_provided: boolean;
	llm_trust_level: "high" | "medium" | "low";
	factcheck_risk: "low" | "medium" | "high";
}

export interface EvidenceTab {
	sections: RichEvidenceSection[];
	schema_implementation_matrix: SchemaImplementationRow[];
	js_dependency_details: JsDependencyItem[];
	claim_verifications: ClaimVerification[];
}

// ── Tab 9: Synthetic Probes ────────────────────────────────

export interface RichProbeResult {
	probe_id: string;
	prompt: string;
	test_page: string;
	required_data: string[];
	page_schema: string;
	data_availability: string;
	verdict: "PASS" | "PARTIAL" | "FAIL";
	evidence_claim: string;
	llm_response_excerpt?: string;
	tags?: Array<{ label: string; type: "good" | "bad" | "neutral" }>;
}

export interface ProbesTab {
	methodology: string;
	summary: {
		total: number;
		pass: number;
		partial: number;
		fail: number;
		pass_rate: number;
	};
	results: RichProbeResult[];
}

// ── Tab 10: Roadmap ────────────────────────────────────────

export interface ConsumerScenario {
	id: string;
	name: string;
	query_example: string;
	problem: string;
}

export interface VulnerabilityScore {
	label: string;
	icon: string;
	score: number;
	description: string;
}

export interface OpportunityItem {
	id: string;
	title: string;
	scenario_type: "discovery" | "comparison" | "other";
	current_state: string;
	improvement_direction: string;
	impact_stars: number;
	difficulty: "low" | "medium" | "high";
	effort_estimate: string;
}

export interface RoadmapTab {
	consumer_scenarios: ConsumerScenario[];
	vulnerability_scores: VulnerabilityScore[];
	opportunity_matrix: OpportunityItem[];
}

// ── Full Report ────────────────────────────────────────────

/**
 * LLM Agent Loop가 생성하는 10탭 분석 보고서.
 *
 * llm-analysis-agent.ts의 piAiAgentLoop()가 SKILL.md 프롬프트를 따라
 * 9개 도구(crawl_page, score_geo, classify_site 등)를 호출하며 수집한 데이터를 종합.
 * 파이프라인 ANALYZING 단계에서 생성되며, pipeline-runner.ts에서 `richReport`로 보관.
 *
 * 10탭 구조:
 *  1. overview         — 종합 점수, 강점/약점/기회
 *  2. crawlability     — robots.txt, 봇 접근성, llms.txt
 *  3. structured_data  — JSON-LD, Schema.org 현황
 *  4. products         — 제품/서비스 인식 정보
 *  5. brand            — 브랜드/마케팅 메시지
 *  6. pages            — 멀티 페이지별 분석
 *  7. recommendations  — 개선 권고사항
 *  8. evidence         — 수집 증거 원문
 *  9. probes           — Synthetic Probe 결과 (nullable)
 * 10. roadmap          — 개선 로드맵/기회 매트릭스
 *
 * @see ARCHITECTURE.md 4.2, 9-C.3, 9-E.5
 */
export interface RichAnalysisReport {
	/** Target site info */
	target: {
		url: string;
		title: string;
		site_type: string;
		site_type_confidence: number;
		analyzed_at: string;
	};
	/** Overall GEO score */
	overall_score: number;
	grade: string;
	/** 10 tabs of data */
	overview: OverviewTab;
	crawlability: CrawlabilityTab;
	structured_data: StructuredDataTab;
	products: ProductsTab;
	brand: BrandTab;
	pages: PagesTab;
	recommendations: RecommendationsTab;
	evidence: EvidenceTab;
	probes: ProbesTab | null;
	roadmap: RoadmapTab;
}
