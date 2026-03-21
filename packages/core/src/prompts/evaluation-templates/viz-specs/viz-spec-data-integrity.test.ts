/**
 * VizSpec Data Integrity Tests
 *
 * Validates structural integrity of all tab definitions, extension maps,
 * simulation lines, and ensures no ID conflicts across layers.
 */
import { describe, expect, it } from "vitest";
import { COMMON_TABS } from "./common-tabs.js";
import {
	GENERIC_EXTRA_TABS,
	GENERIC_SIMULATION_LINES,
	GENERIC_TAB_EXTENSIONS,
} from "./generic-tabs.js";
import {
	MANUFACTURER_EXTRA_TABS,
	MANUFACTURER_SIMULATION_LINES,
	MANUFACTURER_TAB_EXTENSIONS,
} from "./manufacturer-tabs.js";
import { MANUFACTURER_ELECTRONICS_REF } from "./references/manufacturer-electronics.js";
import {
	RESEARCH_EXTRA_TABS,
	RESEARCH_SIMULATION_LINES,
	RESEARCH_TAB_EXTENSIONS,
} from "./research-tabs.js";
import {
	SUBTYPE_BY_SITE_TYPE,
	SUBTYPE_SIGNALS,
	TabSpecSchema,
	VizElementSchema,
	VizElementTypeSchema,
} from "./viz-spec-schema.js";

// ── No Tab ID Collisions ─────────────────────────────────

describe("Tab ID uniqueness", () => {
	it("common tabs have no duplicate IDs", () => {
		const ids = COMMON_TABS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("manufacturer extra tabs have no duplicate IDs", () => {
		const ids = MANUFACTURER_EXTRA_TABS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("research extra tabs have no duplicate IDs", () => {
		const ids = RESEARCH_EXTRA_TABS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("generic extra tabs have no duplicate IDs", () => {
		const ids = GENERIC_EXTRA_TABS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("manufacturer extra tabs don't collide with common tabs", () => {
		const commonIds = new Set(COMMON_TABS.map((t) => t.id));
		for (const tab of MANUFACTURER_EXTRA_TABS) {
			expect(commonIds.has(tab.id)).toBe(false);
		}
	});

	it("research extra tabs don't collide with common tabs", () => {
		const commonIds = new Set(COMMON_TABS.map((t) => t.id));
		for (const tab of RESEARCH_EXTRA_TABS) {
			expect(commonIds.has(tab.id)).toBe(false);
		}
	});

	it("generic extra tabs don't collide with common tabs", () => {
		const commonIds = new Set(COMMON_TABS.map((t) => t.id));
		for (const tab of GENERIC_EXTRA_TABS) {
			expect(commonIds.has(tab.id)).toBe(false);
		}
	});
});

// ── Tab Schema Validation ─────────────────────────────────

describe("All tabs pass TabSpecSchema", () => {
	const allTabs = [
		...COMMON_TABS,
		...MANUFACTURER_EXTRA_TABS,
		...RESEARCH_EXTRA_TABS,
		...GENERIC_EXTRA_TABS,
	];

	for (const tab of allTabs) {
		it(`tab "${tab.id}" passes schema validation`, () => {
			expect(() => TabSpecSchema.parse(tab)).not.toThrow();
		});
	}
});

// ── Required Elements Integrity ───────────────────────────

describe("Required elements use valid VizElementTypes", () => {
	const allTabs = [
		...COMMON_TABS,
		...MANUFACTURER_EXTRA_TABS,
		...RESEARCH_EXTRA_TABS,
		...GENERIC_EXTRA_TABS,
	];

	for (const tab of allTabs) {
		it(`tab "${tab.id}" elements have valid types`, () => {
			for (const el of tab.required_elements) {
				expect(() => VizElementSchema.parse(el)).not.toThrow();
			}
		});
	}
});

describe("All tabs have at least one required element", () => {
	const allTabs = [
		...COMMON_TABS,
		...MANUFACTURER_EXTRA_TABS,
		...RESEARCH_EXTRA_TABS,
		...GENERIC_EXTRA_TABS,
	];

	for (const tab of allTabs) {
		it(`tab "${tab.id}" has ≥1 element`, () => {
			expect(tab.required_elements.length).toBeGreaterThanOrEqual(1);
		});
	}
});

// ── Tab Extension Maps ────────────────────────────────────

describe("Tab extension maps reference existing common tab IDs", () => {
	const commonIds = new Set(COMMON_TABS.map((t) => t.id));

	it("MANUFACTURER_TAB_EXTENSIONS keys are valid common tab IDs", () => {
		for (const key of Object.keys(MANUFACTURER_TAB_EXTENSIONS)) {
			expect(commonIds.has(key)).toBe(true);
		}
	});

	it("RESEARCH_TAB_EXTENSIONS keys are valid common tab IDs", () => {
		for (const key of Object.keys(RESEARCH_TAB_EXTENSIONS)) {
			expect(commonIds.has(key)).toBe(true);
		}
	});

	it("GENERIC_TAB_EXTENSIONS keys are valid common tab IDs", () => {
		for (const key of Object.keys(GENERIC_TAB_EXTENSIONS)) {
			expect(commonIds.has(key)).toBe(true);
		}
	});
});

describe("Tab extension elements pass VizElementSchema", () => {
	const allExtensions = {
		...MANUFACTURER_TAB_EXTENSIONS,
		...RESEARCH_TAB_EXTENSIONS,
		...GENERIC_TAB_EXTENSIONS,
	};

	for (const [tabId, elements] of Object.entries(allExtensions)) {
		for (let i = 0; i < elements.length; i++) {
			it(`extension "${tabId}[${i}]" passes schema`, () => {
				expect(() => VizElementSchema.parse(elements[i])).not.toThrow();
			});
		}
	}
});

// ── Simulation Lines ──────────────────────────────────────

describe("Simulation lines", () => {
	it("MANUFACTURER_SIMULATION_LINES starts with overall", () => {
		expect(MANUFACTURER_SIMULATION_LINES[0]).toBe("overall");
	});

	it("RESEARCH_SIMULATION_LINES starts with overall", () => {
		expect(RESEARCH_SIMULATION_LINES[0]).toBe("overall");
	});

	it("GENERIC_SIMULATION_LINES starts with overall", () => {
		expect(GENERIC_SIMULATION_LINES[0]).toBe("overall");
	});

	it("all simulation line arrays have ≥2 entries", () => {
		expect(MANUFACTURER_SIMULATION_LINES.length).toBeGreaterThanOrEqual(2);
		expect(RESEARCH_SIMULATION_LINES.length).toBeGreaterThanOrEqual(2);
		expect(GENERIC_SIMULATION_LINES.length).toBeGreaterThanOrEqual(2);
	});

	it("no duplicate simulation lines", () => {
		for (const lines of [
			MANUFACTURER_SIMULATION_LINES,
			RESEARCH_SIMULATION_LINES,
			GENERIC_SIMULATION_LINES,
		]) {
			expect(new Set(lines).size).toBe(lines.length);
		}
	});
});

// ── SUBTYPE_BY_SITE_TYPE Completeness ─────────────────────

describe("SUBTYPE_BY_SITE_TYPE completeness", () => {
	it("all 3 site types are mapped", () => {
		expect(Object.keys(SUBTYPE_BY_SITE_TYPE)).toHaveLength(3);
		expect(SUBTYPE_BY_SITE_TYPE.manufacturer).toBeDefined();
		expect(SUBTYPE_BY_SITE_TYPE.research).toBeDefined();
		expect(SUBTYPE_BY_SITE_TYPE.generic).toBeDefined();
	});

	it("every site type includes general as fallback", () => {
		for (const subtypes of Object.values(SUBTYPE_BY_SITE_TYPE)) {
			expect(subtypes).toContain("general");
		}
	});

	it("no empty subtype arrays", () => {
		for (const subtypes of Object.values(SUBTYPE_BY_SITE_TYPE)) {
			expect(subtypes.length).toBeGreaterThanOrEqual(2);
		}
	});
});

// ── SUBTYPE_SIGNALS Integrity ─────────────────────────────

describe("SUBTYPE_SIGNALS integrity", () => {
	it("each signal has valid RegExp url_patterns", () => {
		for (const signal of SUBTYPE_SIGNALS) {
			for (const pattern of signal.url_patterns) {
				expect(pattern).toBeInstanceOf(RegExp);
			}
		}
	});

	it("each signal has non-empty schema_types", () => {
		for (const signal of SUBTYPE_SIGNALS) {
			expect(signal.schema_types.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("no duplicate subtypes in signals", () => {
		const subtypes = SUBTYPE_SIGNALS.map((s) => s.subtype);
		expect(new Set(subtypes).size).toBe(subtypes.length);
	});

	it("signal subtypes exist in SUBTYPE_BY_SITE_TYPE", () => {
		const allSubtypes = new Set(Object.values(SUBTYPE_BY_SITE_TYPE).flat());
		for (const signal of SUBTYPE_SIGNALS) {
			expect(allSubtypes.has(signal.subtype)).toBe(true);
		}
	});
});

// ── Reference Spec Integrity ──────────────────────────────

describe("MANUFACTURER_ELECTRONICS_REF integrity", () => {
	it("has correct site_type and subtype", () => {
		expect(MANUFACTURER_ELECTRONICS_REF.site_type).toBe("manufacturer");
		expect(MANUFACTURER_ELECTRONICS_REF.subtype).toBe("electronics");
	});

	it("product_recognition_items keys are non-empty", () => {
		const items = MANUFACTURER_ELECTRONICS_REF.product_recognition_items;
		expect(items).toBeDefined();
		const keys = Object.keys(items!);
		expect(keys.length).toBeGreaterThanOrEqual(3);
		for (const key of keys) {
			expect(items![key].length).toBeGreaterThanOrEqual(1);
		}
	});

	it("evidence_sections have id and title", () => {
		for (const section of MANUFACTURER_ELECTRONICS_REF.evidence_sections || []) {
			expect(section.id).toBeTruthy();
			expect(section.title).toBeTruthy();
		}
	});

	it("evidence_sections have unique IDs", () => {
		const sections = MANUFACTURER_ELECTRONICS_REF.evidence_sections || [];
		const ids = sections.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("probe customization maps P-01 through P-08", () => {
		const probes = MANUFACTURER_ELECTRONICS_REF.probe_customization!;
		for (let i = 1; i <= 8; i++) {
			const key = `P-0${i}`;
			expect(typeof probes[key]).toBe("string");
			expect(probes[key].length).toBeGreaterThan(0);
		}
	});

	it("competitor_estimation comparison_items is non-empty", () => {
		const items = MANUFACTURER_ELECTRONICS_REF.competitor_estimation?.comparison_items;
		expect(items).toBeDefined();
		expect(items!.length).toBeGreaterThanOrEqual(3);
	});
});

// ── Cross-layer consistency ───────────────────────────────

describe("Cross-layer consistency", () => {
	it("manufacturer extra tabs have correct site_types filter", () => {
		for (const tab of MANUFACTURER_EXTRA_TABS) {
			if (tab.site_types) {
				expect(tab.site_types).toContain("manufacturer");
			}
		}
	});

	it("research extra tabs have correct site_types filter", () => {
		for (const tab of RESEARCH_EXTRA_TABS) {
			if (tab.site_types) {
				expect(tab.site_types).toContain("research");
			}
		}
	});

	it("generic extra tabs have correct site_types filter", () => {
		for (const tab of GENERIC_EXTRA_TABS) {
			if (tab.site_types) {
				expect(tab.site_types).toContain("generic");
			}
		}
	});

	it("common tabs have no site_types restriction", () => {
		for (const tab of COMMON_TABS) {
			expect(tab.site_types).toBeUndefined();
		}
	});

	it("VizElementTypeSchema enum covers all types used in tabs", () => {
		const validTypes = new Set(VizElementTypeSchema.options);
		const allTabs = [
			...COMMON_TABS,
			...MANUFACTURER_EXTRA_TABS,
			...RESEARCH_EXTRA_TABS,
			...GENERIC_EXTRA_TABS,
		];
		for (const tab of allTabs) {
			for (const el of tab.required_elements) {
				expect(validTypes.has(el.type)).toBe(true);
			}
		}
	});

	it("VizElementTypeSchema enum covers all types used in extensions", () => {
		const validTypes = new Set(VizElementTypeSchema.options);
		const allExtensions = [
			...Object.values(MANUFACTURER_TAB_EXTENSIONS).flat(),
			...Object.values(RESEARCH_TAB_EXTENSIONS).flat(),
			...Object.values(GENERIC_TAB_EXTENSIONS).flat(),
		];
		for (const el of allExtensions) {
			expect(validTypes.has(el.type)).toBe(true);
		}
	});
});
