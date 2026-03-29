/**
 * Runtime Prompts Registry
 *
 * 실제 에이전트 파이프라인에서 LLM으로 전달되는 시스템 지시(system_instruction)를
 * 수집하여 Dashboard Prompts 탭에 정확하게 표시하기 위한 레지스트리.
 *
 * ⚠️  이 파일의 내용은 각 에이전트 파일에서 export한 상수를 import한 것으로,
 *     실제 런타임 동작과 항상 일치한다.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_QUALITY_SYSTEM, READABILITY_SYSTEM } from "../agents/analysis/analysis-agent.js";
import {
	OPT_CONTENT_DENSITY_SYSTEM,
	OPT_FAQ_SYSTEM,
	OPT_LLMS_TXT_SYSTEM,
	OPT_META_DESCRIPTION_SYSTEM,
	OPT_OG_TAGS_SYSTEM,
	OPT_SCHEMA_MARKUP_SYSTEM,
	OPT_SEMANTIC_HEADING_SYSTEM,
} from "../agents/optimization/optimization-agent.js";
import { STRATEGY_PROMPT_TEMPLATE, STRATEGY_SYSTEM } from "../agents/strategy/strategy-agent.js";
import { VALIDATION_SYSTEM } from "../agents/validation/validation-agent.js";

// Re-export: 테스트에서 런타임 상수를 직접 검증할 수 있도록
export {
	CONTENT_QUALITY_SYSTEM,
	OPT_CONTENT_DENSITY_SYSTEM,
	OPT_FAQ_SYSTEM,
	OPT_LLMS_TXT_SYSTEM,
	OPT_META_DESCRIPTION_SYSTEM,
	OPT_OG_TAGS_SYSTEM,
	OPT_SCHEMA_MARKUP_SYSTEM,
	OPT_SEMANTIC_HEADING_SYSTEM,
	READABILITY_SYSTEM,
	STRATEGY_PROMPT_TEMPLATE,
	STRATEGY_SYSTEM,
	VALIDATION_SYSTEM,
};
import { loadBuiltinSkill } from "../skills/skill-loader.js";

// ── RuntimePrompt 타입 ──────────────────────────────────────

export interface RuntimeSubPrompt {
	label: string;
	task_type?: string;
	system_instruction: string;
}

export interface RuntimePrompt {
	/** 고유 ID (대시보드 표시용) */
	id: string;
	/** 한국어 표시 이름 */
	display_name: string;
	/** 이 프롬프트가 하는 일 요약 */
	description: string;
	/**
	 * 프롬프트 출처
	 * - "skill_md": .skill.md 파일에서 로드 (전체 마크다운)
	 * - "inline": 에이전트 .ts 파일에 인라인 상수로 정의
	 */
	source: "skill_md" | "inline";
	/** 소스 파일 경로 (packages/core/src/ 기준 상대경로) */
	source_file: string;
	/** 메인 시스템 지시 텍스트 */
	system_instruction: string;
	/** 서브 프롬프트 (Optimization처럼 태스크별로 여러 개인 경우) */
	sub_prompts?: RuntimeSubPrompt[];
	/** 항상 true — 대시보드에서 읽기 전용으로 표시 */
	readonly: true;
}

// ── 레지스트리 로드 ─────────────────────────────────────────

/**
 * 실제 파이프라인에서 사용 중인 모든 LLM 시스템 지시를 반환한다.
 * Dashboard `/api/settings/agents/prompts` 에서 호출.
 */
export function loadRuntimePrompts(): RuntimePrompt[] {
	// geo-analysis.skill.md 로드 (llm-analysis-agent에서 실제 사용)
	let geoAnalysisPrompt = "(skill.md 파일을 읽을 수 없습니다)";
	try {
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const skillsDir = path.join(__dirname, "../skills");
		const skill = loadBuiltinSkill("geo-analysis");
		geoAnalysisPrompt = skill.systemPrompt;
		void skillsDir; // suppress unused var
	} catch {
		// 빌드 환경에서 파일 없을 경우 fallback 메시지 유지
	}

	return [
		// ── 1. LLM Analysis (geo-analysis.skill.md) ────────────
		{
			id: "llm-analysis",
			display_name: "LLM Analysis Agent (종합 GEO 분석)",
			description:
				"llm-analysis-agent.ts가 piAiAgentLoop로 실행하는 메인 프롬프트. geo-analysis.skill.md에서 로드.",
			source: "skill_md",
			source_file: "skills/geo-analysis.skill.md",
			system_instruction: geoAnalysisPrompt,
			readonly: true,
		},

		// ── 2. Analysis Agent (정적 분석 LLM 호출 2종) ──────────
		{
			id: "analysis-static",
			display_name: "Analysis Agent (정적 분석 LLM 호출)",
			description:
				"analysis-agent.ts의 computeContentAnalysis()와 runAnalysis()에서 LLM을 호출하는 시스템 지시 2종.",
			source: "inline",
			source_file: "agents/analysis/analysis-agent.ts",
			system_instruction: READABILITY_SYSTEM,
			sub_prompts: [
				{
					label: "가독성 분류 (computeContentAnalysis)",
					system_instruction: READABILITY_SYSTEM,
				},
				{
					label: "콘텐츠 품질 평가 (runAnalysis — LLM 품질 평가)",
					system_instruction: CONTENT_QUALITY_SYSTEM,
				},
			],
			readonly: true,
		},

		// ── 3. Strategy Agent ────────────────────────────────────
		{
			id: "strategy",
			display_name: "Strategy Agent (최적화 전략 수립)",
			description:
				"strategy-agent.ts의 runStrategy()에서 LLM으로 최적화 전략 JSON을 생성할 때 사용하는 시스템 지시.",
			source: "inline",
			source_file: "agents/strategy/strategy-agent.ts",
			system_instruction: STRATEGY_SYSTEM,
			sub_prompts: [
				{
					label: "전략 시스템 지시 (system_instruction)",
					system_instruction: STRATEGY_SYSTEM,
				},
				{
					label: "전략 프롬프트 템플릿 (prompt — {{변수}} 치환 전 형태)",
					system_instruction: STRATEGY_PROMPT_TEMPLATE,
				},
			],
			readonly: true,
		},

		// ── 4. Optimization Agent (태스크 유형별 7종) ────────────
		{
			id: "optimization",
			display_name: "Optimization Agent (태스크별 LLM 호출)",
			description:
				"optimization-agent.ts의 각 optimizeXxx() 함수에서 태스크 유형별로 LLM을 호출하는 시스템 지시 7종.",
			source: "inline",
			source_file: "agents/optimization/optimization-agent.ts",
			system_instruction: OPT_META_DESCRIPTION_SYSTEM,
			sub_prompts: [
				{
					label: "METADATA — 메타 디스크립션 생성",
					task_type: "METADATA",
					system_instruction: OPT_META_DESCRIPTION_SYSTEM,
				},
				{
					label: "METADATA — OG 태그 생성",
					task_type: "METADATA",
					system_instruction: OPT_OG_TAGS_SYSTEM,
				},
				{
					label: "SCHEMA_MARKUP — JSON-LD 구조화 데이터 생성",
					task_type: "SCHEMA_MARKUP",
					system_instruction: OPT_SCHEMA_MARKUP_SYSTEM,
				},
				{
					label: "LLMS_TXT — llms.txt 파일 생성",
					task_type: "LLMS_TXT",
					system_instruction: OPT_LLMS_TXT_SYSTEM,
				},
				{
					label: "SEMANTIC_STRUCTURE — H1 헤딩 생성",
					task_type: "SEMANTIC_STRUCTURE",
					system_instruction: OPT_SEMANTIC_HEADING_SYSTEM,
				},
				{
					label: "CONTENT_DENSITY — 콘텐츠 보강",
					task_type: "CONTENT_DENSITY",
					system_instruction: OPT_CONTENT_DENSITY_SYSTEM,
				},
				{
					label: "FAQ_ADDITION — FAQ 항목 생성",
					task_type: "FAQ_ADDITION",
					system_instruction: OPT_FAQ_SYSTEM,
				},
			],
			readonly: true,
		},

		// ── 5. Validation Agent ──────────────────────────────────
		{
			id: "validation",
			display_name: "Validation Agent (최적화 검증)",
			description:
				"validation-agent.ts의 runValidation()에서 최적화 품질을 LLM이 평가할 때 사용하는 시스템 지시.",
			source: "inline",
			source_file: "agents/validation/validation-agent.ts",
			system_instruction: VALIDATION_SYSTEM,
			readonly: true,
		},
	];
}
