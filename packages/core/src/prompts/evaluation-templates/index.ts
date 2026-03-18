/**
 * GEO Evaluation Template System
 *
 * 사이트 유형별 평가 프롬프트 템플릿 관리
 * - manufacturer: 제조사 대표 Site (samsung.com, apple.com 등)
 * - research: 연구소 대표 Site (research.samsung.com 등)
 * - generic: 기타 사이트
 */

import { z } from "zod";

// ── Site Type 정의 ──────────────────────────────────────────

export const SiteTypeSchema = z.enum(["manufacturer", "research", "generic"]);
export type SiteType = z.infer<typeof SiteTypeSchema>;

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
	manufacturer: "제조사 대표 Site",
	research: "연구소 대표 Site",
	generic: "기타",
};

// ── Auto-Classification 시그널 ──────────────────────────────

export const ClassificationSignalSchema = z.object({
	site_type: SiteTypeSchema,
	confidence: z.number().min(0).max(1),
	signals: z.array(z.string()),
});
export type ClassificationSignal = z.infer<typeof ClassificationSignalSchema>;

/**
 * 사이트 유형 자동 분류를 위한 시그널 정의
 */
export const CLASSIFICATION_SIGNALS: Record<SiteType, string[]> = {
	manufacturer: [
		"Product JSON-LD 스키마 존재",
		"Offer/AggregateRating 스키마 존재",
		"/products/, /shop/, /buy/ 경로 존재",
		"E-commerce 관련 메타태그 (og:product:price 등)",
		"제품 카탈로그 또는 카테고리 페이지 존재",
		"가격 정보가 정적 HTML에 포함",
	],
	research: [
		"ScholarlyArticle/TechArticle 스키마 존재",
		"/publications/, /papers/, /research/ 경로 존재",
		"DOI 링크 존재",
		"연구자 Person 스키마 (ORCID, affiliation)",
		"학술 메타태그 (citation_*, DC.*)",
		"PDF 논문 다운로드 링크 존재",
	],
	generic: [
		"위 두 유형의 시그널이 모두 약함",
		"Article/NewsArticle 스키마 (일반 콘텐츠)",
		"Service/LocalBusiness 스키마",
		"Organization 스키마만 존재",
	],
};

// ── Scoring Dimension (공통) ────────────────────────────────

export const ScoringDimensionSchema = z.object({
	id: z.string(), // "S1" ~ "S7"
	name: z.string(),
	weight: z.number().min(0).max(1),
	score: z.number().min(0).max(100).optional(),
});
export type ScoringDimension = z.infer<typeof ScoringDimensionSchema>;

/**
 * 사이트 유형별 기본 채점 차원
 * 가중치 합계 = 1.0, 차원 ID/가중치는 동일, 이름만 유형별 차이
 */
export const DEFAULT_SCORING_DIMENSIONS: Record<SiteType, ScoringDimension[]> = {
	manufacturer: [
		{ id: "S1", name: "LLM 크롤링 접근성", weight: 0.15 },
		{ id: "S2", name: "구조화 데이터 품질", weight: 0.25 },
		{ id: "S3", name: "제품 스펙 기계가독성", weight: 0.2 },
		{ id: "S4", name: "콘텐츠 팩트 밀도", weight: 0.1 },
		{ id: "S5", name: "브랜드 메시지 긍정도·일관성", weight: 0.1 },
		{ id: "S6", name: "AI 친화적 인프라", weight: 0.1 },
		{ id: "S7", name: "콘텐츠 탐색 구조", weight: 0.1 },
	],
	research: [
		{ id: "S1", name: "LLM 크롤링 접근성", weight: 0.15 },
		{ id: "S2", name: "학술 데이터 구조화 품질", weight: 0.25 },
		{ id: "S3", name: "논문 정보 기계가독성", weight: 0.2 },
		{ id: "S4", name: "연구 콘텐츠 깊이", weight: 0.1 },
		{ id: "S5", name: "연구소 신뢰도·권위 지표", weight: 0.1 },
		{ id: "S6", name: "AI 친화적 인프라", weight: 0.1 },
		{ id: "S7", name: "콘텐츠 탐색·연결 구조", weight: 0.1 },
	],
	generic: [
		{ id: "S1", name: "LLM 크롤링 접근성", weight: 0.15 },
		{ id: "S2", name: "구조화 데이터 품질", weight: 0.25 },
		{ id: "S3", name: "콘텐츠 기계가독성", weight: 0.2 },
		{ id: "S4", name: "콘텐츠 팩트 밀도", weight: 0.1 },
		{ id: "S5", name: "브랜드/조직 신뢰도 지표", weight: 0.1 },
		{ id: "S6", name: "AI 친화적 인프라", weight: 0.1 },
		{ id: "S7", name: "콘텐츠 탐색 구조", weight: 0.1 },
	],
};

// ── Probe Verdict ───────────────────────────────────────────

export const ProbeVerdictSchema = z.enum(["PASS", "PARTIAL", "FAIL"]);
export type ProbeVerdict = z.infer<typeof ProbeVerdictSchema>;

export const ProbeResultSchema = z.object({
	probe_id: z.string(), // "P-01" ~ "P-08"
	verdict: ProbeVerdictSchema,
	found: z.number(),
	total: z.number(),
	notes: z.string().optional(),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

// ── Evaluation Result ───────────────────────────────────────

export const GradeSchema = z.enum(["Excellent", "Good", "Needs Improvement", "Poor", "Critical"]);
export type Grade = z.infer<typeof GradeSchema>;

export function calculateGrade(score: number): Grade {
	if (score >= 90) return "Excellent";
	if (score >= 75) return "Good";
	if (score >= 55) return "Needs Improvement";
	if (score >= 35) return "Poor";
	return "Critical";
}

export function calculateOverallScore(dimensions: ScoringDimension[]): number {
	return dimensions.reduce((sum, d) => sum + (d.score ?? 0) * d.weight, 0);
}

export const EvaluationResultSchema = z.object({
	run_id: z.string(),
	site_name: z.string(),
	base_url: z.string(),
	site_type: SiteTypeSchema,
	evaluated_at: z.string(),
	cycle_number: z.number(),
	evaluation_target: z.enum(["original", "clone"]),
	overall_score: z.number(),
	grade: GradeSchema,
	dimension_scores: z.record(z.string(), z.number()),
	probe_results: z.record(z.string(), ProbeResultSchema),
	key_findings: z.array(z.string()),
	top_improvements: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			sprint: z.number(),
			impact: z.number(),
			difficulty: z.number(),
			affected_dimensions: z.array(z.string()),
		}),
	),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ── Cycle Control ───────────────────────────────────────────

export const CycleStopReasonSchema = z.enum([
	"score_sufficient",
	"no_more_improvements",
	"max_cycles_reached",
	"manual_stop",
]);
export type CycleStopReason = z.infer<typeof CycleStopReasonSchema>;

export const CycleControlSchema = z.object({
	max_cycles: z.number().default(10),
	target_score: z.number().min(0).max(100).default(80),
	min_improvement_per_cycle: z.number().default(2),
	current_cycle: z.number().default(0),
	stop_reason: CycleStopReasonSchema.optional(),
	intermediate_results: z.array(EvaluationResultSchema).default([]),
});
export type CycleControl = z.infer<typeof CycleControlSchema>;

/**
 * Cycle 중단 조건 판정
 */
export function shouldStopCycle(control: CycleControl): {
	should_stop: boolean;
	reason?: CycleStopReason;
} {
	// 1. 최대 사이클 도달
	if (control.current_cycle >= control.max_cycles) {
		return { should_stop: true, reason: "max_cycles_reached" };
	}

	const results = control.intermediate_results;
	if (results.length === 0) {
		return { should_stop: false };
	}

	const latestScore = results[results.length - 1].overall_score;

	// 2. 목표 점수 도달
	if (latestScore >= control.target_score) {
		return { should_stop: true, reason: "score_sufficient" };
	}

	// 3. 개선폭 미달 (최근 2회 비교)
	if (results.length >= 2) {
		const previousScore = results[results.length - 2].overall_score;
		const improvement = latestScore - previousScore;
		if (improvement < control.min_improvement_per_cycle) {
			return { should_stop: true, reason: "no_more_improvements" };
		}
	}

	return { should_stop: false };
}

// ── Template Registry ───────────────────────────────────────

export interface EvaluationTemplate {
	site_type: SiteType;
	version: string;
	label: string;
	scoring_dimensions: ScoringDimension[];
	probe_count: number;
	template_path: string;
}

export const TEMPLATE_REGISTRY: EvaluationTemplate[] = [
	{
		site_type: "manufacturer",
		version: "1.0",
		label: "제조사 대표 Site",
		scoring_dimensions: DEFAULT_SCORING_DIMENSIONS.manufacturer,
		probe_count: 8,
		template_path: "evaluation-templates/manufacturer.md",
	},
	{
		site_type: "research",
		version: "1.0",
		label: "연구소 대표 Site",
		scoring_dimensions: DEFAULT_SCORING_DIMENSIONS.research,
		probe_count: 8,
		template_path: "evaluation-templates/research.md",
	},
	{
		site_type: "generic",
		version: "1.0",
		label: "기타",
		scoring_dimensions: DEFAULT_SCORING_DIMENSIONS.generic,
		probe_count: 8,
		template_path: "evaluation-templates/generic.md",
	},
];

export function getTemplate(siteType: SiteType): EvaluationTemplate {
	const template = TEMPLATE_REGISTRY.find((t) => t.site_type === siteType);
	if (!template) {
		throw new Error(`Unknown site type: ${siteType}`);
	}
	return template;
}
