/**
 * Reference Spec: Manufacturer / Electronics
 *
 * samsung.com GEO 대시보드(samsung_geo_dashboard.html)에서 추출한
 * 구체적 시각화 요구사항. 동일 유형 사이트(LG, Sony, Xiaomi 등)에
 * 동일 수준의 대시보드 품질을 보장하기 위한 필요 조건.
 */
import type { EvidenceSection, ReferenceSpec } from "../viz-spec-schema.js";

export const MANUFACTURER_ELECTRONICS_EVIDENCE: EvidenceSection[] = [
	{
		id: "llms_txt_http",
		title: "llms.txt HTTP 응답 증거",
		description: "llms.txt fetch 결과 (HTTP 상태코드, 내용 또는 404 기록)",
	},
	{
		id: "robots_txt_ai",
		title: "robots.txt AI 봇 섹션 원문",
		description: "robots.txt에서 AI 봇 관련 User-agent 및 Disallow 규칙 원문 발췌",
	},
	{
		id: "schema_comparison",
		title: "제품군별 JSON-LD 스키마 구현 격차",
		description: "미구현 페이지 vs 구현 페이지의 실제 JSON-LD 코드 비교",
	},
	{
		id: "nonstandard_objects",
		title: "비표준 추적 객체 vs 표준 스키마",
		description: "digitalData/dataLayer 등 커스텀 객체와 Schema.org Product 스키마의 대비",
	},
	{
		id: "js_dependency",
		title: "JavaScript 의존성 — LLM 크롤러 vs 브라우저",
		description: "데이터 항목별 (스펙, 가격, 색상 등) 정적HTML 포함 여부 + LLM 접근 가능성 테이블",
	},
	{
		id: "claim_verifiability",
		title: "마케팅 클레임 검증성 분석",
		description: "실제 마케팅 문구 × 출처 명시 여부 × LLM 신뢰도 × 팩트체크 위험 테이블",
	},
	{
		id: "schema_coverage_table",
		title: "제품군별 Schema 구현 현황 종합 테이블",
		description:
			"제품군 × 스키마 타입 매트릭스 (ItemList, Product, Offer, AggregateRating, 스펙, Breadcrumb, FAQ)",
	},
];

export const MANUFACTURER_ELECTRONICS_REF: ReferenceSpec = {
	reference_id: "samsung-geo-2026-03-17",
	site_type: "manufacturer",
	subtype: "electronics",
	source_dashboard: "samsung_geo_dashboard.html",

	product_categories_minimum: 3,

	product_recognition_items: {
		smartphone: [
			"제품명/모델코드",
			"시작가격",
			"카메라 스펙 (화소수, 줌, 조리개)",
			"디스플레이 스펙 (크기, 해상도, 주사율)",
			"배터리 (용량, 충전속도)",
			"프로세서",
			"색상/저장용량 옵션",
			"마케팅 키 메시지",
		],
		tv: [
			"모델명/시리즈",
			"화면 크기",
			"패널 기술 (OLED/QLED/Neo QLED)",
			"해상도",
			"가격 (현재가 + 정가)",
			"평점/리뷰수",
		],
		appliance: ["모델명", "용량 (cu.ft. 등)", "치수", "AI 기능", "가격", "평점/리뷰수"],
		laptop: ["모델명", "프로세서", "RAM/저장용량", "디스플레이 크기/해상도", "배터리 수명", "가격"],
		tablet: [
			"모델명",
			"디스플레이 크기/해상도",
			"프로세서",
			"S Pen 지원 여부",
			"가격",
			"색상 옵션",
		],
		wearable: [
			"모델명",
			"디스플레이 크기/타입",
			"배터리 수명",
			"건강 센서 목록",
			"가격",
			"호환 기기",
		],
	},

	probe_customization: {
		"P-01": "카메라/핵심센서 스펙 (전자제품 주력 제품의 핵심 입력장치)",
		"P-02": "디스플레이/핵심출력 스펙 (화면 크기, 해상도, 주사율)",
		"P-03": "가격 + 옵션별 가격 (저장용량, 색상별)",
		"P-04": "카탈로그 기반 예산 내 추천 (해당 제품군 중간 가격대)",
		"P-05": "가전/비주력 제품군 주요 스펙 3가지 (용량, 크기, 핵심 기능)",
		"P-06": "같은 브랜드 내 모델 비교 (주력 vs 차상위 모델)",
		"P-07": "카테고리 기술 종류 설명 + 모델 및 가격",
		"P-08": "마케팅 클레임 근거 확인 (최소 3개 클레임 식별)",
	},

	competitor_estimation: {
		enabled: true,
		max_competitors: 3,
		comparison_items: [
			"llms_txt",
			"robots_ai_explicit",
			"product_schema_coverage",
			"smartphone_spec_structuring",
			"faq_schema",
			"aggregate_rating",
			"static_html_specs",
			"brand_consistency",
		],
	},

	evidence_sections: MANUFACTURER_ELECTRONICS_EVIDENCE,

	quality_bar: {
		min_tabs: 10,
		min_probe_detail: true,
		claim_validation_mapping: true,
		score_simulation_lines: 3,
		min_evidence_sections: 7,
	},
};
