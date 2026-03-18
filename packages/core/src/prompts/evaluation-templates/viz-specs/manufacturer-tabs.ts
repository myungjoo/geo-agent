/**
 * Manufacturer Site Type — 추가 탭 및 기존 탭 확장 요소 정의
 *
 * 제조사 사이트 특화: 제품 정보 인식, 브랜드 메시지, 소비자 시나리오
 */
import type { TabSpec, VizElement } from "./viz-spec-schema.js";

/**
 * 제조사 사이트에만 추가되는 탭
 */
export const MANUFACTURER_EXTRA_TABS: TabSpec[] = [
	{
		id: "products",
		title: "제품 정보 인식",
		icon: "📦",
		site_types: ["manufacturer"],
		required_elements: [
			{
				type: "category_score_cards",
				derivation: [
					"각 제품군(PRODUCT_CATEGORIES)에 대해:",
					"score = (ItemList존재 ×10) + (Product Schema ×20) + (Offer ×20)",
					"      + (AggregateRating ×15) + (additionalProperty ×20)",
					"      + (정적HTML스펙비율 ×15)",
				].join("\n"),
				description: "제품군별 LLM 인식도 점수 카드",
			},
			{
				type: "extracted_data_table",
				condition: "category.catalog_schema에 Product+Offer가 있는 경우",
				max_rows: 12,
				description:
					"구조화 데이터가 우수한 카탈로그 페이지에서 실제 추출된 제품 데이터 테이블",
			},
			{
				type: "product_recognition_bars",
				description: "대표 제품(PDP)에서 LLM이 파악 가능한 데이터 항목별 진행바",
				derivation: [
					"각 항목별 파악 가능성:",
					"정적HTML + Schema = 100% (파악 가능 ✅)",
					"정적HTML 텍스트만 = 60% (부분 파악 ⚠️)",
					"JS 렌더링 후에만 = 10% (파악 불가 ❌)",
					"데이터 없음 = 0% (없음 ❌)",
					"items는 reference spec의 product_recognition_items에서 결정",
				].join("\n"),
			},
			{
				type: "product_radar_chart",
				axes: ["제품명인식", "가격파악", "스펙구조화", "평점데이터", "옵션정보", "기능설명"],
				datasets_per: "category",
				description: "제품군별 인식 레이더 차트",
			},
		],
	},
	{
		id: "brand",
		title: "브랜드 메시지",
		icon: "💬",
		site_types: ["manufacturer"],
		required_elements: [
			{
				type: "brand_sub_dimensions",
				derivation: [
					"S-5 브랜드 메시지를 하위 차원으로 분해. 제조사 기본 차원:",
					"- 혁신/선도 이미지: (혁신 키워드 밀도 × 메시지 일관성)",
					"- AI/기술 리더십: (AI 관련 구조화 콘텐츠 비율)",
					"- 프리미엄 포지셔닝: (가격대 + 프리미엄 키워드)",
					"- 지속가능성/ESG: (ESG 관련 구조화 데이터 존재)",
					"- 사실 기반 검증성: (출처 링크 있는 클레임 / 전체 클레임)",
					"- 경쟁 우위 근거: (Certification + 수상 구조화 비율)",
				].join("\n"),
				description: "브랜드 메시지 하위 차원별 점수 진행바",
			},
			{
				type: "claim_verification_table",
				columns: ["message", "location", "sentiment", "verifiability"],
				description: "마케팅 클레임 × 검증가능성 테이블",
			},
			{
				type: "llm_response_pattern_cards",
				categories: ["positive_answerable", "partial_answerable", "unanswerable"],
				description: "LLM이 잘/부분/못 답할 질문 예시 3열 카드",
				derivation: [
					"수집된 데이터 기반으로 생성:",
					"positive: 구조화 데이터가 완전한 영역의 질문 예시",
					"partial: 일부 데이터만 있는 영역의 질문 예시",
					"unanswerable: 데이터 접근 불가 영역의 질문 예시",
				].join("\n"),
			},
		],
	},
];

/**
 * 제조사 사이트에서 기존 공통 탭에 추가되는 요소
 */
export const MANUFACTURER_TAB_EXTENSIONS: Record<string, VizElement[]> = {
	overview: [
		// 종합 개요 탭에 제품군별 인식도 요약 카드 추가
	],
	roadmap: [
		{
			type: "consumer_scenario_cards",
			scenarios: ["exploratory", "comparative"],
			description: "탐색형/비교형 소비자 시나리오 카드",
			derivation: [
				"탐색형: 해당 브랜드 제품에 대해 상세 정보를 LLM에 질의",
				"비교형: 해당 브랜드와 경쟁사 비교 시 해당 브랜드 측 데이터 정확도",
				"비교형 프레임: 경쟁사 이름을 사이트에 추가하는 것은 권고하지 않음.",
				"목표는 자신의 데이터를 완전·정확하게 구조화하는 것.",
			].join("\n"),
		},
		{
			type: "vulnerability_score_cards",
			description: "분석 중 발견된 추가 취약 영역 점수 카드",
			derivation: [
				"Phase 1~3 분석에서 발견된 추가 취약점을 0~100 점수로 표시.",
				"예: 비교 페이지 데이터 가용성, 수상·인증 구조화,",
				"리뷰 데이터 구조화, 이미지 Alt Text, Wikipedia sameAs,",
				"콘텐츠 신선도 신호 등",
			].join("\n"),
		},
	],
};

/**
 * 제조사 사이트에서 score_simulation_chart에 추가되는 라인
 */
export const MANUFACTURER_SIMULATION_LINES = [
	"overall",
	"exploratory_consumer",
	"comparative_consumer",
];
