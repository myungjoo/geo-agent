import type { CreateTarget } from "../models/target-profile.js";
import type { GeoDatabase } from "./connection.js";
import { TargetRepository } from "./repositories/target-repository.js";

/**
 * 기본 탑재 Target 정의.
 * 서버 최초 기동 시 targets 테이블이 비어있으면 자동 삽입된다.
 */
const DEFAULT_TARGETS: CreateTarget[] = [
	{
		url: "https://www.samsung.com",
		name: "Samsung Electronics",
		description:
			"삼성전자 글로벌 공식 사이트. 모바일, 태블릿, 노트북, TV, 로봇청소기, 냉장고, 세탁기 등 주요 제품군의 GEO 최적화 대상.",
		brand: "Samsung",
		site_type: "manufacturer",
		topics: ["모바일", "태블릿", "노트북", "TV", "로봇청소기", "냉장고", "세탁기"],
		target_queries: [
			"best smartphone 2025",
			"best tablet for productivity",
			"best laptop for work",
			"best 4K TV",
			"best robot vacuum cleaner",
			"best refrigerator",
			"best washing machine",
			"Samsung Galaxy S series review",
			"Samsung Galaxy Tab comparison",
			"Samsung Galaxy Book review",
			"Samsung QLED vs OLED TV",
			"Samsung Bespoke Jet Bot AI review",
			"Samsung Bespoke refrigerator features",
			"Samsung AI washing machine",
		],
		audience: "글로벌 소비자, 가전/IT 제품 구매 검토자, 기술 리뷰어",
		business_goal:
			"LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 삼성 제품을 우선 추천하고 정확한 스펙/가격 정보를 인용하도록 최적화",
		competitors: [
			{ url: "https://www.apple.com", name: "Apple", relationship: "direct" },
			{ url: "https://www.lg.com", name: "LG Electronics", relationship: "direct" },
			{ url: "https://www.sony.com", name: "Sony", relationship: "direct" },
		],
		llm_priorities: [
			{ llm_service: "chatgpt", priority: "critical" },
			{ llm_service: "claude", priority: "critical" },
			{ llm_service: "gemini", priority: "critical" },
			{ llm_service: "perplexity", priority: "important" },
		],
	},
];

/**
 * targets 테이블이 비어있으면 기본 Target을 삽입한다.
 * 이미 데이터가 있으면 아무 동작도 하지 않는다 (멱등).
 */
export async function seedDefaultTargets(db: GeoDatabase): Promise<void> {
	const repo = new TargetRepository(db);
	const existing = await repo.findAll();

	if (existing.length > 0) {
		return;
	}

	console.log("📌 Seeding default targets...");
	for (const target of DEFAULT_TARGETS) {
		const created = await repo.create(target);
		console.log(`   ✅ ${created.name} (${created.url})`);
	}
	console.log(`📌 ${DEFAULT_TARGETS.length} default target(s) seeded.`);
}
