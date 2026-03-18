import { describe, it, expect } from "vitest";
import {
	// Site Type
	SiteTypeSchema,
	SITE_TYPE_LABELS,
	type SiteType,

	// Classification
	ClassificationSignalSchema,
	CLASSIFICATION_SIGNALS,

	// Scoring
	ScoringDimensionSchema,
	DEFAULT_SCORING_DIMENSIONS,

	// Probe
	ProbeVerdictSchema,
	ProbeResultSchema,

	// Grade & Score
	GradeSchema,
	calculateGrade,
	calculateOverallScore,

	// Evaluation Result
	EvaluationResultSchema,
	type EvaluationResult,

	// Cycle Control
	CycleStopReasonSchema,
	CycleControlSchema,
	shouldStopCycle,
	type CycleControl,

	// Template Registry
	TEMPLATE_REGISTRY,
	getTemplate,
} from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────

const NOW = "2026-03-18T12:00:00Z";

function makeProbeResult(overrides: Record<string, unknown> = {}) {
	return {
		probe_id: "P-01",
		verdict: "PASS" as const,
		found: 4,
		total: 4,
		...overrides,
	};
}

function makeEvaluationResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
	return {
		run_id: "2026-03-18-001",
		site_name: "Samsung",
		base_url: "https://www.samsung.com/us",
		site_type: "manufacturer",
		evaluated_at: NOW,
		cycle_number: 0,
		evaluation_target: "original",
		overall_score: 57,
		grade: "Needs Improvement",
		dimension_scores: {
			S1: 60,
			S2: 60,
			S3: 40,
			S4: 50,
			S5: 60,
			S6: 15,
			S7: 40,
		},
		probe_results: {
			"P-01": makeProbeResult({ verdict: "FAIL", found: 0 }),
		},
		key_findings: ["TV 카탈로그 JSON-LD 완전 구현"],
		top_improvements: [
			{
				id: "T-3",
				title: "llms.txt 생성",
				sprint: 1,
				impact: 5,
				difficulty: 1,
				affected_dimensions: ["S6"],
			},
		],
		...overrides,
	};
}

function makeCycleControl(overrides: Partial<CycleControl> = {}): CycleControl {
	return {
		max_cycles: 10,
		target_score: 80,
		min_improvement_per_cycle: 2,
		current_cycle: 0,
		intermediate_results: [],
		...overrides,
	};
}

// ══════════════════════════════════════════════════════════════════════
// 1. SiteType 스키마
// ══════════════════════════════════════════════════════════════════════

describe("SiteTypeSchema", () => {
	it("accepts valid site types", () => {
		expect(SiteTypeSchema.parse("manufacturer")).toBe("manufacturer");
		expect(SiteTypeSchema.parse("research")).toBe("research");
		expect(SiteTypeSchema.parse("generic")).toBe("generic");
	});

	it("rejects invalid site types", () => {
		expect(() => SiteTypeSchema.parse("ecommerce")).toThrow();
		expect(() => SiteTypeSchema.parse("")).toThrow();
		expect(() => SiteTypeSchema.parse(123)).toThrow();
	});
});

describe("SITE_TYPE_LABELS", () => {
	it("has labels for all site types", () => {
		const types: SiteType[] = ["manufacturer", "research", "generic"];
		for (const t of types) {
			expect(SITE_TYPE_LABELS[t]).toBeDefined();
			expect(typeof SITE_TYPE_LABELS[t]).toBe("string");
			expect(SITE_TYPE_LABELS[t].length).toBeGreaterThan(0);
		}
	});

	it("returns correct Korean labels", () => {
		expect(SITE_TYPE_LABELS.manufacturer).toBe("제조사 대표 Site");
		expect(SITE_TYPE_LABELS.research).toBe("연구소 대표 Site");
		expect(SITE_TYPE_LABELS.generic).toBe("기타");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2. ClassificationSignal 스키마
// ══════════════════════════════════════════════════════════════════════

describe("ClassificationSignalSchema", () => {
	it("accepts valid classification signal", () => {
		const signal = {
			site_type: "manufacturer",
			confidence: 0.85,
			signals: ["Product JSON-LD 스키마 존재", "Offer 스키마 존재"],
		};
		const parsed = ClassificationSignalSchema.parse(signal);
		expect(parsed.site_type).toBe("manufacturer");
		expect(parsed.confidence).toBe(0.85);
		expect(parsed.signals).toHaveLength(2);
	});

	it("accepts confidence boundary values", () => {
		expect(
			ClassificationSignalSchema.parse({
				site_type: "generic",
				confidence: 0,
				signals: [],
			}).confidence,
		).toBe(0);
		expect(
			ClassificationSignalSchema.parse({
				site_type: "generic",
				confidence: 1,
				signals: [],
			}).confidence,
		).toBe(1);
	});

	it("rejects confidence out of range", () => {
		expect(() =>
			ClassificationSignalSchema.parse({
				site_type: "generic",
				confidence: -0.1,
				signals: [],
			}),
		).toThrow();
		expect(() =>
			ClassificationSignalSchema.parse({
				site_type: "generic",
				confidence: 1.1,
				signals: [],
			}),
		).toThrow();
	});

	it("rejects invalid site_type", () => {
		expect(() =>
			ClassificationSignalSchema.parse({
				site_type: "unknown",
				confidence: 0.5,
				signals: [],
			}),
		).toThrow();
	});

	it("requires signals to be string array", () => {
		expect(() =>
			ClassificationSignalSchema.parse({
				site_type: "manufacturer",
				confidence: 0.5,
				signals: [123],
			}),
		).toThrow();
	});
});

describe("CLASSIFICATION_SIGNALS", () => {
	it("defines signals for all site types", () => {
		const types: SiteType[] = ["manufacturer", "research", "generic"];
		for (const t of types) {
			expect(CLASSIFICATION_SIGNALS[t]).toBeDefined();
			expect(Array.isArray(CLASSIFICATION_SIGNALS[t])).toBe(true);
			expect(CLASSIFICATION_SIGNALS[t].length).toBeGreaterThan(0);
		}
	});

	it("manufacturer has product-related signals", () => {
		const signals = CLASSIFICATION_SIGNALS.manufacturer;
		expect(signals.some((s) => s.includes("Product"))).toBe(true);
		expect(signals.some((s) => s.includes("Offer"))).toBe(true);
	});

	it("research has scholarly signals", () => {
		const signals = CLASSIFICATION_SIGNALS.research;
		expect(signals.some((s) => s.includes("ScholarlyArticle"))).toBe(true);
		expect(signals.some((s) => s.includes("DOI"))).toBe(true);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3. ScoringDimension 스키마
// ══════════════════════════════════════════════════════════════════════

describe("ScoringDimensionSchema", () => {
	it("accepts valid dimension", () => {
		const dim = { id: "S1", name: "LLM 크롤링 접근성", weight: 0.15 };
		const parsed = ScoringDimensionSchema.parse(dim);
		expect(parsed.id).toBe("S1");
		expect(parsed.weight).toBe(0.15);
		expect(parsed.score).toBeUndefined();
	});

	it("accepts dimension with score", () => {
		const dim = { id: "S1", name: "test", weight: 0.15, score: 85 };
		expect(ScoringDimensionSchema.parse(dim).score).toBe(85);
	});

	it("rejects weight out of range", () => {
		expect(() =>
			ScoringDimensionSchema.parse({ id: "S1", name: "t", weight: -0.1 }),
		).toThrow();
		expect(() =>
			ScoringDimensionSchema.parse({ id: "S1", name: "t", weight: 1.1 }),
		).toThrow();
	});

	it("rejects score out of range", () => {
		expect(() =>
			ScoringDimensionSchema.parse({
				id: "S1",
				name: "t",
				weight: 0.1,
				score: -1,
			}),
		).toThrow();
		expect(() =>
			ScoringDimensionSchema.parse({
				id: "S1",
				name: "t",
				weight: 0.1,
				score: 101,
			}),
		).toThrow();
	});

	it("accepts boundary score values", () => {
		expect(
			ScoringDimensionSchema.parse({
				id: "S1",
				name: "t",
				weight: 0.1,
				score: 0,
			}).score,
		).toBe(0);
		expect(
			ScoringDimensionSchema.parse({
				id: "S1",
				name: "t",
				weight: 0.1,
				score: 100,
			}).score,
		).toBe(100);
	});
});

describe("DEFAULT_SCORING_DIMENSIONS", () => {
	const types: SiteType[] = ["manufacturer", "research", "generic"];

	it("defines 7 dimensions for each site type", () => {
		for (const t of types) {
			expect(DEFAULT_SCORING_DIMENSIONS[t]).toHaveLength(7);
		}
	});

	it("all types have S1~S7 dimension IDs", () => {
		for (const t of types) {
			const ids = DEFAULT_SCORING_DIMENSIONS[t].map((d) => d.id);
			expect(ids).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
		}
	});

	it("weights sum to 1.0 for each type", () => {
		for (const t of types) {
			const sum = DEFAULT_SCORING_DIMENSIONS[t].reduce(
				(acc, d) => acc + d.weight,
				0,
			);
			expect(sum).toBeCloseTo(1.0, 10);
		}
	});

	it("all types share identical weights", () => {
		const mfgWeights = DEFAULT_SCORING_DIMENSIONS.manufacturer.map(
			(d) => d.weight,
		);
		const resWeights = DEFAULT_SCORING_DIMENSIONS.research.map(
			(d) => d.weight,
		);
		const genWeights = DEFAULT_SCORING_DIMENSIONS.generic.map(
			(d) => d.weight,
		);
		expect(mfgWeights).toEqual(resWeights);
		expect(resWeights).toEqual(genWeights);
	});

	it("weights are 15/25/20/10/10/10/10 percent", () => {
		const expected = [0.15, 0.25, 0.2, 0.1, 0.1, 0.1, 0.1];
		for (const t of types) {
			const weights = DEFAULT_SCORING_DIMENSIONS[t].map((d) => d.weight);
			expect(weights).toEqual(expected);
		}
	});

	it("dimension names differ between types (S2, S3, S5)", () => {
		const mfg = DEFAULT_SCORING_DIMENSIONS.manufacturer;
		const res = DEFAULT_SCORING_DIMENSIONS.research;
		const gen = DEFAULT_SCORING_DIMENSIONS.generic;

		// S2 differs
		expect(mfg[1].name).not.toBe(res[1].name);

		// S3 differs
		expect(mfg[2].name).not.toBe(res[2].name);
		expect(res[2].name).not.toBe(gen[2].name);

		// S5 differs
		expect(mfg[4].name).not.toBe(res[4].name);
	});

	it("S1 and S6 names are identical across types", () => {
		const types2: SiteType[] = ["manufacturer", "research", "generic"];
		const s1Names = types2.map((t) => DEFAULT_SCORING_DIMENSIONS[t][0].name);
		const s6Names = types2.map((t) => DEFAULT_SCORING_DIMENSIONS[t][5].name);
		expect(new Set(s1Names).size).toBe(1);
		expect(new Set(s6Names).size).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4. ProbeVerdict & ProbeResult 스키마
// ══════════════════════════════════════════════════════════════════════

describe("ProbeVerdictSchema", () => {
	it("accepts valid verdicts", () => {
		expect(ProbeVerdictSchema.parse("PASS")).toBe("PASS");
		expect(ProbeVerdictSchema.parse("PARTIAL")).toBe("PARTIAL");
		expect(ProbeVerdictSchema.parse("FAIL")).toBe("FAIL");
	});

	it("rejects invalid verdicts", () => {
		expect(() => ProbeVerdictSchema.parse("pass")).toThrow();
		expect(() => ProbeVerdictSchema.parse("SKIP")).toThrow();
		expect(() => ProbeVerdictSchema.parse("")).toThrow();
	});
});

describe("ProbeResultSchema", () => {
	it("accepts valid probe result", () => {
		const result = makeProbeResult();
		const parsed = ProbeResultSchema.parse(result);
		expect(parsed.probe_id).toBe("P-01");
		expect(parsed.verdict).toBe("PASS");
		expect(parsed.found).toBe(4);
		expect(parsed.total).toBe(4);
	});

	it("accepts probe result with notes", () => {
		const result = makeProbeResult({ notes: "스펙 JS 렌더링 후만 노출" });
		expect(ProbeResultSchema.parse(result).notes).toBe(
			"스펙 JS 렌더링 후만 노출",
		);
	});

	it("notes is optional", () => {
		const result = makeProbeResult();
		expect(ProbeResultSchema.parse(result).notes).toBeUndefined();
	});

	it("rejects missing required fields", () => {
		expect(() => ProbeResultSchema.parse({ probe_id: "P-01" })).toThrow();
		expect(() =>
			ProbeResultSchema.parse({ verdict: "PASS", found: 0, total: 0 }),
		).toThrow();
	});

	it("accepts FAIL with found=0", () => {
		const result = makeProbeResult({ verdict: "FAIL", found: 0, total: 4 });
		const parsed = ProbeResultSchema.parse(result);
		expect(parsed.verdict).toBe("FAIL");
		expect(parsed.found).toBe(0);
	});

	it("accepts PARTIAL verdict", () => {
		const result = makeProbeResult({ verdict: "PARTIAL", found: 2, total: 4 });
		expect(ProbeResultSchema.parse(result).verdict).toBe("PARTIAL");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5. Grade & Score 계산
// ══════════════════════════════════════════════════════════════════════

describe("GradeSchema", () => {
	it("accepts all valid grades", () => {
		const grades = [
			"Excellent",
			"Good",
			"Needs Improvement",
			"Poor",
			"Critical",
		];
		for (const g of grades) {
			expect(GradeSchema.parse(g)).toBe(g);
		}
	});

	it("rejects invalid grades", () => {
		expect(() => GradeSchema.parse("Average")).toThrow();
		expect(() => GradeSchema.parse("excellent")).toThrow();
	});
});

describe("calculateGrade", () => {
	it("returns Excellent for score >= 90", () => {
		expect(calculateGrade(90)).toBe("Excellent");
		expect(calculateGrade(95)).toBe("Excellent");
		expect(calculateGrade(100)).toBe("Excellent");
	});

	it("returns Good for score 75-89", () => {
		expect(calculateGrade(75)).toBe("Good");
		expect(calculateGrade(80)).toBe("Good");
		expect(calculateGrade(89)).toBe("Good");
	});

	it("returns Needs Improvement for score 55-74", () => {
		expect(calculateGrade(55)).toBe("Needs Improvement");
		expect(calculateGrade(57)).toBe("Needs Improvement");
		expect(calculateGrade(74)).toBe("Needs Improvement");
	});

	it("returns Poor for score 35-54", () => {
		expect(calculateGrade(35)).toBe("Poor");
		expect(calculateGrade(45)).toBe("Poor");
		expect(calculateGrade(54)).toBe("Poor");
	});

	it("returns Critical for score 0-34", () => {
		expect(calculateGrade(0)).toBe("Critical");
		expect(calculateGrade(20)).toBe("Critical");
		expect(calculateGrade(34)).toBe("Critical");
	});

	it("handles exact boundary values correctly", () => {
		expect(calculateGrade(89.999)).toBe("Good");
		expect(calculateGrade(74.999)).toBe("Needs Improvement");
		expect(calculateGrade(54.999)).toBe("Poor");
		expect(calculateGrade(34.999)).toBe("Critical");
	});
});

describe("calculateOverallScore", () => {
	it("returns 0 when all scores are 0", () => {
		const dims = DEFAULT_SCORING_DIMENSIONS.manufacturer.map((d) => ({
			...d,
			score: 0,
		}));
		expect(calculateOverallScore(dims)).toBe(0);
	});

	it("returns 100 when all scores are 100", () => {
		const dims = DEFAULT_SCORING_DIMENSIONS.manufacturer.map((d) => ({
			...d,
			score: 100,
		}));
		expect(calculateOverallScore(dims)).toBeCloseTo(100, 10);
	});

	it("correctly applies weights", () => {
		// Only S1 has score=100 (weight=0.15), rest 0
		const dims = DEFAULT_SCORING_DIMENSIONS.manufacturer.map((d) => ({
			...d,
			score: d.id === "S1" ? 100 : 0,
		}));
		expect(calculateOverallScore(dims)).toBeCloseTo(15, 10);
	});

	it("treats undefined score as 0", () => {
		const dims = DEFAULT_SCORING_DIMENSIONS.manufacturer; // no scores set
		expect(calculateOverallScore(dims)).toBe(0);
	});

	it("calculates samsung.com-like score correctly", () => {
		// S1=60, S2=60, S3=40, S4=50, S5=60, S6=15, S7=40
		const scores = [60, 60, 40, 50, 60, 15, 40];
		const dims = DEFAULT_SCORING_DIMENSIONS.manufacturer.map((d, i) => ({
			...d,
			score: scores[i],
		}));
		// 60×0.15 + 60×0.25 + 40×0.20 + 50×0.10 + 60×0.10 + 15×0.10 + 40×0.10
		// = 9 + 15 + 8 + 5 + 6 + 1.5 + 4 = 48.5
		expect(calculateOverallScore(dims)).toBeCloseTo(48.5, 10);
	});

	it("returns same result regardless of site type (same scores)", () => {
		const scores = [80, 70, 60, 50, 40, 30, 20];
		const types: ("manufacturer" | "research" | "generic")[] = [
			"manufacturer",
			"research",
			"generic",
		];
		const results = types.map((t) => {
			const dims = DEFAULT_SCORING_DIMENSIONS[t].map((d, i) => ({
				...d,
				score: scores[i],
			}));
			return calculateOverallScore(dims);
		});
		// All should be equal since weights are identical
		expect(results[0]).toBeCloseTo(results[1], 10);
		expect(results[1]).toBeCloseTo(results[2], 10);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6. EvaluationResult 스키마
// ══════════════════════════════════════════════════════════════════════

describe("EvaluationResultSchema", () => {
	it("accepts valid evaluation result", () => {
		const result = makeEvaluationResult();
		const parsed = EvaluationResultSchema.parse(result);
		expect(parsed.run_id).toBe("2026-03-18-001");
		expect(parsed.site_type).toBe("manufacturer");
		expect(parsed.cycle_number).toBe(0);
		expect(parsed.evaluation_target).toBe("original");
	});

	it("accepts all site types", () => {
		for (const t of ["manufacturer", "research", "generic"] as const) {
			const parsed = EvaluationResultSchema.parse(
				makeEvaluationResult({ site_type: t }),
			);
			expect(parsed.site_type).toBe(t);
		}
	});

	it("accepts both evaluation targets", () => {
		expect(
			EvaluationResultSchema.parse(
				makeEvaluationResult({ evaluation_target: "original" }),
			).evaluation_target,
		).toBe("original");
		expect(
			EvaluationResultSchema.parse(
				makeEvaluationResult({ evaluation_target: "clone" }),
			).evaluation_target,
		).toBe("clone");
	});

	it("rejects invalid evaluation target", () => {
		expect(() =>
			EvaluationResultSchema.parse(
				makeEvaluationResult({ evaluation_target: "modified" } as any),
			),
		).toThrow();
	});

	it("accepts all valid grades", () => {
		const grades = [
			"Excellent",
			"Good",
			"Needs Improvement",
			"Poor",
			"Critical",
		] as const;
		for (const g of grades) {
			expect(
				EvaluationResultSchema.parse(makeEvaluationResult({ grade: g })).grade,
			).toBe(g);
		}
	});

	it("rejects invalid grade", () => {
		expect(() =>
			EvaluationResultSchema.parse(makeEvaluationResult({ grade: "Bad" } as any)),
		).toThrow();
	});

	it("accepts empty arrays for findings and improvements", () => {
		const parsed = EvaluationResultSchema.parse(
			makeEvaluationResult({ key_findings: [], top_improvements: [] }),
		);
		expect(parsed.key_findings).toEqual([]);
		expect(parsed.top_improvements).toEqual([]);
	});

	it("validates improvement item structure", () => {
		const result = makeEvaluationResult({
			top_improvements: [
				{
					id: "T-1",
					title: "스마트폰 Product Schema",
					sprint: 2,
					impact: 5,
					difficulty: 2,
					affected_dimensions: ["S2", "S3"],
				},
			],
		});
		const parsed = EvaluationResultSchema.parse(result);
		expect(parsed.top_improvements[0].affected_dimensions).toEqual([
			"S2",
			"S3",
		]);
	});

	it("rejects missing required fields", () => {
		expect(() => EvaluationResultSchema.parse({})).toThrow();
		expect(() =>
			EvaluationResultSchema.parse({ run_id: "test" }),
		).toThrow();
	});

	it("accepts cycle_number > 0 for intermediate results", () => {
		const parsed = EvaluationResultSchema.parse(
			makeEvaluationResult({
				cycle_number: 3,
				evaluation_target: "clone",
			}),
		);
		expect(parsed.cycle_number).toBe(3);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7. CycleStopReason 스키마
// ══════════════════════════════════════════════════════════════════════

describe("CycleStopReasonSchema", () => {
	it("accepts all valid stop reasons", () => {
		const reasons = [
			"score_sufficient",
			"no_more_improvements",
			"max_cycles_reached",
			"manual_stop",
		];
		for (const r of reasons) {
			expect(CycleStopReasonSchema.parse(r)).toBe(r);
		}
	});

	it("rejects invalid reasons", () => {
		expect(() => CycleStopReasonSchema.parse("timeout")).toThrow();
		expect(() => CycleStopReasonSchema.parse("")).toThrow();
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8. CycleControl 스키마
// ══════════════════════════════════════════════════════════════════════

describe("CycleControlSchema", () => {
	it("accepts valid cycle control with defaults", () => {
		const parsed = CycleControlSchema.parse({});
		expect(parsed.max_cycles).toBe(10);
		expect(parsed.target_score).toBe(80);
		expect(parsed.min_improvement_per_cycle).toBe(2);
		expect(parsed.current_cycle).toBe(0);
		expect(parsed.stop_reason).toBeUndefined();
		expect(parsed.intermediate_results).toEqual([]);
	});

	it("accepts custom values", () => {
		const parsed = CycleControlSchema.parse({
			max_cycles: 5,
			target_score: 90,
			min_improvement_per_cycle: 3,
			current_cycle: 2,
		});
		expect(parsed.max_cycles).toBe(5);
		expect(parsed.target_score).toBe(90);
		expect(parsed.min_improvement_per_cycle).toBe(3);
		expect(parsed.current_cycle).toBe(2);
	});

	it("accepts stop_reason", () => {
		const parsed = CycleControlSchema.parse({
			stop_reason: "manual_stop",
		});
		expect(parsed.stop_reason).toBe("manual_stop");
	});

	it("accepts intermediate_results array", () => {
		const result = makeEvaluationResult();
		const parsed = CycleControlSchema.parse({
			intermediate_results: [result],
		});
		expect(parsed.intermediate_results).toHaveLength(1);
	});

	it("rejects target_score out of range", () => {
		expect(() =>
			CycleControlSchema.parse({ target_score: -1 }),
		).toThrow();
		expect(() =>
			CycleControlSchema.parse({ target_score: 101 }),
		).toThrow();
	});

	it("accepts boundary target_score values", () => {
		expect(CycleControlSchema.parse({ target_score: 0 }).target_score).toBe(0);
		expect(
			CycleControlSchema.parse({ target_score: 100 }).target_score,
		).toBe(100);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9. shouldStopCycle 함수
// ══════════════════════════════════════════════════════════════════════

describe("shouldStopCycle", () => {
	it("does not stop on initial cycle with no results", () => {
		const control = makeCycleControl();
		const result = shouldStopCycle(control);
		expect(result.should_stop).toBe(false);
		expect(result.reason).toBeUndefined();
	});

	it("stops when max_cycles reached", () => {
		const control = makeCycleControl({
			current_cycle: 10,
			max_cycles: 10,
		});
		const result = shouldStopCycle(control);
		expect(result.should_stop).toBe(true);
		expect(result.reason).toBe("max_cycles_reached");
	});

	it("stops when max_cycles exceeded", () => {
		const control = makeCycleControl({
			current_cycle: 15,
			max_cycles: 10,
		});
		expect(shouldStopCycle(control).should_stop).toBe(true);
		expect(shouldStopCycle(control).reason).toBe("max_cycles_reached");
	});

	it("stops when target score reached", () => {
		const control = makeCycleControl({
			current_cycle: 3,
			target_score: 80,
			intermediate_results: [makeEvaluationResult({ overall_score: 82 })],
		});
		const result = shouldStopCycle(control);
		expect(result.should_stop).toBe(true);
		expect(result.reason).toBe("score_sufficient");
	});

	it("stops when target score exactly met", () => {
		const control = makeCycleControl({
			current_cycle: 3,
			target_score: 80,
			intermediate_results: [makeEvaluationResult({ overall_score: 80 })],
		});
		expect(shouldStopCycle(control).reason).toBe("score_sufficient");
	});

	it("does not stop when below target score with only 1 result", () => {
		const control = makeCycleControl({
			current_cycle: 1,
			target_score: 80,
			intermediate_results: [makeEvaluationResult({ overall_score: 60 })],
		});
		expect(shouldStopCycle(control).should_stop).toBe(false);
	});

	it("stops when improvement below threshold", () => {
		const control = makeCycleControl({
			current_cycle: 4,
			target_score: 80,
			min_improvement_per_cycle: 2,
			intermediate_results: [
				makeEvaluationResult({ overall_score: 58 }),
				makeEvaluationResult({ overall_score: 59 }), // +1 < 2
			],
		});
		const result = shouldStopCycle(control);
		expect(result.should_stop).toBe(true);
		expect(result.reason).toBe("no_more_improvements");
	});

	it("stops when score regresses", () => {
		const control = makeCycleControl({
			current_cycle: 4,
			target_score: 80,
			min_improvement_per_cycle: 2,
			intermediate_results: [
				makeEvaluationResult({ overall_score: 65 }),
				makeEvaluationResult({ overall_score: 63 }), // -2 < 2
			],
		});
		expect(shouldStopCycle(control).reason).toBe("no_more_improvements");
	});

	it("continues when improvement meets threshold", () => {
		const control = makeCycleControl({
			current_cycle: 3,
			target_score: 80,
			min_improvement_per_cycle: 2,
			intermediate_results: [
				makeEvaluationResult({ overall_score: 55 }),
				makeEvaluationResult({ overall_score: 60 }), // +5 >= 2
			],
		});
		expect(shouldStopCycle(control).should_stop).toBe(false);
	});

	it("checks max_cycles before other conditions", () => {
		// max_cycles reached AND score sufficient — max_cycles takes priority
		const control = makeCycleControl({
			current_cycle: 10,
			max_cycles: 10,
			target_score: 80,
			intermediate_results: [makeEvaluationResult({ overall_score: 90 })],
		});
		expect(shouldStopCycle(control).reason).toBe("max_cycles_reached");
	});

	it("handles custom max_cycles", () => {
		const control = makeCycleControl({
			current_cycle: 3,
			max_cycles: 3,
		});
		expect(shouldStopCycle(control).should_stop).toBe(true);
	});

	it("handles zero improvement threshold (always continues unless regress)", () => {
		const control = makeCycleControl({
			current_cycle: 5,
			target_score: 90,
			min_improvement_per_cycle: 0,
			intermediate_results: [
				makeEvaluationResult({ overall_score: 60 }),
				makeEvaluationResult({ overall_score: 60 }), // +0 >= 0, don't stop
			],
		});
		expect(shouldStopCycle(control).should_stop).toBe(false);
	});

	it("handles many cycles with gradual improvement", () => {
		const results = [];
		for (let i = 0; i < 5; i++) {
			results.push(makeEvaluationResult({ overall_score: 50 + i * 3 }));
		}
		const control = makeCycleControl({
			current_cycle: 5,
			target_score: 80,
			min_improvement_per_cycle: 2,
			intermediate_results: results,
		});
		// Last two: 59 → 62, improvement = 3 >= 2
		expect(shouldStopCycle(control).should_stop).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 10. Template Registry
// ══════════════════════════════════════════════════════════════════════

describe("TEMPLATE_REGISTRY", () => {
	it("contains exactly 3 templates", () => {
		expect(TEMPLATE_REGISTRY).toHaveLength(3);
	});

	it("has one template per site type", () => {
		const types = TEMPLATE_REGISTRY.map((t) => t.site_type);
		expect(types).toContain("manufacturer");
		expect(types).toContain("research");
		expect(types).toContain("generic");
		expect(new Set(types).size).toBe(3); // no duplicates
	});

	it("all templates have version 1.0", () => {
		for (const t of TEMPLATE_REGISTRY) {
			expect(t.version).toBe("1.0");
		}
	});

	it("all templates have 8 probes", () => {
		for (const t of TEMPLATE_REGISTRY) {
			expect(t.probe_count).toBe(8);
		}
	});

	it("all templates have 7 scoring dimensions", () => {
		for (const t of TEMPLATE_REGISTRY) {
			expect(t.scoring_dimensions).toHaveLength(7);
		}
	});

	it("template paths match expected pattern", () => {
		for (const t of TEMPLATE_REGISTRY) {
			expect(t.template_path).toMatch(
				/^evaluation-templates\/(manufacturer|research|generic)\.md$/,
			);
		}
	});

	it("labels match SITE_TYPE_LABELS", () => {
		for (const t of TEMPLATE_REGISTRY) {
			expect(t.label).toBe(SITE_TYPE_LABELS[t.site_type]);
		}
	});
});

describe("getTemplate", () => {
	it("returns manufacturer template", () => {
		const t = getTemplate("manufacturer");
		expect(t.site_type).toBe("manufacturer");
		expect(t.label).toBe("제조사 대표 Site");
	});

	it("returns research template", () => {
		const t = getTemplate("research");
		expect(t.site_type).toBe("research");
		expect(t.label).toBe("연구소 대표 Site");
	});

	it("returns generic template", () => {
		const t = getTemplate("generic");
		expect(t.site_type).toBe("generic");
		expect(t.label).toBe("기타");
	});

	it("throws for unknown site type", () => {
		expect(() => getTemplate("ecommerce" as any)).toThrow(
			"Unknown site type: ecommerce",
		);
	});

	it("returned template has correct scoring dimensions", () => {
		const t = getTemplate("manufacturer");
		expect(t.scoring_dimensions).toEqual(
			DEFAULT_SCORING_DIMENSIONS.manufacturer,
		);
	});
});
