/**
 * Common Tabs — 모든 사이트 유형에서 공통으로 사용되는 탭 정의
 */
import type { TabSpec } from "./viz-spec-schema.js";

export const COMMON_TABS: TabSpec[] = [
	{
		id: "overview",
		title: "종합 개요",
		icon: "📊",
		required_elements: [
			{
				type: "score_gauge",
				data_source: "overall_score",
				description: "종합 GEO 점수 게이지 (0-100, 등급 표시)",
			},
			{
				type: "dimension_bars",
				data_source: "dimension_scores",
				count: 7,
				description: "S1~S7 차원별 진행바",
			},
			{
				type: "llm_accessibility_chart",
				data_source: "derived",
				derivation: [
					"각 LLM 서비스(ChatGPT, Gemini, Claude, Perplexity, Meta AI, Copilot)에 대해:",
					"base = robots.txt에서 해당 봇 허용 상태 (명시허용=80, 부분허용=60, 미명시=50, 차단=10)",
					"modifier = (제품/콘텐츠 페이지 스키마 품질 평균 × 0.3) + (정적 HTML 비율 × 0.2)",
					"score = min(base + modifier, 100)",
				].join("\n"),
				description: "LLM 서비스별 정보 접근 가능성 추정 막대그래프",
			},
			{
				type: "strength_weakness_opportunity",
				data_source: "analysis_report",
				card_count: "3_per_category",
				description: "강점/약점/기회 카드 (각 3개)",
			},
		],
	},
	{
		id: "crawlability",
		title: "크롤링 접근성",
		icon: "🤖",
		required_elements: [
			{
				type: "bot_policy_table",
				columns: ["bot_name", "service", "allow_status", "notes"],
				description: "AI 봇별 허용/차단 테이블",
				items: [
					"GPTBot",
					"OAI-SearchBot",
					"ChatGPT-User",
					"PerplexityBot",
					"Google-Extended",
					"ClaudeBot",
					"Applebot",
					"Meta-ExternalAgent",
				],
			},
			{
				type: "blocked_paths_list",
				description: "AI 봇에 차단된 주요 경로 목록",
			},
			{
				type: "llms_txt_status_cards",
				description: "llms.txt 현황 카드 (존재/부재 + 업계 비교)",
			},
		],
	},
	{
		id: "structure",
		title: "구조화 데이터",
		icon: "🏗️",
		required_elements: [
			{
				type: "schema_doughnut_chart",
				description: "스키마 타입별 구현 비율 도넛 차트",
			},
			{
				type: "page_type_quality_bars",
				derivation: [
					"각 페이지에 대해:",
					"score = (JSON-LD 존재 ×20) + (Product ×20) + (Offer ×15)",
					"      + (AggregateRating ×15) + (additionalProperty ×15)",
					"      + (BreadcrumbList ×5) + (FAQPage ×5) + (dateModified ×5)",
				].join("\n"),
				description: "페이지 유형별 구조화 데이터 품질 진행바",
			},
			{
				type: "schema_detail_table",
				columns: ["schema_type", "applied_pages", "quality", "llm_usage", "issues"],
				description: "스키마 타입 상세 분석 테이블",
			},
		],
	},
	{
		id: "pages",
		title: "페이지별 분석",
		icon: "🔍",
		required_elements: [
			{
				type: "page_score_list",
				derivation: [
					"각 크롤링된 URL에 대해 개별 GEO 점수 산출:",
					"page_score = (JSON-LD 품질 ×30) + (정적HTML 정보량 ×25)",
					"           + (메타태그 ×10) + (시맨틱HTML ×10)",
					"           + (내부링크 ×10) + (이미지alt ×5)",
					"           + (dateModified ×5) + (BreadcrumbList ×5)",
				].join("\n"),
				tags_rule: "80+인 항목→tag-good, 40~79→tag-neutral, 39-→tag-bad",
				description: "URL별 점수 + 태그(good/bad/neutral)",
			},
		],
	},
	{
		id: "recommendations",
		title: "개선 권고사항",
		icon: "🎯",
		required_elements: [
			{
				type: "improvement_matrix_table",
				description: "우선순위별 GEO 개선 권고사항 (HIGH/MEDIUM/LOW)",
				derivation: [
					"Phase 6 Improvement Matrix 결과를 우선순위별로 분류:",
					"HIGH: impact_score ≥ 4 → 즉시 실행 (빨간색 좌측 경계)",
					"MEDIUM: impact_score 2~3 → 1-3개월 (노란색 좌측 경계)",
					"LOW: impact_score 1 → 3-6개월 (녹색 좌측 경계)",
					"각 항목: 제목, 설명, 예상 노력, 기대 효과",
				].join("\n"),
			},
		],
	},
	{
		id: "evidence",
		title: "실증 데이터",
		icon: "🔬",
		required_elements: [
			{
				type: "evidence_section",
				description:
					"Phase 1-3 수집 원문 코드 스니펫. 최소 포함 섹션은 reference spec에서 정의.",
			},
		],
	},
	{
		id: "probes",
		title: "Synthetic Probe 결과",
		icon: "🧪",
		required_elements: [
			{
				type: "probe_summary_table",
				description: "8개 프롬프트 PASS/PARTIAL/FAIL 종합 테이블 + 통계",
			},
			{
				type: "probe_detail_cards",
				description: "개별 프로브 상세 (입력URL, 요청데이터, 실제응답, 태그)",
			},
			{
				type: "claim_validation_mapping",
				columns: ["report_claim", "validating_probe", "evidence", "status"],
				derivation: [
					"보고서의 핵심 클레임 목록을 작성하고,",
					"각 클레임을 뒷받침하는 Probe 결과를 매핑.",
					"모든 핵심 클레임이 Probe로 실증되어야 한다.",
				].join("\n"),
				description: "보고서 클레임 → Probe 검증 매핑 테이블",
			},
		],
	},
	{
		id: "roadmap",
		title: "개선 로드맵",
		icon: "🗺️",
		required_elements: [
			{
				type: "improvement_matrix_table",
				prefix_rule: "T-=탐색형, C-=비교형, X-=공통",
				description: "GEO 개선 기회 전체 매트릭스",
			},
			{
				type: "impact_difficulty_bubble_chart",
				description: "임팩트×난이도 버블차트",
			},
			{
				type: "sprint_roadmap",
				sprints: ["immediate", "1month", "quarter"],
				description: "Sprint별 구현 로드맵",
			},
			{
				type: "score_simulation_chart",
				lines: ["overall"],
				description: "점수 시뮬레이션 라인차트 (reference spec에서 추가 선 정의 가능)",
			},
		],
	},
];
