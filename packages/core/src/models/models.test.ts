import { describe, expect, it } from "vitest";
import {
	AccuracyLevelSchema,
	// Agent Configuration
	AgentIdSchema,
	AgentPromptConfigSchema,
	AnalysisReportSchema,
	ChangeImpactSchema,
	ChangeRecordSchema,
	// Change Tracking
	ChangeTypeSchema,
	// Target & Content
	CompetitorEntrySchema,
	CompetitorGapSchema,
	ContentAnalysisSchema,
	ContentSnapshotSchema,
	ContextSlotSchema,
	CrawlerAccessResultSchema,
	CreateTargetSchema,
	// Agent Memory
	EffectivenessIndexSchema,
	ErrorEventSchema,
	ErrorTypeSchema,
	GEO_SCORE_WEIGHTS,
	// GEO Scoring
	GeoScorePerLLMSchema,
	GeoScoreSchema,
	GeoTimeSeriesSchema,
	InfoCategorySchema,
	InfoRecognitionItemSchema,
	InfoRecognitionPerLLMSchema,
	InfoRecognitionScoreSchema,
	LLMAuthConfigSchema,
	LLMModelConfigSchema,
	LLMPrioritySchema,
	LLMProbeSchema,
	LLMProviderConfigSchema,
	MachineReadabilitySchema,
	ModelRoleSchema,
	NotificationConfigSchema,
	OAuthConfigSchema,
	OptimizationPlanSchema,
	OptimizationTaskSchema,
	// Pipeline & Error Handling
	PipelineStageSchema,
	PipelineStateSchema,
	// LLM
	QueryTypeSchema,
	RetryPolicySchema,
	SemanticChangeRecordSchema,
	SeveritySchema,
	// Analysis & Planning
	StructureQualitySchema,
	StructuredDataAuditSchema,
	TargetProfileSchema,
	UpdateTargetSchema,
	ValidationLLMResultSchema,
	ValidationReportSchema,
	VerdictSchema,
} from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const UUID2 = "660e8400-e29b-41d4-a716-446655440001";
const UUID3 = "770e8400-e29b-41d4-a716-446655440002";
const NOW = "2026-03-17T12:00:00Z";
const URL_VALID = "https://example.com";

function makeInfoRecognitionPerLLM(overrides = {}) {
	return {
		llm_service: "chatgpt",
		recognized: true,
		llm_answer: "some answer",
		accuracy: "exact",
		detail: "matched exactly",
		...overrides,
	};
}

function makeInfoRecognitionItem(overrides = {}) {
	return {
		info_id: UUID,
		category: "PRICING",
		label: "Monthly price",
		expected_value: "$29/mo",
		llm_results: [makeInfoRecognitionPerLLM()],
		...overrides,
	};
}

function makeInfoRecognitionScore(overrides = {}) {
	return {
		overall: 85,
		items: [makeInfoRecognitionItem()],
		coverage_rate: 0.9,
		accuracy_rate: 0.85,
		...overrides,
	};
}

function makeGeoScore(overrides = {}) {
	return {
		total: 72,
		citation_rate: 80,
		citation_accuracy: 75,
		info_recognition_score: 60,
		coverage: 70,
		rank_position: 65,
		structured_score: 50,
		measured_at: NOW,
		llm_breakdown: {
			chatgpt: {
				llm_service: "chatgpt",
				citation_rate: 80,
				citation_accuracy: 75,
				rank_position: 2,
			},
		},
		...overrides,
	};
}

function makeLLMProbe(overrides = {}) {
	return {
		probe_id: UUID,
		llm_service: "chatgpt",
		model_version: "gpt-4",
		query: "What is X?",
		query_type: "citation_test",
		response_text: "X is ...",
		response_at: NOW,
		cited: true,
		citation_excerpt: "excerpt",
		citation_position: 1,
		accuracy_vs_source: 0.95,
		info_items_checked: [makeInfoRecognitionPerLLM()],
		...overrides,
	};
}

function makeEffectivenessIndex(overrides = {}) {
	return {
		url: URL_VALID,
		change_type: "CONTENT_DENSITY",
		llm_service: "chatgpt",
		sample_count: 10,
		avg_delta: 5.2,
		success_rate: 0.8,
		best_delta: 12,
		worst_delta: -3,
		last_updated: NOW,
		...overrides,
	};
}

function makeSemanticChangeRecord(overrides = {}) {
	return {
		change_id: UUID,
		embedding: [0.1, 0.2, 0.3],
		change_summary: "Added FAQ section",
		impact_verdict: "positive",
		delta: 5.5,
		lesson: "FAQ sections improve citation",
		...overrides,
	};
}

// ── Tests ────────────────────────────────────────────────────────────

describe("ChangeTypeSchema", () => {
	const allValues = [
		"CONTENT_DENSITY",
		"SEMANTIC_STRUCTURE",
		"SCHEMA_MARKUP",
		"LLMS_TXT",
		"FAQ_ADDITION",
		"AUTHORITY_SIGNAL",
		"METADATA",
		"CONTENT_CHUNKING",
		"READABILITY_FIX",
		"EXTERNAL",
	];

	it.each(allValues)("accepts valid enum value: %s", (val) => {
		expect(ChangeTypeSchema.safeParse(val).success).toBe(true);
	});

	it("rejects invalid value", () => {
		expect(ChangeTypeSchema.safeParse("INVALID").success).toBe(false);
	});

	it("rejects empty string", () => {
		expect(ChangeTypeSchema.safeParse("").success).toBe(false);
	});

	it("rejects number", () => {
		expect(ChangeTypeSchema.safeParse(42).success).toBe(false);
	});
});

// ── InfoRecognition ──────────────────────────────────────────────────

describe("InfoRecognition", () => {
	describe("InfoCategorySchema", () => {
		const allValues = [
			"PRODUCT_LIST",
			"PRODUCT_DETAIL",
			"PRICING",
			"FEATURE",
			"AVAILABILITY",
			"CONTACT",
			"POLICY",
			"STAT",
			"COMPARISON",
			"CUSTOM",
		];

		it.each(allValues)("accepts valid enum value: %s", (val) => {
			expect(InfoCategorySchema.safeParse(val).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(InfoCategorySchema.safeParse("UNKNOWN").success).toBe(false);
		});
	});

	describe("AccuracyLevelSchema", () => {
		const allValues = ["exact", "approximate", "outdated", "hallucinated", "missing"];

		it.each(allValues)("accepts valid enum value: %s", (val) => {
			expect(AccuracyLevelSchema.safeParse(val).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(AccuracyLevelSchema.safeParse("wrong").success).toBe(false);
		});
	});

	describe("InfoRecognitionPerLLMSchema", () => {
		it("accepts valid object", () => {
			expect(InfoRecognitionPerLLMSchema.safeParse(makeInfoRecognitionPerLLM()).success).toBe(true);
		});

		it("accepts null llm_answer", () => {
			expect(
				InfoRecognitionPerLLMSchema.safeParse(makeInfoRecognitionPerLLM({ llm_answer: null }))
					.success,
			).toBe(true);
		});

		it("accepts null detail", () => {
			expect(
				InfoRecognitionPerLLMSchema.safeParse(makeInfoRecognitionPerLLM({ detail: null })).success,
			).toBe(true);
		});

		it("rejects missing llm_service", () => {
			const { llm_service, ...rest } = makeInfoRecognitionPerLLM();
			expect(InfoRecognitionPerLLMSchema.safeParse(rest).success).toBe(false);
		});

		it("rejects invalid accuracy", () => {
			expect(
				InfoRecognitionPerLLMSchema.safeParse(makeInfoRecognitionPerLLM({ accuracy: "wrong" }))
					.success,
			).toBe(false);
		});
	});

	describe("InfoRecognitionItemSchema", () => {
		it("accepts valid object with llm_results array", () => {
			expect(InfoRecognitionItemSchema.safeParse(makeInfoRecognitionItem()).success).toBe(true);
		});

		it("rejects invalid uuid for info_id", () => {
			expect(
				InfoRecognitionItemSchema.safeParse(makeInfoRecognitionItem({ info_id: "not-a-uuid" }))
					.success,
			).toBe(false);
		});

		it("rejects invalid category", () => {
			expect(
				InfoRecognitionItemSchema.safeParse(makeInfoRecognitionItem({ category: "INVALID" }))
					.success,
			).toBe(false);
		});

		it("accepts empty llm_results array", () => {
			expect(
				InfoRecognitionItemSchema.safeParse(makeInfoRecognitionItem({ llm_results: [] })).success,
			).toBe(true);
		});

		it("rejects missing required fields", () => {
			expect(InfoRecognitionItemSchema.safeParse({}).success).toBe(false);
		});
	});

	describe("InfoRecognitionScoreSchema", () => {
		it("accepts valid object", () => {
			expect(InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore()).success).toBe(true);
		});

		it("accepts overall at boundary 0", () => {
			expect(
				InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore({ overall: 0 })).success,
			).toBe(true);
		});

		it("accepts overall at boundary 100", () => {
			expect(
				InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore({ overall: 100 })).success,
			).toBe(true);
		});

		it("rejects overall > 100", () => {
			expect(
				InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore({ overall: 101 })).success,
			).toBe(false);
		});

		it("rejects negative overall", () => {
			expect(
				InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore({ overall: -1 })).success,
			).toBe(false);
		});

		it("rejects coverage_rate > 1", () => {
			expect(
				InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore({ coverage_rate: 1.1 }))
					.success,
			).toBe(false);
		});

		it("rejects negative accuracy_rate", () => {
			expect(
				InfoRecognitionScoreSchema.safeParse(makeInfoRecognitionScore({ accuracy_rate: -0.1 }))
					.success,
			).toBe(false);
		});
	});
});

// ── LLMProbe ─────────────────────────────────────────────────────────

describe("LLMProbe", () => {
	describe("QueryTypeSchema", () => {
		const allValues = [
			"citation_test",
			"accuracy_test",
			"info_recognition",
			"sentiment_test",
			"competitor_compare",
		];

		it.each(allValues)("accepts valid enum value: %s", (val) => {
			expect(QueryTypeSchema.safeParse(val).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(QueryTypeSchema.safeParse("unknown_test").success).toBe(false);
		});
	});

	describe("LLMProbeSchema", () => {
		it("accepts valid complete object", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe()).success).toBe(true);
		});

		it("accepts null citation_excerpt", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ citation_excerpt: null })).success).toBe(true);
		});

		it("accepts null citation_position", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ citation_position: null })).success).toBe(
				true,
			);
		});

		it("rejects missing required probe_id", () => {
			const { probe_id, ...rest } = makeLLMProbe();
			expect(LLMProbeSchema.safeParse(rest).success).toBe(false);
		});

		it("rejects invalid uuid for probe_id", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ probe_id: "bad" })).success).toBe(false);
		});

		it("rejects accuracy_vs_source > 1", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ accuracy_vs_source: 1.5 })).success).toBe(
				false,
			);
		});

		it("rejects negative accuracy_vs_source", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ accuracy_vs_source: -0.1 })).success).toBe(
				false,
			);
		});

		it("rejects invalid datetime for response_at", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ response_at: "not-a-date" })).success).toBe(
				false,
			);
		});

		it("rejects invalid query_type", () => {
			expect(LLMProbeSchema.safeParse(makeLLMProbe({ query_type: "invalid" })).success).toBe(false);
		});
	});
});

// ── GeoScore ─────────────────────────────────────────────────────────

describe("GeoScore", () => {
	describe("GeoScorePerLLMSchema", () => {
		it("accepts valid object", () => {
			const data = {
				llm_service: "chatgpt",
				citation_rate: 80,
				citation_accuracy: 75,
				rank_position: 2,
			};
			expect(GeoScorePerLLMSchema.safeParse(data).success).toBe(true);
		});

		it("accepts null rank_position", () => {
			const data = {
				llm_service: "chatgpt",
				citation_rate: 80,
				citation_accuracy: 75,
				rank_position: null,
			};
			expect(GeoScorePerLLMSchema.safeParse(data).success).toBe(true);
		});

		it("accepts optional info_recognition", () => {
			const data = {
				llm_service: "chatgpt",
				citation_rate: 80,
				citation_accuracy: 75,
				rank_position: null,
				info_recognition: makeInfoRecognitionScore(),
			};
			expect(GeoScorePerLLMSchema.safeParse(data).success).toBe(true);
		});

		it("rejects citation_rate > 100", () => {
			const data = {
				llm_service: "chatgpt",
				citation_rate: 101,
				citation_accuracy: 75,
				rank_position: null,
			};
			expect(GeoScorePerLLMSchema.safeParse(data).success).toBe(false);
		});

		it("rejects negative citation_accuracy", () => {
			const data = {
				llm_service: "chatgpt",
				citation_rate: 80,
				citation_accuracy: -1,
				rank_position: null,
			};
			expect(GeoScorePerLLMSchema.safeParse(data).success).toBe(false);
		});
	});

	describe("GeoScoreSchema", () => {
		it("accepts valid complete object", () => {
			expect(GeoScoreSchema.safeParse(makeGeoScore()).success).toBe(true);
		});

		it("accepts boundary values at 0", () => {
			expect(
				GeoScoreSchema.safeParse(
					makeGeoScore({
						total: 0,
						citation_rate: 0,
						citation_accuracy: 0,
						info_recognition_score: 0,
						coverage: 0,
						rank_position: 0,
						structured_score: 0,
					}),
				).success,
			).toBe(true);
		});

		it("accepts boundary values at 100", () => {
			expect(
				GeoScoreSchema.safeParse(
					makeGeoScore({
						total: 100,
						citation_rate: 100,
						citation_accuracy: 100,
						info_recognition_score: 100,
						coverage: 100,
						rank_position: 100,
						structured_score: 100,
					}),
				).success,
			).toBe(true);
		});

		it("rejects total > 100", () => {
			expect(GeoScoreSchema.safeParse(makeGeoScore({ total: 101 })).success).toBe(false);
		});

		it("rejects negative total", () => {
			expect(GeoScoreSchema.safeParse(makeGeoScore({ total: -1 })).success).toBe(false);
		});

		it("accepts optional info_recognition", () => {
			expect(
				GeoScoreSchema.safeParse(makeGeoScore({ info_recognition: makeInfoRecognitionScore() }))
					.success,
			).toBe(true);
		});

		it("accepts empty llm_breakdown", () => {
			expect(GeoScoreSchema.safeParse(makeGeoScore({ llm_breakdown: {} })).success).toBe(true);
		});

		it("rejects invalid datetime for measured_at", () => {
			expect(GeoScoreSchema.safeParse(makeGeoScore({ measured_at: "bad" })).success).toBe(false);
		});
	});

	describe("GEO_SCORE_WEIGHTS", () => {
		it("weights sum to 1.0", () => {
			const sum = Object.values(GEO_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1.0, 10);
		});

		it("has all expected keys", () => {
			expect(GEO_SCORE_WEIGHTS).toHaveProperty("citation_rate", 0.25);
			expect(GEO_SCORE_WEIGHTS).toHaveProperty("citation_accuracy", 0.2);
			expect(GEO_SCORE_WEIGHTS).toHaveProperty("info_recognition_score", 0.2);
			expect(GEO_SCORE_WEIGHTS).toHaveProperty("coverage", 0.15);
			expect(GEO_SCORE_WEIGHTS).toHaveProperty("rank_position", 0.1);
			expect(GEO_SCORE_WEIGHTS).toHaveProperty("structured_score", 0.1);
		});
	});
});

// ── TargetProfile ────────────────────────────────────────────────────

describe("TargetProfile", () => {
	describe("CompetitorEntrySchema", () => {
		it("accepts valid object", () => {
			const data = { url: URL_VALID, name: "Acme", relationship: "direct" };
			expect(CompetitorEntrySchema.safeParse(data).success).toBe(true);
		});

		it("accepts all relationship values", () => {
			for (const rel of ["direct", "indirect", "reference"]) {
				expect(
					CompetitorEntrySchema.safeParse({ url: URL_VALID, name: "X", relationship: rel }).success,
				).toBe(true);
			}
		});

		it("rejects invalid url", () => {
			expect(
				CompetitorEntrySchema.safeParse({ url: "not-a-url", name: "X", relationship: "direct" })
					.success,
			).toBe(false);
		});

		it("rejects invalid relationship", () => {
			expect(
				CompetitorEntrySchema.safeParse({ url: URL_VALID, name: "X", relationship: "enemy" })
					.success,
			).toBe(false);
		});
	});

	describe("LLMPrioritySchema", () => {
		it("accepts valid object", () => {
			expect(
				LLMPrioritySchema.safeParse({ llm_service: "chatgpt", priority: "critical" }).success,
			).toBe(true);
		});

		it.each(["critical", "important", "nice_to_have", "monitor_only"])(
			"accepts priority: %s",
			(p) => {
				expect(LLMPrioritySchema.safeParse({ llm_service: "x", priority: p }).success).toBe(true);
			},
		);

		it("rejects invalid priority", () => {
			expect(LLMPrioritySchema.safeParse({ llm_service: "x", priority: "unknown" }).success).toBe(
				false,
			);
		});
	});

	describe("NotificationConfigSchema", () => {
		it("applies all defaults when given empty object", () => {
			const result = NotificationConfigSchema.safeParse({});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.on_score_drop).toBe(true);
				expect(result.data.on_external_change).toBe(true);
				expect(result.data.on_optimization_complete).toBe(true);
				expect(result.data.channels).toEqual(["dashboard"]);
			}
		});

		it("overrides defaults", () => {
			const result = NotificationConfigSchema.safeParse({
				on_score_drop: false,
				channels: ["email", "slack"],
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.on_score_drop).toBe(false);
				expect(result.data.channels).toEqual(["email", "slack"]);
			}
		});

		it("rejects invalid channel", () => {
			expect(NotificationConfigSchema.safeParse({ channels: ["telegram"] }).success).toBe(false);
		});
	});

	describe("TargetProfileSchema", () => {
		const validProfile = {
			id: UUID,
			url: URL_VALID,
			name: "My Site",
			created_at: NOW,
			updated_at: NOW,
		};

		it("accepts full valid object with defaults", () => {
			const result = TargetProfileSchema.safeParse(validProfile);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.description).toBe("");
				expect(result.data.topics).toEqual([]);
				expect(result.data.status).toBe("active");
				expect(result.data.site_type).toBe("generic");
				expect(result.data.monitoring_interval).toBe("6h");
			}
		});

		it("accepts fully populated object", () => {
			const full = {
				...validProfile,
				description: "A website",
				topics: ["seo"],
				target_queries: ["what is X"],
				audience: "developers",
				competitors: [{ url: URL_VALID, name: "Rival", relationship: "direct" }],
				business_goal: "leads",
				llm_priorities: [{ llm_service: "chatgpt", priority: "critical" }],
				clone_base_path: null,
				site_type: "manufacturer",
				notifications: { on_score_drop: false, channels: ["email"] },
				status: "paused",
				monitoring_interval: "12h",
			};
			expect(TargetProfileSchema.safeParse(full).success).toBe(true);
		});

		it("rejects invalid url", () => {
			expect(TargetProfileSchema.safeParse({ ...validProfile, url: "not-a-url" }).success).toBe(
				false,
			);
		});

		it("rejects empty name (min 1)", () => {
			expect(TargetProfileSchema.safeParse({ ...validProfile, name: "" }).success).toBe(false);
		});

		it("rejects missing required id", () => {
			const { id, ...rest } = validProfile;
			expect(TargetProfileSchema.safeParse(rest).success).toBe(false);
		});

		it("rejects invalid status", () => {
			expect(TargetProfileSchema.safeParse({ ...validProfile, status: "deleted" }).success).toBe(
				false,
			);
		});

		it("strips extra fields", () => {
			const result = TargetProfileSchema.safeParse({ ...validProfile, extra_field: "hi" });
			expect(result.success).toBe(true);
			if (result.success) {
				expect((result.data as Record<string, unknown>).extra_field).toBeUndefined();
			}
		});
	});

	describe("CreateTargetSchema", () => {
		it("accepts minimal required fields (url + name)", () => {
			const result = CreateTargetSchema.safeParse({ url: URL_VALID, name: "Site" });
			expect(result.success).toBe(true);
		});

		it("accepts optional fields", () => {
			const result = CreateTargetSchema.safeParse({
				url: URL_VALID,
				name: "Site",
				description: "A site",
				topics: ["tech"],
				site_type: "manufacturer",
			});
			expect(result.success).toBe(true);
		});

		it("rejects missing url", () => {
			expect(CreateTargetSchema.safeParse({ name: "Site" }).success).toBe(false);
		});

		it("rejects missing name", () => {
			expect(CreateTargetSchema.safeParse({ url: URL_VALID }).success).toBe(false);
		});
	});

	describe("UpdateTargetSchema", () => {
		it("accepts empty object (all optional)", () => {
			expect(UpdateTargetSchema.safeParse({}).success).toBe(true);
		});

		it("accepts partial update", () => {
			expect(UpdateTargetSchema.safeParse({ name: "New Name" }).success).toBe(true);
		});

		it("rejects invalid url if provided", () => {
			expect(UpdateTargetSchema.safeParse({ url: "bad" }).success).toBe(false);
		});
	});
});

// ── ContentSnapshot ──────────────────────────────────────────────────

describe("ContentSnapshotSchema", () => {
	const validSnapshot = {
		snapshot_id: UUID,
		url: URL_VALID,
		target_id: UUID2,
		captured_at: NOW,
		html_hash: "abc123hash",
		content_text: "Page content here",
		structured_data: { "@type": "Organization" },
	};

	it("accepts valid complete object", () => {
		expect(ContentSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
	});

	it("accepts optional geo_score", () => {
		expect(
			ContentSnapshotSchema.safeParse({ ...validSnapshot, geo_score: makeGeoScore() }).success,
		).toBe(true);
	});

	it("defaults llm_responses to empty array", () => {
		const result = ContentSnapshotSchema.safeParse(validSnapshot);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.llm_responses).toEqual([]);
		}
	});

	it("accepts llm_responses with probes", () => {
		expect(
			ContentSnapshotSchema.safeParse({
				...validSnapshot,
				llm_responses: [makeLLMProbe()],
			}).success,
		).toBe(true);
	});

	it("rejects invalid url", () => {
		expect(ContentSnapshotSchema.safeParse({ ...validSnapshot, url: "not-url" }).success).toBe(
			false,
		);
	});

	it("rejects invalid uuid for snapshot_id", () => {
		expect(ContentSnapshotSchema.safeParse({ ...validSnapshot, snapshot_id: "bad" }).success).toBe(
			false,
		);
	});
});

// ── ChangeRecord ─────────────────────────────────────────────────────

describe("ChangeRecordSchema", () => {
	const validRecord = {
		change_id: UUID,
		experiment_id: UUID2,
		url: URL_VALID,
		target_id: UUID3,
		changed_at: NOW,
		change_type: "SCHEMA_MARKUP",
		change_summary: "Added JSON-LD",
		diff: "--- a\n+++ b",
		snapshot_before: UUID,
		snapshot_after: UUID2,
		triggered_by: "auto",
		strategy_ref: UUID3,
	};

	it("accepts valid object with all fields", () => {
		expect(ChangeRecordSchema.safeParse(validRecord).success).toBe(true);
	});

	it("accepts null snapshot_after", () => {
		expect(ChangeRecordSchema.safeParse({ ...validRecord, snapshot_after: null }).success).toBe(
			true,
		);
	});

	it("accepts null strategy_ref", () => {
		expect(ChangeRecordSchema.safeParse({ ...validRecord, strategy_ref: null }).success).toBe(true);
	});

	it("rejects invalid change_type", () => {
		expect(ChangeRecordSchema.safeParse({ ...validRecord, change_type: "UNKNOWN" }).success).toBe(
			false,
		);
	});

	it("rejects invalid triggered_by", () => {
		expect(ChangeRecordSchema.safeParse({ ...validRecord, triggered_by: "cron" }).success).toBe(
			false,
		);
	});

	it("rejects missing required fields", () => {
		expect(ChangeRecordSchema.safeParse({}).success).toBe(false);
	});
});

// ── ChangeImpact ─────────────────────────────────────────────────────

describe("ChangeImpact", () => {
	describe("VerdictSchema", () => {
		it.each(["positive", "negative", "neutral"])("accepts: %s", (v) => {
			expect(VerdictSchema.safeParse(v).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(VerdictSchema.safeParse("mixed").success).toBe(false);
		});
	});

	describe("ChangeImpactSchema", () => {
		const validImpact = {
			change_id: UUID,
			measured_at: NOW,
			score_before: 60,
			score_after: 75,
			delta: 15,
			delta_pct: 25,
			per_llm_impact: { chatgpt: 10, perplexity: 20 },
			confidence: 0.85,
			confounders: ["algorithm update"],
			verdict: "positive",
		};

		it("accepts valid object", () => {
			expect(ChangeImpactSchema.safeParse(validImpact).success).toBe(true);
		});

		it("accepts empty per_llm_impact", () => {
			expect(ChangeImpactSchema.safeParse({ ...validImpact, per_llm_impact: {} }).success).toBe(
				true,
			);
		});

		it("accepts empty confounders", () => {
			expect(ChangeImpactSchema.safeParse({ ...validImpact, confounders: [] }).success).toBe(true);
		});

		it("rejects confidence > 1", () => {
			expect(ChangeImpactSchema.safeParse({ ...validImpact, confidence: 1.1 }).success).toBe(false);
		});

		it("rejects negative confidence", () => {
			expect(ChangeImpactSchema.safeParse({ ...validImpact, confidence: -0.1 }).success).toBe(
				false,
			);
		});

		it("rejects score_before > 100", () => {
			expect(ChangeImpactSchema.safeParse({ ...validImpact, score_before: 101 }).success).toBe(
				false,
			);
		});

		it("rejects negative score_after", () => {
			expect(ChangeImpactSchema.safeParse({ ...validImpact, score_after: -1 }).success).toBe(false);
		});

		it("accepts negative delta (score went down)", () => {
			expect(
				ChangeImpactSchema.safeParse({ ...validImpact, delta: -10, delta_pct: -15 }).success,
			).toBe(true);
		});
	});
});

// ── GeoTimeSeries ────────────────────────────────────────────────────

describe("GeoTimeSeriesSchema", () => {
	const validEntry = {
		url: URL_VALID,
		llm_service: "chatgpt",
		measured_at: NOW,
		geo_score: 72,
		citation_rate: 0.8,
		citation_rank: 3,
		change_id: UUID,
		delta_score: 5.2,
	};

	it("accepts valid object", () => {
		expect(GeoTimeSeriesSchema.safeParse(validEntry).success).toBe(true);
	});

	it("accepts null citation_rank", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, citation_rank: null }).success).toBe(
			true,
		);
	});

	it("accepts null change_id", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, change_id: null }).success).toBe(true);
	});

	it("rejects geo_score > 100", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, geo_score: 101 }).success).toBe(false);
	});

	it("rejects negative geo_score", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, geo_score: -1 }).success).toBe(false);
	});

	it("rejects citation_rate > 1", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, citation_rate: 1.1 }).success).toBe(
			false,
		);
	});

	it("rejects non-positive citation_rank", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, citation_rank: 0 }).success).toBe(false);
	});

	it("rejects non-integer citation_rank", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, citation_rank: 1.5 }).success).toBe(
			false,
		);
	});

	it("rejects invalid url", () => {
		expect(GeoTimeSeriesSchema.safeParse({ ...validEntry, url: "bad" }).success).toBe(false);
	});
});

// ── AnalysisReport ───────────────────────────────────────────────────

describe("AnalysisReport", () => {
	describe("StructureQualitySchema", () => {
		const valid = {
			semantic_tag_ratio: 0.7,
			div_nesting_depth: 5,
			text_to_markup_ratio: 3.5,
			heading_hierarchy_valid: true,
		};

		it("accepts valid object", () => {
			expect(StructureQualitySchema.safeParse(valid).success).toBe(true);
		});

		it("rejects semantic_tag_ratio > 1", () => {
			expect(StructureQualitySchema.safeParse({ ...valid, semantic_tag_ratio: 1.1 }).success).toBe(
				false,
			);
		});

		it("rejects negative div_nesting_depth", () => {
			expect(StructureQualitySchema.safeParse({ ...valid, div_nesting_depth: -1 }).success).toBe(
				false,
			);
		});

		it("rejects non-integer div_nesting_depth", () => {
			expect(StructureQualitySchema.safeParse({ ...valid, div_nesting_depth: 2.5 }).success).toBe(
				false,
			);
		});
	});

	describe("CrawlerAccessResultSchema", () => {
		const valid = {
			user_agent: "Googlebot",
			http_status: 200,
			blocked_by_robots_txt: false,
			content_accessible: true,
		};

		it("accepts valid object", () => {
			expect(CrawlerAccessResultSchema.safeParse(valid).success).toBe(true);
		});

		it("rejects non-integer http_status", () => {
			expect(CrawlerAccessResultSchema.safeParse({ ...valid, http_status: 200.5 }).success).toBe(
				false,
			);
		});
	});

	describe("MachineReadabilitySchema", () => {
		const structureQuality = {
			semantic_tag_ratio: 0.7,
			div_nesting_depth: 5,
			text_to_markup_ratio: 3.5,
			heading_hierarchy_valid: true,
		};

		const crawlerAccess = {
			user_agent: "Googlebot",
			http_status: 200,
			blocked_by_robots_txt: false,
			content_accessible: true,
		};

		it.each(["A", "B", "C", "F"])("accepts grade: %s", (grade) => {
			expect(
				MachineReadabilitySchema.safeParse({
					grade,
					js_dependency_ratio: 0.3,
					structure_quality: structureQuality,
					crawler_access: [crawlerAccess],
				}).success,
			).toBe(true);
		});

		it("rejects invalid grade", () => {
			expect(
				MachineReadabilitySchema.safeParse({
					grade: "D",
					js_dependency_ratio: 0.3,
					structure_quality: structureQuality,
					crawler_access: [],
				}).success,
			).toBe(false);
		});

		it("rejects js_dependency_ratio > 1", () => {
			expect(
				MachineReadabilitySchema.safeParse({
					grade: "A",
					js_dependency_ratio: 1.1,
					structure_quality: structureQuality,
					crawler_access: [],
				}).success,
			).toBe(false);
		});
	});

	describe("ContentAnalysisSchema", () => {
		const valid = {
			word_count: 500,
			content_density: 75,
			readability_level: "general",
			key_topics_found: ["seo", "ai"],
			topic_alignment: 0.8,
		};

		it("accepts valid object", () => {
			expect(ContentAnalysisSchema.safeParse(valid).success).toBe(true);
		});

		it.each(["technical", "general", "simplified"])("accepts readability_level: %s", (level) => {
			expect(ContentAnalysisSchema.safeParse({ ...valid, readability_level: level }).success).toBe(
				true,
			);
		});

		it("rejects negative word_count", () => {
			expect(ContentAnalysisSchema.safeParse({ ...valid, word_count: -1 }).success).toBe(false);
		});

		it("rejects content_density > 100", () => {
			expect(ContentAnalysisSchema.safeParse({ ...valid, content_density: 101 }).success).toBe(
				false,
			);
		});

		it("rejects topic_alignment > 1", () => {
			expect(ContentAnalysisSchema.safeParse({ ...valid, topic_alignment: 1.1 }).success).toBe(
				false,
			);
		});
	});

	describe("StructuredDataAuditSchema", () => {
		const valid = {
			json_ld_present: true,
			json_ld_types: ["Organization", "WebPage"],
			schema_completeness: 0.9,
			og_tags_present: true,
			meta_description: "A site about AI",
		};

		it("accepts valid object", () => {
			expect(StructuredDataAuditSchema.safeParse(valid).success).toBe(true);
		});

		it("accepts null meta_description", () => {
			expect(
				StructuredDataAuditSchema.safeParse({ ...valid, meta_description: null }).success,
			).toBe(true);
		});

		it("rejects schema_completeness > 1", () => {
			expect(
				StructuredDataAuditSchema.safeParse({ ...valid, schema_completeness: 1.1 }).success,
			).toBe(false);
		});
	});

	describe("CompetitorGapSchema", () => {
		const valid = {
			competitor_url: URL_VALID,
			competitor_name: "Rival",
			competitor_geo_score: makeGeoScore(),
			gap_delta: -5,
			key_advantages: ["better schema"],
			key_weaknesses: ["less content"],
		};

		it("accepts valid object", () => {
			expect(CompetitorGapSchema.safeParse(valid).success).toBe(true);
		});

		it("accepts null competitor_geo_score", () => {
			expect(CompetitorGapSchema.safeParse({ ...valid, competitor_geo_score: null }).success).toBe(
				true,
			);
		});

		it("rejects invalid url", () => {
			expect(CompetitorGapSchema.safeParse({ ...valid, competitor_url: "bad" }).success).toBe(
				false,
			);
		});
	});

	describe("AnalysisReportSchema", () => {
		const fullReport = {
			report_id: UUID,
			target_id: UUID2,
			url: URL_VALID,
			analyzed_at: NOW,
			machine_readability: {
				grade: "A",
				js_dependency_ratio: 0.2,
				structure_quality: {
					semantic_tag_ratio: 0.8,
					div_nesting_depth: 3,
					text_to_markup_ratio: 4.0,
					heading_hierarchy_valid: true,
				},
				crawler_access: [
					{
						user_agent: "Googlebot",
						http_status: 200,
						blocked_by_robots_txt: false,
						content_accessible: true,
					},
				],
			},
			content_analysis: {
				word_count: 1200,
				content_density: 65,
				readability_level: "general",
				key_topics_found: ["AI", "SEO"],
				topic_alignment: 0.85,
			},
			structured_data: {
				json_ld_present: true,
				json_ld_types: ["Organization"],
				schema_completeness: 0.75,
				og_tags_present: true,
				meta_description: "Description",
			},
			extracted_info_items: [makeInfoRecognitionItem()],
			current_geo_score: makeGeoScore(),
			competitor_gaps: [],
			llm_status: [makeLLMProbe()],
		};

		it("accepts full valid report", () => {
			expect(AnalysisReportSchema.safeParse(fullReport).success).toBe(true);
		});

		it("rejects missing machine_readability", () => {
			const { machine_readability, ...rest } = fullReport;
			expect(AnalysisReportSchema.safeParse(rest).success).toBe(false);
		});

		it("rejects invalid nested structure", () => {
			expect(
				AnalysisReportSchema.safeParse({
					...fullReport,
					machine_readability: { ...fullReport.machine_readability, grade: "Z" },
				}).success,
			).toBe(false);
		});
	});
});

// ── OptimizationPlan ─────────────────────────────────────────────────

describe("OptimizationPlan", () => {
	describe("OptimizationTaskSchema", () => {
		const validTask = {
			task_id: UUID,
			order: 0,
			change_type: "FAQ_ADDITION",
			title: "Add FAQ",
			description: "Add a FAQ section",
			target_element: "main > section",
			priority: "high",
			info_recognition_ref: null,
			status: "pending",
			change_record_ref: null,
		};

		it("accepts valid object with all fields", () => {
			expect(OptimizationTaskSchema.safeParse(validTask).success).toBe(true);
		});

		it("accepts null target_element", () => {
			expect(OptimizationTaskSchema.safeParse({ ...validTask, target_element: null }).success).toBe(
				true,
			);
		});

		it.each(["pending", "in_progress", "completed", "skipped", "failed"])(
			"accepts status: %s",
			(s) => {
				expect(OptimizationTaskSchema.safeParse({ ...validTask, status: s }).success).toBe(true);
			},
		);

		it.each(["critical", "high", "medium", "low"])("accepts priority: %s", (p) => {
			expect(OptimizationTaskSchema.safeParse({ ...validTask, priority: p }).success).toBe(true);
		});

		it("rejects negative order", () => {
			expect(OptimizationTaskSchema.safeParse({ ...validTask, order: -1 }).success).toBe(false);
		});

		it("rejects non-integer order", () => {
			expect(OptimizationTaskSchema.safeParse({ ...validTask, order: 1.5 }).success).toBe(false);
		});
	});

	describe("OptimizationPlanSchema", () => {
		const validPlan = {
			plan_id: UUID,
			target_id: UUID2,
			created_at: NOW,
			analysis_report_ref: UUID3,
			strategy_rationale: "Improve citations by adding structured data",
			memory_context: {
				effectiveness_data: [makeEffectivenessIndex()],
				similar_cases: [makeSemanticChangeRecord()],
				negative_patterns: ["avoid keyword stuffing"],
			},
			tasks: [
				{
					task_id: UUID,
					order: 0,
					change_type: "SCHEMA_MARKUP",
					title: "Add schema",
					description: "Add JSON-LD",
					target_element: null,
					priority: "high",
					info_recognition_ref: null,
					status: "pending",
					change_record_ref: null,
				},
			],
			estimated_impact: {
				expected_delta: 8.5,
				confidence: 0.7,
				rationale: "Based on similar past changes",
			},
			status: "draft",
		};

		it("accepts valid plan", () => {
			expect(OptimizationPlanSchema.safeParse(validPlan).success).toBe(true);
		});

		it("accepts empty tasks array", () => {
			expect(OptimizationPlanSchema.safeParse({ ...validPlan, tasks: [] }).success).toBe(true);
		});

		it.each(["draft", "approved", "executing", "completed", "cancelled"])(
			"accepts status: %s",
			(s) => {
				expect(OptimizationPlanSchema.safeParse({ ...validPlan, status: s }).success).toBe(true);
			},
		);

		it("rejects estimated_impact confidence > 1", () => {
			expect(
				OptimizationPlanSchema.safeParse({
					...validPlan,
					estimated_impact: { ...validPlan.estimated_impact, confidence: 1.5 },
				}).success,
			).toBe(false);
		});

		it("rejects missing strategy_rationale", () => {
			const { strategy_rationale, ...rest } = validPlan;
			expect(OptimizationPlanSchema.safeParse(rest).success).toBe(false);
		});
	});
});

// ── ValidationReport ─────────────────────────────────────────────────

describe("ValidationReport", () => {
	describe("ValidationLLMResultSchema", () => {
		const valid = {
			llm_service: "chatgpt",
			probes: [makeLLMProbe()],
			citation_rate: 0.8,
			citation_accuracy: 0.9,
			rank_position_avg: 2.5,
			info_recognition: [makeInfoRecognitionPerLLM()],
			delta_vs_before: 5.2,
		};

		it("accepts valid object", () => {
			expect(ValidationLLMResultSchema.safeParse(valid).success).toBe(true);
		});

		it("accepts null rank_position_avg", () => {
			expect(
				ValidationLLMResultSchema.safeParse({ ...valid, rank_position_avg: null }).success,
			).toBe(true);
		});

		it("rejects citation_rate > 1", () => {
			expect(ValidationLLMResultSchema.safeParse({ ...valid, citation_rate: 1.5 }).success).toBe(
				false,
			);
		});

		it("rejects negative citation_accuracy", () => {
			expect(
				ValidationLLMResultSchema.safeParse({ ...valid, citation_accuracy: -0.1 }).success,
			).toBe(false);
		});
	});

	describe("ValidationReportSchema", () => {
		const valid = {
			report_id: UUID,
			target_id: UUID2,
			plan_ref: UUID3,
			validated_at: NOW,
			score_before: makeGeoScore(),
			score_after: makeGeoScore({ total: 80 }),
			score_delta: 8,
			llm_results: [
				{
					llm_service: "chatgpt",
					probes: [makeLLMProbe()],
					citation_rate: 0.8,
					citation_accuracy: 0.9,
					rank_position_avg: 2.5,
					info_recognition: [makeInfoRecognitionPerLLM()],
					delta_vs_before: 5.2,
				},
			],
			info_recognition: makeInfoRecognitionScore(),
			verdict: "improved",
			summary: "Score improved after optimization",
			recommendations: ["Continue monitoring"],
		};

		it("accepts valid report", () => {
			expect(ValidationReportSchema.safeParse(valid).success).toBe(true);
		});

		it("accepts null plan_ref", () => {
			expect(ValidationReportSchema.safeParse({ ...valid, plan_ref: null }).success).toBe(true);
		});

		it.each(["improved", "unchanged", "degraded"])("accepts verdict: %s", (v) => {
			expect(ValidationReportSchema.safeParse({ ...valid, verdict: v }).success).toBe(true);
		});

		it("rejects invalid verdict", () => {
			expect(ValidationReportSchema.safeParse({ ...valid, verdict: "mixed" }).success).toBe(false);
		});

		it("rejects missing required fields", () => {
			expect(ValidationReportSchema.safeParse({}).success).toBe(false);
		});
	});
});

// ── EffectivenessIndex ───────────────────────────────────────────────

describe("EffectivenessIndexSchema", () => {
	it("accepts valid object with all numeric fields", () => {
		expect(EffectivenessIndexSchema.safeParse(makeEffectivenessIndex()).success).toBe(true);
	});

	it("accepts null llm_service", () => {
		expect(
			EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ llm_service: null })).success,
		).toBe(true);
	});

	it("rejects negative sample_count", () => {
		expect(
			EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ sample_count: -1 })).success,
		).toBe(false);
	});

	it("rejects non-integer sample_count", () => {
		expect(
			EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ sample_count: 1.5 })).success,
		).toBe(false);
	});

	it("rejects success_rate > 1", () => {
		expect(
			EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ success_rate: 1.1 })).success,
		).toBe(false);
	});

	it("rejects negative success_rate", () => {
		expect(
			EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ success_rate: -0.1 })).success,
		).toBe(false);
	});

	it("accepts negative avg_delta and worst_delta", () => {
		expect(
			EffectivenessIndexSchema.safeParse(
				makeEffectivenessIndex({ avg_delta: -3.5, worst_delta: -10 }),
			).success,
		).toBe(true);
	});

	it("rejects invalid url", () => {
		expect(EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ url: "bad" })).success).toBe(
			false,
		);
	});

	it("rejects invalid change_type", () => {
		expect(
			EffectivenessIndexSchema.safeParse(makeEffectivenessIndex({ change_type: "INVALID" }))
				.success,
		).toBe(false);
	});
});

// ── SemanticChangeRecord ─────────────────────────────────────────────

describe("SemanticChangeRecordSchema", () => {
	it("accepts valid object with embedding array", () => {
		expect(SemanticChangeRecordSchema.safeParse(makeSemanticChangeRecord()).success).toBe(true);
	});

	it("accepts empty embedding array", () => {
		expect(
			SemanticChangeRecordSchema.safeParse(makeSemanticChangeRecord({ embedding: [] })).success,
		).toBe(true);
	});

	it("accepts long embedding array", () => {
		const embedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
		expect(
			SemanticChangeRecordSchema.safeParse(makeSemanticChangeRecord({ embedding })).success,
		).toBe(true);
	});

	it("rejects non-number in embedding", () => {
		expect(
			SemanticChangeRecordSchema.safeParse(makeSemanticChangeRecord({ embedding: ["a", "b"] }))
				.success,
		).toBe(false);
	});

	it("rejects invalid impact_verdict", () => {
		expect(
			SemanticChangeRecordSchema.safeParse(makeSemanticChangeRecord({ impact_verdict: "unknown" }))
				.success,
		).toBe(false);
	});

	it("rejects missing required fields", () => {
		expect(SemanticChangeRecordSchema.safeParse({}).success).toBe(false);
	});
});

// ── AgentPromptConfig ────────────────────────────────────────────────

describe("AgentPromptConfig", () => {
	describe("AgentIdSchema", () => {
		const allValues = [
			"orchestrator",
			"analysis",
			"strategy",
			"optimization",
			"validation",
			"monitoring",
		];

		it.each(allValues)("accepts valid enum value: %s", (val) => {
			expect(AgentIdSchema.safeParse(val).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(AgentIdSchema.safeParse("unknown_agent").success).toBe(false);
		});

		it("rejects empty string", () => {
			expect(AgentIdSchema.safeParse("").success).toBe(false);
		});
	});

	describe("ContextSlotSchema", () => {
		const valid = {
			slot_name: "target_profile",
			description: "The target profile data",
			source: "database",
			required: true,
		};

		it("accepts valid object", () => {
			expect(ContextSlotSchema.safeParse(valid).success).toBe(true);
		});

		it("rejects missing required field", () => {
			const { slot_name, ...rest } = valid;
			expect(ContextSlotSchema.safeParse(rest).success).toBe(false);
		});
	});

	describe("AgentPromptConfigSchema", () => {
		const valid = {
			agent_id: "orchestrator",
			display_name: "Orchestrator Agent",
			system_instruction: "You are the orchestrator...",
			context_slots: [
				{
					slot_name: "target",
					description: "Target data",
					source: "db",
					required: true,
				},
			],
			model_preference: "gpt-4",
			last_modified: NOW,
		};

		it("accepts valid full object with defaults", () => {
			const result = AgentPromptConfigSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.temperature).toBe(0.3);
				expect(result.data.is_customized).toBe(false);
			}
		});

		it("accepts null model_preference", () => {
			expect(AgentPromptConfigSchema.safeParse({ ...valid, model_preference: null }).success).toBe(
				true,
			);
		});

		it("accepts custom temperature in range", () => {
			expect(AgentPromptConfigSchema.safeParse({ ...valid, temperature: 0.7 }).success).toBe(true);
		});

		it("rejects temperature > 1", () => {
			expect(AgentPromptConfigSchema.safeParse({ ...valid, temperature: 1.5 }).success).toBe(false);
		});

		it("rejects negative temperature", () => {
			expect(AgentPromptConfigSchema.safeParse({ ...valid, temperature: -0.1 }).success).toBe(
				false,
			);
		});

		it("rejects invalid agent_id", () => {
			expect(AgentPromptConfigSchema.safeParse({ ...valid, agent_id: "hacker" }).success).toBe(
				false,
			);
		});

		it("accepts empty context_slots", () => {
			expect(AgentPromptConfigSchema.safeParse({ ...valid, context_slots: [] }).success).toBe(true);
		});
	});
});

// ── ErrorEvent ───────────────────────────────────────────────────────

describe("ErrorEvent", () => {
	describe("ErrorTypeSchema", () => {
		const allValues = [
			"api_error",
			"timeout",
			"crawl_error",
			"deploy_error",
			"validation_regression",
			"system_error",
		];

		it.each(allValues)("accepts valid enum value: %s", (val) => {
			expect(ErrorTypeSchema.safeParse(val).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(ErrorTypeSchema.safeParse("network_error").success).toBe(false);
		});
	});

	describe("SeveritySchema", () => {
		it.each(["critical", "warning", "info"])("accepts: %s", (v) => {
			expect(SeveritySchema.safeParse(v).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(SeveritySchema.safeParse("debug").success).toBe(false);
		});
	});

	describe("ErrorEventSchema", () => {
		const valid = {
			error_id: UUID,
			timestamp: NOW,
			agent_id: "analysis",
			target_id: UUID2,
			error_type: "api_error",
			severity: "critical",
			message: "OpenAI API rate limit exceeded",
			context: { retry_count: 3, endpoint: "/v1/chat" },
		};

		it("accepts valid object with default resolved", () => {
			const result = ErrorEventSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.resolved).toBe(false);
			}
		});

		it("accepts explicit resolved=true", () => {
			expect(ErrorEventSchema.safeParse({ ...valid, resolved: true }).success).toBe(true);
		});

		it("accepts empty context object", () => {
			expect(ErrorEventSchema.safeParse({ ...valid, context: {} }).success).toBe(true);
		});

		it("accepts context with mixed value types", () => {
			expect(
				ErrorEventSchema.safeParse({
					...valid,
					context: { num: 1, str: "x", arr: [1, 2], nested: { a: 1 } },
				}).success,
			).toBe(true);
		});

		it("rejects invalid error_type", () => {
			expect(ErrorEventSchema.safeParse({ ...valid, error_type: "unknown" }).success).toBe(false);
		});

		it("rejects invalid severity", () => {
			expect(ErrorEventSchema.safeParse({ ...valid, severity: "debug" }).success).toBe(false);
		});

		it("rejects missing required fields", () => {
			expect(ErrorEventSchema.safeParse({}).success).toBe(false);
		});
	});
});

// ── LLMProviderConfig ────────────────────────────────────────────────

describe("LLMProviderConfig", () => {
	describe("OAuthConfigSchema", () => {
		const valid = {
			provider: "google",
			client_id_ref: "ref-id",
			client_secret_ref: "ref-secret",
			scopes: ["read", "write"],
			token_endpoint: "https://oauth.example.com/token",
		};

		it("accepts valid object with defaults", () => {
			const result = OAuthConfigSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.redirect_uri).toBe("http://localhost:3000/auth/callback");
				expect(result.data.access_token).toBeNull();
				expect(result.data.refresh_token).toBeNull();
				expect(result.data.expires_at).toBeNull();
			}
		});

		it.each(["google", "microsoft", "openai"])("accepts provider: %s", (p) => {
			expect(OAuthConfigSchema.safeParse({ ...valid, provider: p }).success).toBe(true);
		});

		it("rejects invalid provider", () => {
			expect(OAuthConfigSchema.safeParse({ ...valid, provider: "aws" }).success).toBe(false);
		});

		it("accepts null token_endpoint", () => {
			expect(OAuthConfigSchema.safeParse({ ...valid, token_endpoint: null }).success).toBe(true);
		});

		it("accepts explicit tokens", () => {
			expect(
				OAuthConfigSchema.safeParse({
					...valid,
					access_token: "tok_abc",
					refresh_token: "ref_xyz",
					expires_at: NOW,
				}).success,
			).toBe(true);
		});
	});

	describe("LLMAuthConfigSchema (discriminated union)", () => {
		it("accepts api_key method", () => {
			const data = { method: "api_key", api_key_ref: "sk-ref-123" };
			expect(LLMAuthConfigSchema.safeParse(data).success).toBe(true);
		});

		it("accepts oauth method", () => {
			const data = {
				method: "oauth",
				oauth_config: {
					provider: "openai",
					client_id_ref: "cid",
					client_secret_ref: "csec",
					scopes: ["chat"],
					token_endpoint: null,
				},
			};
			expect(LLMAuthConfigSchema.safeParse(data).success).toBe(true);
		});

		it("rejects unknown method", () => {
			expect(
				LLMAuthConfigSchema.safeParse({ method: "basic", username: "u", password: "p" }).success,
			).toBe(false);
		});

		it("rejects api_key method missing api_key_ref", () => {
			expect(LLMAuthConfigSchema.safeParse({ method: "api_key" }).success).toBe(false);
		});

		it("rejects oauth method missing oauth_config", () => {
			expect(LLMAuthConfigSchema.safeParse({ method: "oauth" }).success).toBe(false);
		});
	});

	describe("ModelRoleSchema", () => {
		it.each(["orchestration", "validation_target", "utility", "both"])("accepts: %s", (role) => {
			expect(ModelRoleSchema.safeParse(role).success).toBe(true);
		});

		it("rejects invalid role", () => {
			expect(ModelRoleSchema.safeParse("admin").success).toBe(false);
		});
	});

	describe("LLMModelConfigSchema", () => {
		const valid = {
			model_id: "gpt-4",
			display_name: "GPT-4",
			role: "orchestration",
			max_tokens: 8192,
			supports_tools: true,
			cost_per_1k_tokens: { input: 0.03, output: 0.06 },
		};

		it("accepts valid object with default is_default", () => {
			const result = LLMModelConfigSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.is_default).toBe(false);
			}
		});

		it("rejects non-positive max_tokens", () => {
			expect(LLMModelConfigSchema.safeParse({ ...valid, max_tokens: 0 }).success).toBe(false);
		});

		it("rejects non-integer max_tokens", () => {
			expect(LLMModelConfigSchema.safeParse({ ...valid, max_tokens: 100.5 }).success).toBe(false);
		});

		it("rejects negative cost", () => {
			expect(
				LLMModelConfigSchema.safeParse({
					...valid,
					cost_per_1k_tokens: { input: -0.01, output: 0.06 },
				}).success,
			).toBe(false);
		});
	});

	describe("LLMProviderConfigSchema", () => {
		const valid = {
			provider_id: "openai",
			display_name: "OpenAI",
			auth: { method: "api_key", api_key_ref: "sk-ref" },
			models: [
				{
					model_id: "gpt-4",
					display_name: "GPT-4",
					role: "orchestration",
					max_tokens: 8192,
					supports_tools: true,
					cost_per_1k_tokens: { input: 0.03, output: 0.06 },
				},
			],
			rate_limit: { requests_per_minute: 60, tokens_per_minute: 90000 },
		};

		it("accepts valid object with default enabled", () => {
			const result = LLMProviderConfigSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.enabled).toBe(true);
			}
		});

		it("accepts explicit enabled=false", () => {
			expect(LLMProviderConfigSchema.safeParse({ ...valid, enabled: false }).success).toBe(true);
		});

		it("accepts empty models array", () => {
			expect(LLMProviderConfigSchema.safeParse({ ...valid, models: [] }).success).toBe(true);
		});

		it("rejects non-positive rate_limit values", () => {
			expect(
				LLMProviderConfigSchema.safeParse({
					...valid,
					rate_limit: { requests_per_minute: 0, tokens_per_minute: 1000 },
				}).success,
			).toBe(false);
		});

		it("rejects non-integer rate_limit values", () => {
			expect(
				LLMProviderConfigSchema.safeParse({
					...valid,
					rate_limit: { requests_per_minute: 10.5, tokens_per_minute: 1000 },
				}).success,
			).toBe(false);
		});

		it("rejects missing auth", () => {
			const { auth, ...rest } = valid;
			expect(LLMProviderConfigSchema.safeParse(rest).success).toBe(false);
		});

		it("accepts oauth auth variant", () => {
			expect(
				LLMProviderConfigSchema.safeParse({
					...valid,
					auth: {
						method: "oauth",
						oauth_config: {
							provider: "microsoft",
							client_id_ref: "cid",
							client_secret_ref: "csec",
							scopes: ["chat"],
							token_endpoint: null,
						},
					},
				}).success,
			).toBe(true);
		});
	});
});

// ── PipelineState ────────────────────────────────────────────────────

describe("PipelineState", () => {
	describe("PipelineStageSchema", () => {
		const allValues = [
			"INIT",
			"ANALYZING",
			"STRATEGIZING",
			"OPTIMIZING",
			"VALIDATING",
			"COMPLETED",
			"FAILED",
			"PARTIAL_FAILURE",
		];

		it.each(allValues)("accepts valid enum value: %s", (val) => {
			expect(PipelineStageSchema.safeParse(val).success).toBe(true);
		});

		it("rejects invalid value", () => {
			expect(PipelineStageSchema.safeParse("RUNNING").success).toBe(false);
		});
	});

	describe("PipelineStateSchema", () => {
		const valid = {
			pipeline_id: UUID,
			target_id: UUID2,
			stage: "ANALYZING",
			started_at: NOW,
			updated_at: NOW,
			completed_at: null,
			analysis_report_ref: null,
			optimization_plan_ref: null,
			validation_report_ref: null,
			error_message: null,
		};

		it("accepts valid object with defaults", () => {
			const result = PipelineStateSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.retry_count).toBe(0);
				expect(result.data.resumable).toBe(false);
				expect(result.data.resume_from_stage).toBeNull();
			}
		});

		it("accepts fully populated object", () => {
			expect(
				PipelineStateSchema.safeParse({
					...valid,
					stage: "FAILED",
					completed_at: NOW,
					analysis_report_ref: UUID,
					optimization_plan_ref: UUID2,
					validation_report_ref: UUID3,
					retry_count: 2,
					error_message: "Timeout on LLM call",
					resumable: true,
					resume_from_stage: "OPTIMIZING",
				}).success,
			).toBe(true);
		});

		it("rejects negative retry_count", () => {
			expect(PipelineStateSchema.safeParse({ ...valid, retry_count: -1 }).success).toBe(false);
		});

		it("rejects invalid stage", () => {
			expect(PipelineStateSchema.safeParse({ ...valid, stage: "UNKNOWN" }).success).toBe(false);
		});

		it("rejects invalid uuid for pipeline_id", () => {
			expect(PipelineStateSchema.safeParse({ ...valid, pipeline_id: "bad" }).success).toBe(false);
		});

		it("rejects invalid datetime for started_at", () => {
			expect(PipelineStateSchema.safeParse({ ...valid, started_at: "not-a-date" }).success).toBe(
				false,
			);
		});
	});

	describe("RetryPolicySchema", () => {
		it("accepts empty object with all defaults", () => {
			const result = RetryPolicySchema.safeParse({});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.max_retries).toBe(3);
				expect(result.data.initial_delay_ms).toBe(1000);
				expect(result.data.backoff_multiplier).toBe(2.0);
				expect(result.data.max_delay_ms).toBe(30000);
				expect(result.data.retryable_errors).toEqual(["rate_limit", "timeout", "server_error"]);
				expect(result.data.non_retryable).toEqual([
					"auth_error",
					"invalid_request",
					"content_filter",
				]);
			}
		});

		it("accepts custom values", () => {
			const result = RetryPolicySchema.safeParse({
				max_retries: 5,
				initial_delay_ms: 500,
				backoff_multiplier: 1.5,
				max_delay_ms: 60000,
				retryable_errors: ["timeout"],
				non_retryable: ["auth_error"],
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.max_retries).toBe(5);
			}
		});

		it("rejects negative max_retries", () => {
			expect(RetryPolicySchema.safeParse({ max_retries: -1 }).success).toBe(false);
		});

		it("rejects non-positive initial_delay_ms", () => {
			expect(RetryPolicySchema.safeParse({ initial_delay_ms: 0 }).success).toBe(false);
		});

		it("rejects non-positive backoff_multiplier", () => {
			expect(RetryPolicySchema.safeParse({ backoff_multiplier: 0 }).success).toBe(false);
		});

		it("rejects non-positive max_delay_ms", () => {
			expect(RetryPolicySchema.safeParse({ max_delay_ms: 0 }).success).toBe(false);
		});

		it("rejects non-integer initial_delay_ms", () => {
			expect(RetryPolicySchema.safeParse({ initial_delay_ms: 100.5 }).success).toBe(false);
		});
	});
});
