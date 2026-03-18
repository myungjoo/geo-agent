/**
 * Visualization Spec Loader
 *
 * 3-계층 병합: common → site_type → reference(subtype)
 * + 사이트 서브타입 자동 분류
 */
import type { SiteType } from "../index.js";
import { COMMON_TABS } from "./common-tabs.js";
import { GENERIC_EXTRA_TABS, GENERIC_SIMULATION_LINES, GENERIC_TAB_EXTENSIONS } from "./generic-tabs.js";
import {
	MANUFACTURER_EXTRA_TABS,
	MANUFACTURER_SIMULATION_LINES,
	MANUFACTURER_TAB_EXTENSIONS,
} from "./manufacturer-tabs.js";
import { MANUFACTURER_ELECTRONICS_REF } from "./references/manufacturer-electronics.js";
import { RESEARCH_EXTRA_TABS, RESEARCH_SIMULATION_LINES, RESEARCH_TAB_EXTENSIONS } from "./research-tabs.js";
import {
	SUBTYPE_SIGNALS,
	type ReferenceSpec,
	type SiteSubtype,
	type SubtypeSignal,
	type TabSpec,
	type VizElement,
	type VisualizationSpec,
} from "./viz-spec-schema.js";

// ── Reference Registry ──────────────────────────────────────

/**
 * 등록된 참조 스펙 목록.
 * 새 참조를 추가하려면 이 배열에 import + 추가.
 */
const REFERENCE_REGISTRY: ReferenceSpec[] = [
	MANUFACTURER_ELECTRONICS_REF,
];

// ── Site Type → Extra Tabs / Extensions 매핑 ────────────────

const EXTRA_TABS_BY_TYPE: Record<SiteType, TabSpec[]> = {
	manufacturer: MANUFACTURER_EXTRA_TABS,
	research: RESEARCH_EXTRA_TABS,
	generic: GENERIC_EXTRA_TABS,
};

const TAB_EXTENSIONS_BY_TYPE: Record<SiteType, Record<string, VizElement[]>> = {
	manufacturer: MANUFACTURER_TAB_EXTENSIONS,
	research: RESEARCH_TAB_EXTENSIONS,
	generic: GENERIC_TAB_EXTENSIONS,
};

const SIMULATION_LINES_BY_TYPE: Record<SiteType, string[]> = {
	manufacturer: MANUFACTURER_SIMULATION_LINES,
	research: RESEARCH_SIMULATION_LINES,
	generic: GENERIC_SIMULATION_LINES,
};

// ── Subtype Classification ──────────────────────────────────

export interface SubtypeClassificationResult {
	subtype: SiteSubtype;
	confidence: number;
	matched_signals: string[];
}

/**
 * HTML 콘텐츠와 URL을 분석하여 사이트 서브타입을 분류한다.
 *
 * @param htmlContent 페이지 HTML
 * @param url 페이지 URL
 * @param siteType 이미 분류된 사이트 유형
 */
export function classifySubtype(
	htmlContent: string,
	url: string,
	siteType: SiteType,
): SubtypeClassificationResult {
	const lowerHtml = htmlContent.toLowerCase();
	const lowerUrl = url.toLowerCase();

	let bestSubtype: SiteSubtype = "general";
	let bestScore = 0;
	let bestMatches: string[] = [];

	for (const signal of SUBTYPE_SIGNALS) {
		const matches: string[] = [];

		// URL 패턴 매칭
		for (const pattern of signal.url_patterns) {
			if (pattern.test(lowerUrl) || pattern.test(lowerHtml)) {
				matches.push(`URL pattern: ${pattern.source}`);
			}
		}

		// HTML 키워드 매칭
		let kwCount = 0;
		for (const kw of signal.html_keywords) {
			if (lowerHtml.includes(kw.toLowerCase())) {
				kwCount++;
			}
		}
		if (kwCount >= 3) {
			matches.push(`HTML keywords: ${kwCount}/${signal.html_keywords.length} matched`);
		}

		// Schema 타입 매칭
		for (const schemaType of signal.schema_types) {
			const patterns = [
				`"@type":"${schemaType}"`,
				`"@type": "${schemaType}"`,
				`"@type":"${schemaType.toLowerCase()}"`,
				`"@type": "${schemaType.toLowerCase()}"`,
			];
			if (patterns.some((p) => lowerHtml.includes(p.toLowerCase()))) {
				matches.push(`Schema: ${schemaType}`);
			}
		}

		const score = matches.length;
		if (score > bestScore) {
			bestScore = score;
			bestSubtype = signal.subtype;
			bestMatches = matches;
		}
	}

	const confidence = Math.min(bestScore / 4, 1);

	return {
		subtype: bestSubtype,
		confidence,
		matched_signals: bestMatches,
	};
}

// ── Reference Lookup ────────────────────────────────────────

/**
 * site_type + subtype에 해당하는 참조 스펙을 찾는다.
 */
export function findReference(
	siteType: SiteType,
	subtype: SiteSubtype,
): ReferenceSpec | undefined {
	return REFERENCE_REGISTRY.find(
		(r) => r.site_type === siteType && r.subtype === subtype,
	);
}

/**
 * 등록된 모든 참조 스펙 목록을 반환한다.
 */
export function listReferences(): ReferenceSpec[] {
	return [...REFERENCE_REGISTRY];
}

// ── Tab Merge Engine ────────────────────────────────────────

/**
 * 탭 ID 기준 정렬 순서. 이 순서대로 최종 탭이 배치된다.
 */
const TAB_ORDER = [
	"overview",
	"crawlability",
	"structure",
	"products",       // manufacturer only
	"publications",   // research only
	"content",        // generic only
	"brand",          // manufacturer
	"authority",      // research
	"trust",          // generic
	"pages",
	"recommendations",
	"evidence",
	"probes",
	"roadmap",
];

function sortTabs(tabs: TabSpec[]): TabSpec[] {
	return [...tabs].sort((a, b) => {
		const ia = TAB_ORDER.indexOf(a.id);
		const ib = TAB_ORDER.indexOf(b.id);
		// 목록에 없는 탭은 맨 뒤로
		return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
	});
}

/**
 * 기존 탭에 확장 요소를 추가한다.
 */
function applyTabExtensions(
	tabs: TabSpec[],
	extensions: Record<string, VizElement[]>,
): TabSpec[] {
	return tabs.map((tab) => {
		const ext = extensions[tab.id];
		if (!ext || ext.length === 0) return tab;

		return {
			...tab,
			required_elements: [...tab.required_elements, ...ext],
		};
	});
}

/**
 * score_simulation_chart 요소의 lines를 업데이트한다.
 */
function applySimulationLines(tabs: TabSpec[], lines: string[]): TabSpec[] {
	return tabs.map((tab) => {
		if (tab.id !== "roadmap") return tab;

		return {
			...tab,
			required_elements: tab.required_elements.map((el) => {
				if (el.type !== "score_simulation_chart") return el;
				return { ...el, lines };
			}),
		};
	});
}

// ── Main Loader ─────────────────────────────────────────────

export interface LoadVizSpecOptions {
	/** 이미 분류된 사이트 유형 */
	siteType: SiteType;
	/** 명시적 서브타입 (없으면 자동 분류) */
	subtype?: SiteSubtype;
	/** 자동 분류용 HTML (subtype 미지정 시 필요) */
	htmlContent?: string;
	/** 자동 분류용 URL (subtype 미지정 시 필요) */
	url?: string;
}

/**
 * 3-계층 병합을 수행하여 최종 VisualizationSpec을 반환한다.
 *
 * 1. Common tabs (모든 사이트)
 * 2. Site-type extra tabs + extensions (유형별)
 * 3. Reference spec (subtype별 참조 — 있으면 적용)
 */
export function loadVisualizationSpec(options: LoadVizSpecOptions): VisualizationSpec {
	const { siteType, htmlContent, url } = options;

	// 1. Subtype 결정
	let subtype: SiteSubtype;
	if (options.subtype) {
		subtype = options.subtype;
	} else if (htmlContent && url) {
		const classification = classifySubtype(htmlContent, url, siteType);
		subtype = classification.subtype;
	} else {
		subtype = "general";
	}

	// 2. Layer 1: Common tabs
	let tabs: TabSpec[] = [...COMMON_TABS];

	// 3. Layer 2: Site-type extra tabs
	const extraTabs = EXTRA_TABS_BY_TYPE[siteType] ?? [];
	tabs = [...tabs, ...extraTabs];

	// 4. Layer 2: Tab extensions (기존 탭에 요소 추가)
	const extensions = TAB_EXTENSIONS_BY_TYPE[siteType] ?? {};
	tabs = applyTabExtensions(tabs, extensions);

	// 5. Layer 2: Simulation lines
	const simLines = SIMULATION_LINES_BY_TYPE[siteType] ?? ["overall"];
	tabs = applySimulationLines(tabs, simLines);

	// 6. Layer 3: Reference spec
	const reference = findReference(siteType, subtype);

	// 7. 탭 정렬
	tabs = sortTabs(tabs);

	return {
		site_type: siteType,
		subtype,
		tabs,
		scoring_system: "readiness",
		reference,
	};
}

/**
 * VisualizationSpec에서 탭 ID로 탭을 찾는다.
 */
export function getTabSpec(spec: VisualizationSpec, tabId: string): TabSpec | undefined {
	return spec.tabs.find((t) => t.id === tabId);
}

/**
 * VisualizationSpec의 품질 기준 충족 여부를 검증한다.
 */
export function validateQualityBar(spec: VisualizationSpec): {
	passed: boolean;
	failures: string[];
} {
	const failures: string[] = [];
	const qb = spec.reference?.quality_bar;

	if (!qb) {
		return { passed: true, failures: [] };
	}

	if (spec.tabs.length < qb.min_tabs) {
		failures.push(`탭 수 부족: ${spec.tabs.length} < ${qb.min_tabs}`);
	}

	if (qb.min_probe_detail) {
		const probeTab = spec.tabs.find((t) => t.id === "probes");
		const hasDetail = probeTab?.required_elements.some(
			(el) => el.type === "probe_detail_cards",
		);
		if (!hasDetail) {
			failures.push("Probe 상세 카드 없음 (min_probe_detail 위반)");
		}
	}

	if (qb.claim_validation_mapping) {
		const probeTab = spec.tabs.find((t) => t.id === "probes");
		const hasMapping = probeTab?.required_elements.some(
			(el) => el.type === "claim_validation_mapping",
		);
		if (!hasMapping) {
			failures.push("클레임 검증 매핑 없음 (claim_validation_mapping 위반)");
		}
	}

	if (qb.score_simulation_lines) {
		const roadmapTab = spec.tabs.find((t) => t.id === "roadmap");
		const simChart = roadmapTab?.required_elements.find(
			(el) => el.type === "score_simulation_chart",
		);
		const lineCount = simChart?.lines?.length ?? 0;
		if (lineCount < qb.score_simulation_lines) {
			failures.push(
				`시뮬레이션 라인 부족: ${lineCount} < ${qb.score_simulation_lines}`,
			);
		}
	}

	if (qb.min_evidence_sections) {
		const evidenceCount = spec.reference?.evidence_sections?.length ?? 0;
		if (evidenceCount < qb.min_evidence_sections) {
			failures.push(
				`실증 섹션 부족: ${evidenceCount} < ${qb.min_evidence_sections}`,
			);
		}
	}

	return {
		passed: failures.length === 0,
		failures,
	};
}
