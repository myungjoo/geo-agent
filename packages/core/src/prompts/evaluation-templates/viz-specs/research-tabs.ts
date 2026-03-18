/**
 * Research Site Type — 추가 탭 및 기존 탭 확장 요소 정의
 *
 * 연구소/학술 사이트 특화: 논문 인식, Citation 추적, 데이터셋 접근성
 */
import type { TabSpec, VizElement } from "./viz-spec-schema.js";

export const RESEARCH_EXTRA_TABS: TabSpec[] = [
	{
		id: "publications",
		title: "논문/출판물 인식",
		icon: "📄",
		site_types: ["research"],
		required_elements: [
			{
				type: "category_score_cards",
				derivation: [
					"콘텐츠 유형별 LLM 인식도:",
					"- 논문/프리프린트: ScholarlyArticle 스키마 + DOI 링크 + 저자 정보",
					"- 데이터셋: Dataset 스키마 + 접근 URL + 라이선스",
					"- 기술 블로그: TechArticle 스키마 + datePublished + 저자",
					"score = (Schema 존재 ×30) + (메타데이터 완전성 ×30)",
					"      + (정적 HTML 접근 ×20) + (인용 정보 ×20)",
				].join("\n"),
				description: "콘텐츠 유형별 LLM 인식도 점수 카드",
			},
			{
				type: "extracted_data_table",
				condition: "ScholarlyArticle 또는 Dataset 스키마가 있는 페이지",
				max_rows: 10,
				description: "LLM이 인식 가능한 논문/데이터셋 목록",
			},
			{
				type: "product_recognition_bars",
				description: "대표 논문 페이지에서 LLM이 파악 가능한 메타데이터 항목별 진행바",
				derivation: [
					"연구소 사이트 필수 인식 항목:",
					"[논문제목, 저자목록, 출판일, DOI, 초록, 키워드,",
					" 소속기관, 인용수, 다운로드URL, 관련논문]",
				].join("\n"),
			},
		],
	},
	{
		id: "authority",
		title: "연구소 권위 지표",
		icon: "🏛️",
		site_types: ["research"],
		required_elements: [
			{
				type: "brand_sub_dimensions",
				derivation: [
					"연구소 신뢰도 하위 차원:",
					"- 학술 Entity 연결: (Wikidata, Google Scholar, ORCID 링크)",
					"- 출판 이력: (ScholarlyArticle 수 + datePublished 범위)",
					"- 인용 네트워크: (citation_ 메타태그 + 외부 인용 링크)",
					"- 연구자 프로필: (Person 스키마 + affiliation + h-index)",
					"- 오픈 액세스: (PDF 직접 접근 비율 + 라이선스 명시)",
				].join("\n"),
				description: "연구소 권위도 하위 차원별 점수",
			},
			{
				type: "claim_verification_table",
				columns: ["research_claim", "publication", "citation_count", "verifiability"],
				description: "연구 성과 클레임 × 검증가능성 테이블",
			},
		],
	},
];

export const RESEARCH_TAB_EXTENSIONS: Record<string, VizElement[]> = {
	roadmap: [
		{
			type: "consumer_scenario_cards",
			scenarios: ["discovery", "citation_verification"],
			description: "발견형/인용검증형 연구자 시나리오 카드",
			derivation: [
				"발견형: 연구자가 특정 주제의 최신 논문/데이터를 LLM으로 검색",
				"인용검증형: LLM이 기존 논문을 인용할 때 정확성 확인",
			].join("\n"),
		},
	],
};

export const RESEARCH_SIMULATION_LINES = [
	"overall",
	"discovery_researcher",
	"citation_accuracy",
];
