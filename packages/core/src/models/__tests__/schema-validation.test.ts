import { describe, expect, it } from "vitest";
import {
	AgentPromptConfigSchema,
	ChangeImpactSchema,
	ChangeTypeSchema,
	CreateTargetSchema,
	EffectivenessIndexSchema,
	ErrorEventSchema,
	GEO_SCORE_WEIGHTS,
	GeoScoreSchema,
	GeoTimeSeriesSchema,
	InfoRecognitionScoreSchema,
	LLMProbeSchema,
	LLMProviderConfigSchema,
	PipelineStateSchema,
	TargetProfileSchema,
} from "../index.js";

describe("ChangeType", () => {
	it("should accept valid change types", () => {
		expect(ChangeTypeSchema.parse("CONTENT_DENSITY")).toBe("CONTENT_DENSITY");
		expect(ChangeTypeSchema.parse("EXTERNAL")).toBe("EXTERNAL");
	});

	it("should reject invalid change types", () => {
		expect(() => ChangeTypeSchema.parse("INVALID")).toThrow();
	});
});

describe("GeoScore", () => {
	it("should validate a complete GEO score", () => {
		const score = GeoScoreSchema.parse({
			total: 75,
			citation_rate: 80,
			citation_accuracy: 70,
			info_recognition_score: 78,
			coverage: 60,
			rank_position: 85,
			structured_score: 90,
			info_recognition: {
				overall: 78,
				items: [],
				coverage_rate: 0.85,
				accuracy_rate: 0.91,
			},
			measured_at: "2026-03-17T00:00:00Z",
			llm_breakdown: {},
		});
		expect(score.total).toBe(75);
	});

	it("should reject scores out of range", () => {
		expect(() =>
			GeoScoreSchema.parse({
				total: 150, // out of 0-100
				citation_rate: 80,
				citation_accuracy: 70,
				info_recognition_score: 78,
				coverage: 60,
				rank_position: 85,
				structured_score: 90,
				info_recognition: { overall: 78, items: [], coverage_rate: 0.85, accuracy_rate: 0.91 },
				measured_at: "2026-03-17T00:00:00Z",
				llm_breakdown: {},
			}),
		).toThrow();
	});

	it("GEO_SCORE_WEIGHTS should sum to 1", () => {
		const sum = Object.values(GEO_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0);
	});
});

describe("TargetProfile", () => {
	const validTarget = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		url: "https://example.com",
		name: "Test Target",
		created_at: "2026-03-17T00:00:00Z",
		updated_at: "2026-03-17T00:00:00Z",
	};

	it("should accept a minimal target profile with defaults", () => {
		const target = TargetProfileSchema.parse(validTarget);
		expect(target.site_type).toBe("generic");
		expect(target.status).toBe("active");
		expect(target.topics).toEqual([]);
	});

	it("CreateTargetSchema should require only url and name", () => {
		const input = CreateTargetSchema.parse({
			url: "https://example.com",
			name: "New Target",
		});
		expect(input.url).toBe("https://example.com");
	});
});

describe("LLMProbe", () => {
	it("should validate a probe result", () => {
		const probe = LLMProbeSchema.parse({
			probe_id: "550e8400-e29b-41d4-a716-446655440000",
			llm_service: "chatgpt",
			model_version: "gpt-4o-2025-12",
			query: "클라우드 보안 솔루션 추천해줘",
			query_type: "citation_test",
			response_text: "추천 솔루션 목록...",
			response_at: "2026-03-17T00:00:00Z",
			cited: true,
			citation_excerpt: "Example Corp의 보안 솔루션...",
			citation_position: 1,
			accuracy_vs_source: 0.95,
			info_items_checked: [],
		});
		expect(probe.cited).toBe(true);
	});
});

describe("ChangeImpact", () => {
	it("should validate a change impact", () => {
		const impact = ChangeImpactSchema.parse({
			change_id: "550e8400-e29b-41d4-a716-446655440000",
			measured_at: "2026-03-17T00:00:00Z",
			score_before: 42,
			score_after: 58,
			delta: 16,
			delta_pct: 38.1,
			per_llm_impact: { chatgpt: 12, claude: 20 },
			confidence: 0.85,
			confounders: [],
			verdict: "positive",
		});
		expect(impact.verdict).toBe("positive");
	});
});

describe("PipelineState", () => {
	it("should validate pipeline state", () => {
		const state = PipelineStateSchema.parse({
			pipeline_id: "550e8400-e29b-41d4-a716-446655440000",
			target_id: "550e8400-e29b-41d4-a716-446655440001",
			stage: "ANALYZING",
			started_at: "2026-03-17T00:00:00Z",
			updated_at: "2026-03-17T00:00:00Z",
			completed_at: null,
			analysis_report_ref: null,
			optimization_plan_ref: null,
			validation_report_ref: null,
			error_message: null,
		});
		expect(state.stage).toBe("ANALYZING");
		expect(state.retry_count).toBe(0);
	});
});

describe("ErrorEvent", () => {
	it("should validate an error event", () => {
		const event = ErrorEventSchema.parse({
			error_id: "550e8400-e29b-41d4-a716-446655440000",
			timestamp: "2026-03-17T00:00:00Z",
			agent_id: "analysis",
			target_id: "550e8400-e29b-41d4-a716-446655440001",
			error_type: "timeout",
			severity: "warning",
			message: "Analysis timed out after 5 minutes",
			context: { elapsed_ms: 300000 },
		});
		expect(event.resolved).toBe(false);
	});
});

describe("LLMProviderConfig", () => {
	it("should validate API key auth config", () => {
		const config = LLMProviderConfigSchema.parse({
			provider_id: "openai",
			display_name: "OpenAI",
			enabled: true,
			auth: {
				method: "api_key",
				api_key_ref: "OPENAI_API_KEY",
			},
			models: [
				{
					model_id: "gpt-4o",
					display_name: "GPT-4o",
					role: "both",
					is_default: true,
					max_tokens: 128000,
					supports_tools: true,
					cost_per_1k_tokens: { input: 0.005, output: 0.015 },
				},
			],
			rate_limit: {
				requests_per_minute: 60,
				tokens_per_minute: 150000,
			},
		});
		expect(config.auth.method).toBe("api_key");
	});
});

describe("AgentPromptConfig", () => {
	it("should validate agent prompt config", () => {
		const config = AgentPromptConfigSchema.parse({
			agent_id: "orchestrator",
			display_name: "Orchestrator",
			system_instruction: "You are the orchestrator...",
			context_slots: [
				{
					slot_name: "{{TARGET_PROFILE}}",
					description: "Target JSON",
					source: "TargetProfile",
					required: true,
				},
			],
			model_preference: null,
			last_modified: "2026-03-17T00:00:00Z",
		});
		expect(config.temperature).toBe(0.3); // default
		expect(config.is_customized).toBe(false); // default
	});
});

describe("GeoTimeSeries", () => {
	it("should validate time series entry", () => {
		const entry = GeoTimeSeriesSchema.parse({
			url: "https://example.com",
			llm_service: "chatgpt",
			measured_at: "2026-03-17T00:00:00Z",
			geo_score: 75.5,
			citation_rate: 0.8,
			citation_rank: 2,
			change_id: null,
			delta_score: 3.2,
		});
		expect(entry.geo_score).toBe(75.5);
	});
});

describe("EffectivenessIndex", () => {
	it("should validate effectiveness index", () => {
		const idx = EffectivenessIndexSchema.parse({
			url: "https://example.com",
			change_type: "FAQ_ADDITION",
			llm_service: "chatgpt",
			sample_count: 11,
			avg_delta: 8.3,
			success_rate: 0.72,
			best_delta: 15.2,
			worst_delta: -2.1,
			last_updated: "2026-03-17T00:00:00Z",
		});
		expect(idx.success_rate).toBe(0.72);
	});
});
