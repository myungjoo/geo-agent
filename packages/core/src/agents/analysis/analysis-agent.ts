/**
 * Analysis Agent
 *
 * 파이프라인 첫 단계: Target URL을 크롤링하고 정적 분석 + 사이트 분류 + GEO 채점을 수행.
 * 결과: AnalysisReport (DB 저장 가능) + GeoScoreData + ClassificationResult
 *
 * LLM 호출 없이 동작하는 정적 분석 전용 에이전트.
 * Synthetic Probes (LLM 필요)는 별도 단계에서 보강.
 */
import { v4 as uuidv4 } from "uuid";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import type { AnalysisReport } from "../../models/analysis-report.js";
import type { GeoScore } from "../../models/geo-score.js";
import { buildPageContext, parseJsonResponse, safeLLMCall } from "../shared/llm-helpers.js";
import {
	type ContentQualityAssessment,
	ContentQualityAssessmentSchema,
} from "../shared/llm-response-schemas.js";
import type {
	CrawlData,
	MultiPageAnalysisResult,
	MultiPageCrawlResult,
	PageScoreResult,
} from "../shared/types.js";
import { type GeoEvaluationData, extractGeoEvaluationData } from "./geo-eval-extractor.js";

// ── Analysis Agent Input/Output ─────────────────────────────

export interface AnalysisInput {
	target_id: string;
	target_url: string;
	/** 크롤링 타임아웃 (ms, 기본: 15000) */
	crawl_timeout?: number;
}

export interface AnalysisOutput {
	report: AnalysisReport;
	crawl_data: CrawlData;
	classification: {
		site_type: string;
		confidence: number;
		matched_signals: string[];
	};
	geo_scores: {
		overall_score: number;
		grade: string;
		dimensions: Array<{
			id: string;
			label: string;
			score: number;
			weight: number;
			details: string[];
		}>;
	};
	/** 멀티페이지 분석 결과 (manufacturer 사이트 등). null이면 단일 페이지 분석. */
	multi_page: MultiPageAnalysisResult | null;
	/** 클론 저장용 전체 페이지 데이터. null이면 단일 페이지. */
	all_pages: Array<{ filename: string; crawl_data: CrawlData }> | null;
	/** 상세 GEO 평가 데이터 (봇 정책, 스키마 커버리지, 클레임, JS 의존성, 제품 정보) */
	eval_data: GeoEvaluationData;
	/** LLM 콘텐츠 품질 평가 (chatLLM 없으면 null) */
	llm_assessment: ContentQualityAssessment | null;
}

// ── Helper: CrawlData → AnalysisReport 변환 ─────────────────

function computeJsDependencyRatio(html: string): number {
	const totalSize = html.length || 1;
	// Count bytes inside <script> tags (inline + references)
	const scriptBlocks = html.match(/<script[\s\S]*?<\/script>/gi) || [];
	const scriptSize = scriptBlocks.reduce((sum, block) => sum + block.length, 0);
	// Count external script references
	const externalScripts = (html.match(/<script[^>]+src=/gi) || []).length;
	// Ratio: script bytes / total bytes + penalty for many external scripts
	const ratio = scriptSize / totalSize + Math.min(externalScripts * 0.02, 0.2);
	return Math.min(Math.round(ratio * 1000) / 1000, 1);
}

function computeStructureQuality(html: string) {
	const semanticTags = ["article", "section", "main", "nav", "aside", "header", "footer"];
	const semanticCount = semanticTags.filter((tag) =>
		new RegExp(`<${tag}[\\s>]`, "i").test(html),
	).length;
	const totalTags = (html.match(/<[a-z][a-z0-9]*[\s>]/gi) || []).length || 1;

	// Div nesting depth (approximate)
	let maxDepth = 0;
	let currentDepth = 0;
	const divPattern = /<\/?div[\s>]/gi;
	let m = divPattern.exec(html);
	while (m) {
		if (m[0].startsWith("</")) {
			currentDepth = Math.max(0, currentDepth - 1);
		} else {
			currentDepth++;
			maxDepth = Math.max(maxDepth, currentDepth);
		}
		m = divPattern.exec(html);
	}

	const textContent = html
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const textRatio = textContent.length / Math.max(html.length, 1);

	const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
	const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
	const headingValid = h1Count === 1 && h2Count > 0;

	return {
		semantic_tag_ratio: Math.min(semanticCount / 7, 1),
		div_nesting_depth: maxDepth,
		text_to_markup_ratio: Math.round(textRatio * 1000) / 1000,
		heading_hierarchy_valid: headingValid,
	};
}

async function computeContentAnalysis(
	html: string,
	topics: string[],
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
) {
	const textContent = html
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const words = textContent.split(/\s+/);
	const wordCount = words.length;

	// Content density: text bytes vs total bytes
	const density = Math.round((textContent.length / Math.max(html.length, 1)) * 100);

	// Readability level: LLM-based (필수 — ARCHITECTURE.md 9-A.1)
	let readability: "technical" | "general" | "simplified";
	const excerpt = textContent.slice(0, 500);
	const response = await chatLLM({
		prompt: `Analyze the readability level of the following text excerpt. Classify it as one of: "technical", "general", or "simplified".\n\n- "technical": specialized vocabulary, complex sentence structures, assumes domain expertise\n- "general": everyday language accessible to most adults, moderate complexity\n- "simplified": very simple language, short sentences, basic vocabulary\n\nText excerpt:\n"""\n${excerpt}\n"""\n\nRespond with JSON only: { "readability_level": "technical"|"general"|"simplified", "reasoning": "brief explanation" }`,
		system_instruction:
			"You are a readability analyst. Classify text readability. Respond with JSON only.",
		json_mode: true,
		temperature: 0.1,
		max_tokens: 200,
	});
	const parsed = JSON.parse(response.content);
	const level = parsed.readability_level;
	if (level === "technical" || level === "general" || level === "simplified") {
		readability = level;
	} else {
		// Invalid LLM response — use heuristic as last resort
		const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / Math.max(wordCount, 1);
		readability = avgWordLen > 7 ? "technical" : avgWordLen > 5 ? "general" : "simplified";
	}

	// Topic alignment: check how many target topics appear in content
	const lowerText = textContent.toLowerCase();
	const found = topics.filter((t) => lowerText.includes(t.toLowerCase()));

	return {
		word_count: wordCount,
		content_density: Math.min(density, 100),
		readability_level: readability,
		key_topics_found: found,
		topic_alignment: topics.length > 0 ? found.length / topics.length : 0,
	};
}

function buildGeoScore(scoreData: {
	overall_score: number;
	dimensions: Array<{ id: string; score: number }>;
}): GeoScore {
	// Map dimension scores to GeoScore fields
	const dimMap: Record<string, number> = {};
	for (const d of scoreData.dimensions) {
		dimMap[d.id] = d.score;
	}

	return {
		total: scoreData.overall_score,
		citation_rate: 0, // Probe 실행 후 pipeline-runner에서 반영 (probeResults → current_geo_score)
		citation_accuracy: 0, // Probe 실행 후 pipeline-runner에서 반영
		info_recognition_score: 0, // Probe 실행 후 pipeline-runner에서 반영
		coverage: dimMap.S3 ?? 0, // 콘텐츠 기계가독성 → coverage 근사
		rank_position: 0,
		structured_score: dimMap.S2 ?? 0, // 구조화 데이터 → structured_score
		measured_at: new Date().toISOString(),
		llm_breakdown: {},
	};
}

// ── Analysis Agent 실행 함수 ─────────────────────────────────

/** ScoreTarget return type alias for brevity */
type ScoreTargetResult = {
	overall_score: number;
	grade: string;
	dimensions: Array<{
		id: string;
		label: string;
		score: number;
		weight: number;
		details: string[];
	}>;
};

export interface AnalysisDeps {
	crawlTarget: (url: string, timeout?: number) => Promise<CrawlData>;
	scoreTarget: (data: CrawlData) => ScoreTargetResult;
	classifySite: (
		html: string,
		url: string,
	) => {
		site_type: string;
		confidence: number;
		matched_signals: string[];
		all_signals: Array<{ site_type: string; confidence: number; signals: string[] }>;
	};
	/** Multi-page crawl (optional — manufacturer 사이트에서 자동 사용) */
	crawlMultiplePages?: (
		url: string,
		maxPages?: number,
		timeoutMs?: number,
	) => Promise<MultiPageCrawlResult>;
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>;
}

/**
 * 단일 CrawlData로부터 PageScoreResult 생성
 */
function buildPageScore(
	crawlData: CrawlData,
	filename: string,
	scoreTarget: (data: CrawlData) => ScoreTargetResult,
): PageScoreResult {
	const scores = scoreTarget(crawlData);
	return { url: crawlData.url, filename, scores };
}

/**
 * 멀티 페이지 점수 집계: 홈 2x 가중 + 나머지 1x
 */
function computeAggregateScores(
	homepage: PageScoreResult,
	pages: PageScoreResult[],
): {
	aggregate_score: number;
	aggregate_grade: string;
	per_dimension_averages: MultiPageAnalysisResult["per_dimension_averages"];
} {
	const allPages = [homepage, ...pages];
	const weights = [2, ...pages.map(() => 1)];
	const totalWeight = weights.reduce((a, b) => a + b, 0);

	const weightedSum = allPages.reduce((sum, p, i) => sum + p.scores.overall_score * weights[i], 0);
	const aggregate_score = Math.round((weightedSum / totalWeight) * 10) / 10;

	const aggregate_grade =
		aggregate_score >= 90
			? "Excellent"
			: aggregate_score >= 75
				? "Good"
				: aggregate_score >= 55
					? "Needs Improvement"
					: aggregate_score >= 35
						? "Poor"
						: "Critical";

	// Per-dimension averages (weighted)
	const dimIds = homepage.scores.dimensions.map((d) => d.id);
	const per_dimension_averages = dimIds.map((dimId) => {
		const dim = homepage.scores.dimensions.find((d) => d.id === dimId)!;
		const sum = allPages.reduce((s, p, i) => {
			const pDim = p.scores.dimensions.find((d) => d.id === dimId);
			return s + (pDim?.score ?? 0) * weights[i];
		}, 0);
		return { id: dimId, label: dim.label, avg_score: Math.round((sum / totalWeight) * 10) / 10 };
	});

	return { aggregate_score, aggregate_grade, per_dimension_averages };
}

export async function runAnalysis(
	input: AnalysisInput,
	deps: AnalysisDeps,
): Promise<AnalysisOutput> {
	// 1. Crawl
	const crawlData = await deps.crawlTarget(input.target_url, input.crawl_timeout ?? 15000);

	// 2. Classify
	const classification = deps.classifySite(crawlData.html, crawlData.url);

	// 3. Score homepage (static)
	const geoScores = deps.scoreTarget(crawlData);

	// 4. Multi-page analysis (manufacturer 사이트 + crawlMultiplePages 제공 시)
	let multiPage: MultiPageAnalysisResult | null = null;
	let allPages: Array<{ filename: string; crawl_data: CrawlData }> | null = null;

	if (classification.site_type === "manufacturer" && deps.crawlMultiplePages) {
		const mpResult = await deps.crawlMultiplePages(
			input.target_url,
			20,
			input.crawl_timeout ?? 15000,
		);

		const homepageScore = buildPageScore(mpResult.homepage, "index.html", deps.scoreTarget);
		const pageScores: PageScoreResult[] = mpResult.pages.map((p) =>
			buildPageScore(p.crawl_data, p.path, deps.scoreTarget),
		);

		const agg = computeAggregateScores(homepageScore, pageScores);

		multiPage = {
			homepage_scores: homepageScore,
			page_scores: pageScores,
			...agg,
		};

		allPages = mpResult.pages.map((p) => ({
			filename: p.path,
			crawl_data: p.crawl_data,
		}));
	}

	// 5. Build AnalysisReport
	const structureQuality = computeStructureQuality(crawlData.html);
	const contentAnalysis = await computeContentAnalysis(crawlData.html, [], deps.chatLLM);

	const effectiveScore = multiPage?.aggregate_score ?? geoScores.overall_score;
	const effectiveGrade = multiPage?.aggregate_grade ?? geoScores.grade;

	const report: AnalysisReport = {
		report_id: uuidv4(),
		target_id: input.target_id,
		url: input.target_url,
		analyzed_at: new Date().toISOString(),

		machine_readability: {
			grade:
				effectiveScore >= 75 ? "A" : effectiveScore >= 55 ? "B" : effectiveScore >= 35 ? "C" : "F",
			js_dependency_ratio: computeJsDependencyRatio(crawlData.html),
			structure_quality: structureQuality,
			crawler_access: [
				{
					user_agent: "GEO-Agent/1.0",
					http_status: crawlData.status_code,
					blocked_by_robots_txt: false,
					content_accessible: crawlData.status_code === 200,
				},
			],
		},

		content_analysis: contentAnalysis,

		structured_data: {
			json_ld_present: crawlData.json_ld.length > 0,
			json_ld_types: crawlData.json_ld
				.map((ld) => String((ld as Record<string, unknown>)["@type"] ?? ""))
				.filter(Boolean),
			schema_completeness: Math.min(crawlData.json_ld.length / 5, 1),
			og_tags_present: Object.keys(crawlData.meta_tags).some((k) => k.startsWith("og:")),
			meta_description: crawlData.meta_tags.description ?? null,
		},

		extracted_info_items: [],
		current_geo_score: buildGeoScore({
			overall_score: effectiveScore,
			dimensions: geoScores.dimensions,
		}),
		competitor_gaps: [],
		llm_status: [],
	};

	// Multi-page인 경우 집계 점수를 geo_scores에 반영
	const finalGeoScores = multiPage
		? {
				overall_score: multiPage.aggregate_score,
				grade: multiPage.aggregate_grade,
				dimensions: geoScores.dimensions, // 차원별은 홈페이지 기준 유지 (집계는 multi_page에)
			}
		: geoScores;

	// 6. Extract detailed GEO evaluation data
	const subPages =
		allPages?.map((p) => ({
			url: p.crawl_data.url,
			filename: p.filename,
			crawl_data: p.crawl_data,
		})) ?? [];
	const evalData = await extractGeoEvaluationData(
		crawlData,
		subPages,
		deps.chatLLM,
		geoScores.dimensions,
	);

	// 7. LLM content quality assessment (4-D: LLM required, no fallback)
	let llmAssessment: ContentQualityAssessment | null = null;
	const pageContext = buildPageContext(crawlData.html, crawlData.url, {
		robots_txt: crawlData.robots_txt,
		llms_txt: crawlData.llms_txt,
		json_ld: crawlData.json_ld,
		meta_tags: crawlData.meta_tags,
		title: crawlData.title,
		site_type: classification.site_type,
		scores: Object.fromEntries(geoScores.dimensions.map((d) => [d.id, d.score])),
	});

	const { result } = await safeLLMCall(
		deps.chatLLM,
		{
			prompt: `Evaluate this web page for LLM consumption quality. Analyze brand recognition, content quality, information gaps, and issues that affect how well LLMs can understand and cite this page. Respond in JSON format.\n\nPage context:\n${JSON.stringify(pageContext, null, 2)}`,
			system_instruction: `You are a GEO (Generative Engine Optimization) expert. Evaluate web pages for LLM consumption quality. Respond with JSON only:\n{\n  "brand_recognition": { "score": 0-100, "identified_brand": "string", "identified_products": ["string"], "reasoning": "string" },\n  "content_quality": { "score": 0-100, "clarity": 0-100, "completeness": 0-100, "factual_density": 0-100, "reasoning": "string" },\n  "information_gaps": [{ "category": "string", "description": "string", "importance": "critical|high|medium|low" }],\n  "llm_consumption_issues": [{ "issue": "string", "recommendation": "string" }],\n  "overall_assessment": "string"\n}`,
			json_mode: true,
			temperature: 0.3,
			max_tokens: 2000,
		},
		(content) => parseJsonResponse(content, ContentQualityAssessmentSchema),
	);
	llmAssessment = result;

	return {
		report,
		crawl_data: crawlData,
		classification,
		geo_scores: finalGeoScores,
		multi_page: multiPage,
		all_pages: allPages,
		eval_data: evalData,
		llm_assessment: llmAssessment,
	};
}
