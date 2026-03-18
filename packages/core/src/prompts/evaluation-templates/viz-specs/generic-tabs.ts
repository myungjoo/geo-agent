/**
 * Generic Site Type — 추가 탭 및 기존 탭 확장 요소 정의
 *
 * 일반 사이트 (뉴스, SaaS, 교육 등) 특화: 콘텐츠 접근성, 조직 신뢰도
 */
import type { TabSpec, VizElement } from "./viz-spec-schema.js";

export const GENERIC_EXTRA_TABS: TabSpec[] = [
	{
		id: "content",
		title: "콘텐츠 접근성",
		icon: "📝",
		site_types: ["generic"],
		required_elements: [
			{
				type: "category_score_cards",
				derivation: [
					"콘텐츠 유형별 LLM 인식도:",
					"- 기사/블로그: Article 스키마 + datePublished + author",
					"- 서비스/제품: SoftwareApplication 또는 Service 스키마",
					"- FAQ/지원: FAQPage 스키마 + HowTo",
					"score = (Schema 존재 ×25) + (정적 HTML 정보량 ×25)",
					"      + (메타태그 ×20) + (시맨틱 구조 ×15) + (날짜 정보 ×15)",
				].join("\n"),
				description: "콘텐츠 유형별 LLM 인식도 점수 카드",
			},
			{
				type: "product_recognition_bars",
				description: "대표 페이지에서 LLM이 파악 가능한 정보 항목별 진행바",
				derivation: [
					"일반 사이트 필수 인식 항목:",
					"[페이지제목, 작성자/조직, 발행일, 핵심내용요약,",
					" 카테고리, 관련링크, FAQ응답]",
				].join("\n"),
			},
		],
	},
	{
		id: "trust",
		title: "조직 신뢰도",
		icon: "🏢",
		site_types: ["generic"],
		required_elements: [
			{
				type: "brand_sub_dimensions",
				derivation: [
					"조직 신뢰도 하위 차원:",
					"- 조직 Entity 연결: (Organization 스키마 + sameAs + Wikidata)",
					"- 콘텐츠 신선도: (dateModified 비율 + 최신 콘텐츠 비율)",
					"- 저자 권위: (Person 스키마 + 소셜 프로필 링크)",
					"- 팩트 검증성: (인용 출처 비율)",
					"- 서비스 구조화: (Service/SoftwareApplication 스키마)",
				].join("\n"),
				description: "조직 신뢰도 하위 차원별 점수",
			},
		],
	},
];

export const GENERIC_TAB_EXTENSIONS: Record<string, VizElement[]> = {
	roadmap: [
		{
			type: "consumer_scenario_cards",
			scenarios: ["information_seeking", "service_evaluation"],
			description: "정보탐색형/서비스평가형 사용자 시나리오",
			derivation: [
				"정보탐색형: 사용자가 특정 주제 정보를 LLM으로 검색",
				"서비스평가형: 사용자가 서비스/제품을 LLM으로 비교 평가",
			].join("\n"),
		},
	],
};

export const GENERIC_SIMULATION_LINES = [
	"overall",
	"information_seeker",
	"service_evaluator",
];
