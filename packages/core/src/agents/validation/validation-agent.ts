import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import { parseJsonResponse, safeLLMCall, truncateHtml } from "../shared/llm-helpers.js";
import { type ValidationVerdict, ValidationVerdictSchema } from "../shared/llm-response-schemas.js";
/**
 * Validation Agent
 *
 * 최적화 후 클론 파일을 재분석하여 점수 변화를 측정.
 * Before-After 비교 결과를 생성하고, 추가 사이클 필요 여부 결정.
 */
import type { CrawlData, PageScoreResult } from "../shared/types.js";

// ── Exported prompt constants (실제 런타임에 LLM으로 전달되는 시스템 지시) ──────

export const VALIDATION_SYSTEM =
	'You are a GEO validation expert. Assess optimization quality. Respond with JSON:\n{"improved_aspects":["string"],"remaining_issues":["string"],"llm_friendliness_verdict":"much_better|better|marginally_better|no_change|worse","specific_recommendations":["string"],"confidence":0.0-1.0}';

// ── Types ───────────────────────────────────────────────────

export interface ValidationInput {
	target_id: string;
	target_url: string;
	/** 최적화 전 점수 */
	before_score: number;
	before_grade: string;
	before_dimensions: Array<{
		id: string;
		label: string;
		score: number;
		weight: number;
		details: string[];
	}>;
	/** 목표 점수 (기본 80) */
	target_score?: number;
	/** 현재 사이클 번호 */
	cycle_number: number;
	/** 최대 사이클 수 */
	max_cycles?: number;
	/** 멀티 페이지 before 점수 (멀티 페이지 모드) */
	before_page_scores?: PageScoreResult[];
}

export interface ValidationOutput {
	after_score: number;
	after_grade: string;
	after_dimensions: Array<{
		id: string;
		label: string;
		score: number;
		weight: number;
		details: string[];
	}>;
	delta: number;
	improved: boolean;
	/** 추가 사이클 필요 여부 */
	needs_more_cycles: boolean;
	stop_reason: string | null;
	dimension_deltas: Array<{
		id: string;
		label: string;
		before: number;
		after: number;
		delta: number;
	}>;
	/** 멀티 페이지 after 점수 (멀티 페이지 모드) */
	after_page_scores?: PageScoreResult[];
	/** 페이지별 delta (멀티 페이지 모드) */
	page_deltas?: Array<{
		url: string;
		filename: string;
		before: number;
		after: number;
		delta: number;
	}>;
	/** LLM 품질 검증 결과 (chatLLM 없으면 null) */
	llm_verdict: ValidationVerdict | null;
}

// ── Validation Agent 실행 ────────────────────────────────────

export interface ValidationDeps {
	/** 클론 파일을 CrawlData로 변환 (로컬 파일 기반) */
	crawlClone: () => Promise<CrawlData>;
	/** GEO 점수 계산 */
	scoreTarget: (data: CrawlData) => {
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
	/** 멀티 페이지: 클론의 모든 페이지를 CrawlData로 반환 */
	crawlClonePages?: () => Promise<Array<{ filename: string; crawl_data: CrawlData }>>;
	/** LLM 기반 품질 검증 (필수 — ARCHITECTURE.md 9-A.1) */
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>;
}

export async function runValidation(
	input: ValidationInput,
	deps: ValidationDeps,
): Promise<ValidationOutput> {
	// 1. 클론 재크롤링 + 재채점 (홈페이지)
	const crawlData = await deps.crawlClone();
	const afterScores = deps.scoreTarget(crawlData);

	// 2. 멀티 페이지 재채점
	let afterPageScores: PageScoreResult[] | undefined;
	let pageDeltas: ValidationOutput["page_deltas"] | undefined;
	let effectiveAfterScore = afterScores.overall_score;

	if (deps.crawlClonePages && input.before_page_scores && input.before_page_scores.length > 0) {
		const clonePages = await deps.crawlClonePages();
		afterPageScores = clonePages.map((p) => {
			const scores = deps.scoreTarget(p.crawl_data);
			return { url: p.crawl_data.url, filename: p.filename, scores };
		});

		// 집계 점수: 홈 2x + 나머지 1x
		const homeScore: PageScoreResult = {
			url: input.target_url,
			filename: "index.html",
			scores: afterScores,
		};
		const allAfter = [homeScore, ...afterPageScores];
		const weights = [2, ...afterPageScores.map(() => 1)];
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		effectiveAfterScore =
			Math.round(
				(allAfter.reduce((s, p, i) => s + p.scores.overall_score * weights[i], 0) / totalWeight) *
					10,
			) / 10;

		// 페이지별 delta
		pageDeltas = afterPageScores.map((after) => {
			const before = input.before_page_scores!.find((b) => b.filename === after.filename);
			return {
				url: after.url,
				filename: after.filename,
				before: before?.scores.overall_score ?? 0,
				after: after.scores.overall_score,
				delta: after.scores.overall_score - (before?.scores.overall_score ?? 0),
			};
		});
	}

	// 3. Before-After 비교
	const delta = effectiveAfterScore - input.before_score;
	const improved = delta > 0;

	// 4. 차원별 비교
	const dimensionDeltas = afterScores.dimensions.map((after) => {
		const before = input.before_dimensions.find((d) => d.id === after.id);
		return {
			id: after.id,
			label: after.label,
			before: before?.score ?? 0,
			after: after.score,
			delta: after.score - (before?.score ?? 0),
		};
	});

	// 5. 추가 사이클 필요 여부 판정
	const targetScore = input.target_score ?? 80;
	const maxCycles = input.max_cycles ?? 10;

	let needsMoreCycles = true;
	let stopReason: string | null = null;

	if (effectiveAfterScore >= targetScore) {
		needsMoreCycles = false;
		stopReason = `score_sufficient: ${effectiveAfterScore} >= ${targetScore}`;
	} else if (delta < 2 && input.cycle_number > 0) {
		needsMoreCycles = false;
		stopReason = `no_more_improvements: delta=${delta.toFixed(1)} < 2`;
	} else if (input.cycle_number >= maxCycles - 1) {
		needsMoreCycles = false;
		stopReason = `max_cycles: ${input.cycle_number + 1} >= ${maxCycles}`;
	}

	// 6. LLM 품질 검증 (4-D: LLM required, no fallback)
	let llmVerdict: ValidationVerdict | null = null;
	const { result: verdictResult } = await safeLLMCall(
		deps.chatLLM,
		{
			prompt: `Compare the optimization results. Score changed from ${input.before_score} to ${effectiveAfterScore} (delta: ${delta}).\n\nDimension changes:\n${dimensionDeltas.map((d) => `${d.label}: ${d.before} → ${d.after} (${d.delta >= 0 ? "+" : ""}${d.delta})`).join("\n")}\n\nAssess the optimization quality. Respond in JSON format.`,
			system_instruction: VALIDATION_SYSTEM,
			json_mode: true,
			temperature: 0.1,
			max_tokens: 1500,
		},
		(content) => parseJsonResponse(content, ValidationVerdictSchema),
	);
	if (verdictResult) {
		llmVerdict = {
			improved_aspects: verdictResult.improved_aspects ?? [],
			remaining_issues: verdictResult.remaining_issues ?? [],
			llm_friendliness_verdict: verdictResult.llm_friendliness_verdict,
			specific_recommendations: verdictResult.specific_recommendations ?? [],
			confidence: verdictResult.confidence ?? 0.5,
		};
		// LLM verdict에 따른 사이클 제어 보정
		if (llmVerdict.confidence >= 0.7) {
			if (llmVerdict.llm_friendliness_verdict === "worse" && needsMoreCycles) {
				needsMoreCycles = false;
				stopReason = `llm_verdict_worse: LLM assessment says quality worsened (confidence: ${llmVerdict.confidence})`;
			} else if (
				llmVerdict.llm_friendliness_verdict === "no_change" &&
				needsMoreCycles &&
				input.cycle_number > 0
			) {
				needsMoreCycles = false;
				stopReason = `llm_verdict_no_change: LLM assessment says no improvement (confidence: ${llmVerdict.confidence})`;
			} else if (
				llmVerdict.remaining_issues.length === 0 &&
				effectiveAfterScore >= 70 &&
				needsMoreCycles
			) {
				needsMoreCycles = false;
				stopReason = `llm_verdict_sufficient: LLM found no remaining issues (score: ${effectiveAfterScore})`;
			}
		}
	}

	return {
		after_score: effectiveAfterScore,
		after_grade: afterScores.grade,
		after_dimensions: afterScores.dimensions,
		delta,
		improved,
		needs_more_cycles: needsMoreCycles,
		stop_reason: stopReason,
		dimension_deltas: dimensionDeltas,
		after_page_scores: afterPageScores,
		page_deltas: pageDeltas,
		llm_verdict: llmVerdict,
	};
}
