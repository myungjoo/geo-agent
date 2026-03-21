/**
 * Strategy Agent
 *
 * AnalysisReport 기반으로 OptimizationPlan을 생성.
 * - 규칙 기반 전략 (LLM 없이 동작)
 * - LLM 강화 전략 (API Key 있을 때)
 *
 * 점수가 낮은 차원 우선, 영향도/난이도 기반 태스크 정렬.
 */
import { v4 as uuidv4 } from "uuid";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import type { AnalysisReport } from "../../models/analysis-report.js";
import type { ChangeType } from "../../models/change-type.js";
import type { OptimizationPlan, OptimizationTask } from "../../models/optimization-plan.js";
import { safeLLMCall, parseJsonResponse } from "../shared/llm-helpers.js";
import { StrategyLLMResponseSchema } from "../shared/llm-response-schemas.js";

// ── Strategy Input/Output ───────────────────────────────────

export interface StrategyInput {
	target_id: string;
	analysis_report: AnalysisReport;
	/** 선택: LLM으로 전략 강화 */
	use_llm?: boolean;
}

export interface StrategyOutput {
	plan: OptimizationPlan;
	tasks_count: number;
	estimated_delta: number;
}

// ── Rule-based strategy rules ────────────────────────────────

interface StrategyRule {
	condition: (report: AnalysisReport) => boolean;
	generate: (
		report: AnalysisReport,
	) => Omit<OptimizationTask, "task_id" | "order" | "status" | "change_record_ref">;
}

const STRATEGY_RULES: StrategyRule[] = [
	// S1: robots.txt AI bot access
	{
		condition: (r) => {
			const access = r.machine_readability.crawler_access;
			return access.some((a) => a.blocked_by_robots_txt);
		},
		generate: () => ({
			change_type: "METADATA",
			title: "robots.txt에서 AI 봇 허용",
			description:
				"GPTBot, ClaudeBot 등 AI 크롤러가 콘텐츠에 접근할 수 있도록 robots.txt를 수정합니다.",
			target_element: "robots.txt",
			priority: "critical",
			info_recognition_ref: null,
		}),
	},
	// S2: JSON-LD 추가/개선
	{
		condition: (r) => !r.structured_data.json_ld_present,
		generate: () => ({
			change_type: "SCHEMA_MARKUP",
			title: "JSON-LD 구조화 데이터 추가",
			description:
				"Schema.org JSON-LD 마크업을 추가하여 LLM이 페이지 콘텐츠를 정확하게 이해할 수 있도록 합니다.",
			target_element: "head > script[type=application/ld+json]",
			priority: "critical",
			info_recognition_ref: null,
		}),
	},
	// S2: OG 태그 부재
	{
		condition: (r) => !r.structured_data.og_tags_present,
		generate: () => ({
			change_type: "METADATA",
			title: "Open Graph 메타태그 추가",
			description: "og:title, og:description, og:image 등 Open Graph 태그를 추가합니다.",
			target_element: "head > meta[property^=og:]",
			priority: "high",
			info_recognition_ref: null,
		}),
	},
	// S2: meta description 부재
	{
		condition: (r) => !r.structured_data.meta_description,
		generate: () => ({
			change_type: "METADATA",
			title: "Meta description 추가",
			description: "검색 엔진과 LLM이 참조할 수 있는 페이지 설명 메타태그를 추가합니다.",
			target_element: 'head > meta[name="description"]',
			priority: "high",
			info_recognition_ref: null,
		}),
	},
	// S3: 헤딩 구조 문제
	{
		condition: (r) => !r.machine_readability.structure_quality.heading_hierarchy_valid,
		generate: () => ({
			change_type: "SEMANTIC_STRUCTURE",
			title: "헤딩 계층 구조 수정",
			description: "H1 태그를 하나만 사용하고, H2~H6 계층을 논리적으로 구성합니다.",
			target_element: "h1, h2, h3",
			priority: "high",
			info_recognition_ref: null,
		}),
	},
	// S3: 시맨틱 태그 부족
	{
		condition: (r) => r.machine_readability.structure_quality.semantic_tag_ratio < 0.3,
		generate: () => ({
			change_type: "SEMANTIC_STRUCTURE",
			title: "시맨틱 HTML5 태그 도입",
			description: "div 중심 구조를 main, article, section, nav 등 시맨틱 태그로 변환합니다.",
			target_element: "body",
			priority: "medium",
			info_recognition_ref: null,
		}),
	},
	// S6: llms.txt 부재
	{
		condition: () => true, // 항상 검사 (llms.txt는 AnalysisReport에 직접 필드 없으므로 항상 제안)
		generate: () => ({
			change_type: "LLMS_TXT",
			title: "llms.txt 파일 생성",
			description: "AI 서비스가 사이트 정보를 빠르게 파악할 수 있도록 llms.txt 파일을 생성합니다.",
			target_element: "/llms.txt",
			priority: "medium",
			info_recognition_ref: null,
		}),
	},
	// S2: JSON-LD 불완전
	{
		condition: (r) =>
			r.structured_data.json_ld_present && r.structured_data.schema_completeness < 0.6,
		generate: () => ({
			change_type: "SCHEMA_MARKUP",
			title: "JSON-LD 스키마 보강",
			description: "기존 JSON-LD의 누락 필드를 채우고 추가 스키마 유형을 구현합니다.",
			target_element: "script[type=application/ld+json]",
			priority: "medium",
			info_recognition_ref: null,
		}),
	},
	// S3: 콘텐츠 부족
	{
		condition: (r) => r.content_analysis.word_count < 300,
		generate: () => ({
			change_type: "CONTENT_DENSITY",
			title: "콘텐츠 확충",
			description: "LLM이 충분한 컨텍스트를 얻을 수 있도록 핵심 콘텐츠를 보강합니다.",
			target_element: "main",
			priority: "medium",
			info_recognition_ref: null,
		}),
	},
];

// ── Strategy Agent 실행 ──────────────────────────────────────

export async function runStrategy(
	input: StrategyInput,
	deps?: {
		chatLLM?: (request: LLMRequest) => Promise<LLMResponse>;
	},
): Promise<StrategyOutput> {
	const { analysis_report } = input;

	// 1. 규칙 기반 태스크 생성
	const tasks: OptimizationTask[] = [];
	let order = 0;

	for (const rule of STRATEGY_RULES) {
		if (rule.condition(analysis_report)) {
			const taskBase = rule.generate(analysis_report);
			tasks.push({
				...taskBase,
				task_id: uuidv4(),
				order: order++,
				status: "pending",
				change_record_ref: null,
			});
		}
	}

	// 2. 우선순위 정렬 (critical → high → medium → low)
	const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
	tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
	tasks.forEach((t, i) => {
		t.order = i;
	});

	// 3. LLM 강화 (선택사항)
	let strategyRationale =
		`규칙 기반 분석으로 ${tasks.length}개 최적화 태스크를 생성했습니다. ` +
		`현재 GEO 점수: ${analysis_report.current_geo_score.total}/100. ` +
		`구조화 데이터 점수: ${analysis_report.current_geo_score.structured_score}/100.`;

	let llmEstimatedDelta: number | null = null;
	let llmConfidence: number | null = null;

	if (input.use_llm && deps?.chatLLM) {
		const geoScores = analysis_report.current_geo_score;
		const structuredData = analysis_report.structured_data;
		const contentAnalysis = analysis_report.content_analysis;
		const machineReadability = analysis_report.machine_readability;

		const prompt = `You are a GEO (Generative Engine Optimization) strategist. Analyze the following website assessment and generate a complete optimization strategy with prioritized tasks.

## Current GEO Scores
- Total: ${geoScores.total}/100
- Citation Rate: ${geoScores.citation_rate}/100
- Citation Accuracy: ${geoScores.citation_accuracy}/100
- Info Recognition: ${geoScores.info_recognition_score}/100
- Coverage: ${geoScores.coverage}/100
- Rank Position: ${geoScores.rank_position}/100
- Structured Score: ${geoScores.structured_score}/100

## Structured Data Status
- JSON-LD present: ${structuredData.json_ld_present}
- Schema completeness: ${structuredData.schema_completeness}
- OG tags present: ${structuredData.og_tags_present}
- Meta description: ${structuredData.meta_description ? "present" : "missing"}

## Content Analysis
- Word count: ${contentAnalysis.word_count}
- Readability level: ${contentAnalysis.readability_level}

## Machine Readability
- Grade: ${machineReadability.grade}
- Heading hierarchy valid: ${machineReadability.structure_quality.heading_hierarchy_valid}
- Semantic tag ratio: ${machineReadability.structure_quality.semantic_tag_ratio}

## Existing Rule-Based Tasks
${tasks.map((t) => `- [${t.priority}] ${t.title}: ${t.description}`).join("\n")}

Generate a complete strategy as JSON. Include tasks that address the most impactful improvements. Use change_type values from: METADATA, SCHEMA_MARKUP, LLMS_TXT, SEMANTIC_STRUCTURE, CONTENT_DENSITY, FAQ_SECTION, INTERNAL_LINKING, IMAGE_ALT, CANONICAL, SITEMAP.`;

		const { result: llmStrategy } = await safeLLMCall(
			deps.chatLLM,
			{
				prompt,
				system_instruction:
					'You are a GEO optimization expert. Respond with JSON only:\n{"strategy_rationale":"detailed explanation","tasks":[{"change_type":"SCHEMA_MARKUP","title":"...","description":"specific instructions","target_element":null,"priority":"critical","expected_impact":"...","specific_data":{}}],"estimated_delta":15,"confidence":0.7}',
				json_mode: true,
				temperature: 0.2,
				max_tokens: 3000,
			},
			(content) => parseJsonResponse(content, StrategyLLMResponseSchema),
		);

		if (llmStrategy) {
			strategyRationale = llmStrategy.strategy_rationale;
			llmEstimatedDelta = llmStrategy.estimated_delta ?? 0;
			llmConfidence = llmStrategy.confidence ?? 0.5;

			// Merge LLM tasks with rule-based tasks (LLM tasks take precedence, deduplicate by change_type)
			const llmTasks: OptimizationTask[] = llmStrategy.tasks.map((lt) => ({
				task_id: uuidv4(),
				change_type: lt.change_type as ChangeType,
				title: lt.title,
				description: lt.description,
				target_element: lt.target_element ?? null,
				priority: lt.priority,
				info_recognition_ref: null,
				order: 0,
				status: "pending" as const,
				change_record_ref: null,
			}));

			// LLM tasks take precedence: remove rule-based tasks that share a change_type with LLM tasks
			const llmChangeTypes = new Set(llmTasks.map((t) => t.change_type));
			const filteredRuleTasks = tasks.filter((t) => !llmChangeTypes.has(t.change_type));

			// Combine: LLM tasks first, then remaining rule-based tasks
			tasks.length = 0;
			tasks.push(...llmTasks, ...filteredRuleTasks);

			// Re-sort by priority and re-index
			tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
			tasks.forEach((t, i) => {
				t.order = i;
			});
		}
	}

	// 4. 영향도 추정
	const criticalCount = tasks.filter((t) => t.priority === "critical").length;
	const highCount = tasks.filter((t) => t.priority === "high").length;
	const ruleBasedDelta =
		criticalCount * 8 + highCount * 5 + (tasks.length - criticalCount - highCount) * 2;
	const estimatedDelta = llmEstimatedDelta ?? ruleBasedDelta;
	const confidence = llmConfidence ?? Math.min(0.3 + tasks.length * 0.05, 0.8);

	const plan: OptimizationPlan = {
		plan_id: uuidv4(),
		target_id: input.target_id,
		created_at: new Date().toISOString(),
		analysis_report_ref: analysis_report.report_id,
		strategy_rationale: strategyRationale,
		memory_context: {
			effectiveness_data: [],
			similar_cases: [],
			negative_patterns: [],
		},
		tasks,
		estimated_impact: {
			expected_delta: estimatedDelta,
			confidence: Math.round(confidence * 100) / 100,
			rationale: `${criticalCount} critical + ${highCount} high priority tasks → 예상 ${estimatedDelta}점 상승`,
		},
		status: "draft",
	};

	return {
		plan,
		tasks_count: tasks.length,
		estimated_delta: estimatedDelta,
	};
}

/** Exported for testing */
export const _rules = STRATEGY_RULES;
