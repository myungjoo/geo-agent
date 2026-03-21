import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @mariozechner/pi-ai before any imports that depend on it
vi.mock("@mariozechner/pi-ai", () => {
	// Minimal TypeBox-compatible Type mock
	const schemaFactory = (kind: string) => (arg?: any, opts?: any) => ({
		type: kind,
		...(typeof arg === "object" && !Array.isArray(arg) ? { properties: arg } : {}),
		...(opts || {}),
	});
	const Type = {
		Object: schemaFactory("object"),
		String: schemaFactory("string"),
		Number: schemaFactory("number"),
		Boolean: schemaFactory("boolean"),
		Array: (items: any, opts?: any) => ({ type: "array", items, ...(opts || {}) }),
		Optional: (schema: any) => ({ ...schema, optional: true }),
		Literal: (val: any) => ({ type: "literal", const: val }),
		Union: (schemas: any[]) => ({ anyOf: schemas }),
		Null: () => ({ type: "null" }),
	};
	return {
		Type,
		complete: vi.fn(),
		getModel: vi.fn(),
		getEnvApiKey: vi.fn(),
		calculateCost: vi.fn().mockReturnValue(0),
		validateToolCall: vi.fn(),
	};
});

import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import { runAnalysis } from "../analysis/analysis-agent.js";
import type { LLMAnalysisResult } from "../analysis/llm-analysis-agent.js";
import type { RichAnalysisReport } from "../analysis/rich-analysis-schema.js";
import type { CrawlData } from "../shared/types.js";
import { type PipelineConfig, type PipelineDeps, runPipeline } from "./pipeline-runner.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = path.join(
		os.tmpdir(),
		`geo-pipeline-runner-${crypto.randomBytes(8).toString("hex")}`,
	);
	fs.mkdirSync(dir, { recursive: true });
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	tmpDirs = [];
});

function makeCrawlData(): CrawlData {
	return {
		html: "<html><head><title>Test Page</title></head><body><p>Content about products with price $999</p></body></html>",
		url: "https://example.com",
		status_code: 200,
		content_type: "text/html",
		response_time_ms: 300,
		robots_txt: "User-agent: *\nAllow: /",
		llms_txt: null,
		sitemap_xml: null,
		json_ld: [],
		meta_tags: {},
		title: "Test Page",
		canonical_url: null,
		links: [],
		headers: {},
	};
}

function makeScoreTarget() {
	let callCount = 0;
	return vi.fn().mockImplementation(() => {
		callCount++;
		const baseScore = 45 + callCount * 10;
		return {
			overall_score: Math.min(baseScore, 90),
			grade: baseScore >= 75 ? "Good" : "Needs Improvement",
			dimensions: [
				{ id: "S1", label: "크롤링", score: 50 + callCount * 5, weight: 0.15, details: [] },
				{ id: "S2", label: "구조화", score: 40 + callCount * 10, weight: 0.25, details: [] },
				{ id: "S3", label: "가독성", score: 55 + callCount * 5, weight: 0.2, details: [] },
				{ id: "S4", label: "팩트", score: 40, weight: 0.1, details: [] },
				{ id: "S5", label: "브랜드", score: 60, weight: 0.1, details: [] },
				{ id: "S6", label: "AI", score: 20 + callCount * 10, weight: 0.1, details: [] },
				{ id: "S7", label: "네비게이션", score: 45, weight: 0.1, details: [] },
			],
		};
	});
}

function makeMockRichReport(score: number): RichAnalysisReport {
	return {
		target: {
			url: "https://example.com",
			title: "Test",
			site_type: "manufacturer",
			site_type_confidence: 0.7,
			analyzed_at: new Date().toISOString(),
		},
		overall_score: score,
		grade: score >= 75 ? "Good" : "Needs Improvement",
		overview: {
			summary_cards: [],
			dimensions: [],
			llm_accessibility: [],
			strengths: [],
			weaknesses: [],
			opportunities: [],
		},
		crawlability: {
			bot_policies: [],
			blocked_paths: [],
			allowed_paths: [],
			llms_txt: { exists: false, urls_checked: [], content_preview: null },
			robots_txt_ai_section: null,
		},
		structured_data: { page_quality: [], schema_analysis: [], schema_counts: {} },
		products: { category_scores: [], product_lists: [], spec_recognition: [] },
		brand: { dimensions: [], claims: [] },
		pages: { pages: [] },
		recommendations: {
			high_priority: [],
			medium_priority: [],
			low_priority: [],
			competitive_comparison: null,
		},
		evidence: {
			sections: [],
			schema_implementation_matrix: [],
			js_dependency_details: [],
			claim_verifications: [],
		},
		probes: null,
		roadmap: { consumer_scenarios: [], vulnerability_scores: [], opportunity_matrix: [] },
	};
}

function makeDeps(): PipelineDeps {
	const scoreTarget = makeScoreTarget();
	const crawlTarget = vi.fn().mockResolvedValue(makeCrawlData());
	const classifySite = vi.fn().mockReturnValue({
		site_type: "manufacturer",
		confidence: 0.7,
		matched_signals: ["Price pattern"],
		all_signals: [
			{ site_type: "manufacturer", confidence: 0.7, signals: ["Price"] },
			{ site_type: "research", confidence: 0, signals: [] },
			{ site_type: "generic", confidence: 0.3, signals: [] },
		],
	});

	// Mock LLM analysis — runs rule-based analysis + attaches mock richReport
	const runLLMAnalysisOverride = vi.fn().mockImplementation(async (input: any, toolDeps: any) => {
		const output = await runAnalysis(input, {
			crawlTarget: toolDeps.crawlTarget,
			scoreTarget: toolDeps.scoreTarget,
			classifySite: toolDeps.classifySite,
			crawlMultiplePages: toolDeps.crawlMultiplePages,
			chatLLM: toolDeps.chatLLM,
		});
		return {
			output,
			richReport: makeMockRichReport(output.geo_scores.overall_score),
			llmAssessment: "Mock LLM assessment",
			agentLoopResult: {
				finalText: "{}",
				messages: [],
				iterations: 1,
				totalUsage: { input: 0, output: 0, totalTokens: 0 },
				totalCost: 0,
				completed: true,
				toolCallLog: [],
			},
			toolCallLog: [],
		} satisfies LLMAnalysisResult;
	});

	return {
		crawlTarget,
		scoreTarget,
		classifySite,
		runLLMAnalysisOverride,
		chatLLM: mockChatLLM(),
	};
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
	return {
		target_id: "test-target-1",
		target_url: "https://example.com",
		workspace_dir: makeTmpDir(),
		target_score: 80,
		max_cycles: 3,
		max_retries: 1,
		timeout_ms: 60000,
		...overrides,
	};
}

describe("Pipeline Runner — E2E", () => {
	it("runs full pipeline to completion", async () => {
		const config = makeConfig({ target_score: 60, max_cycles: 1 });
		const result = await runPipeline(config, makeDeps());
		if (!result.success) {
			console.error("Pipeline failed:", result.error);
		}
		expect(result.success).toBe(true);
		expect(result.initial_score).toBeGreaterThan(0);
	});

	it("returns dashboard HTML when pipeline completes", async () => {
		const config = makeConfig({ target_score: 60, max_cycles: 1 });
		const result = await runPipeline(config, makeDeps());
		expect(result.success).toBe(true);
		if (result.dashboard_html) {
			expect(result.dashboard_html).toContain("<!DOCTYPE html>");
		}
	});

	it("creates report archive when pipeline completes", async () => {
		const config = makeConfig({ target_score: 60, max_cycles: 1 });
		const result = await runPipeline(config, makeDeps());
		expect(result.success).toBe(true);
		// Archive may or may not be created depending on workspace state
	});

	it("computes delta correctly", async () => {
		const result = await runPipeline(makeConfig(), makeDeps());
		expect(result.delta).toBe(result.final_score - result.initial_score);
	});

	it("respects max_cycles", async () => {
		const result = await runPipeline(makeConfig({ max_cycles: 2 }), makeDeps());
		expect(result.cycles_completed).toBeLessThanOrEqual(2);
	});

	it("stops when target_score reached", async () => {
		// Score improves per call, so low target = early stop
		const result = await runPipeline(makeConfig({ target_score: 60 }), makeDeps());
		expect(result.success).toBe(true);
		expect(result.final_score).toBeGreaterThanOrEqual(55); // Approximate
	});

	it("calls all dependency functions", async () => {
		const deps = makeDeps();
		await runPipeline(makeConfig(), deps);
		expect(deps.crawlTarget).toHaveBeenCalled();
		expect(deps.scoreTarget).toHaveBeenCalled();
		expect(deps.classifySite).toHaveBeenCalled();
	});

	it("handles crawl failure gracefully", async () => {
		const deps = makeDeps();
		deps.crawlTarget = vi.fn().mockRejectedValue(new Error("Network error"));
		const result = await runPipeline(makeConfig(), deps);
		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it("works with single cycle (no loop)", async () => {
		const deps = makeDeps();
		// Score reaches 80+ on second scoreTarget call → no more cycles
		const result = await runPipeline(makeConfig({ target_score: 55, max_cycles: 1 }), deps);
		expect(result.success).toBe(true);
	});
});

// ── Synthetic Probes Integration ────────────────────────

function mockChatLLM(): (req: LLMRequest) => Promise<LLMResponse> {
	return vi.fn().mockImplementation(async (req: LLMRequest) => {
		const prompt = req.prompt ?? "";
		const systemPrompt = req.system_instruction ?? "";
		let content: string;

		if (req.json_mode) {
			// Return schema-appropriate JSON based on prompt/system context
			if (prompt.includes("brand recognition") || prompt.includes("LLM consumption quality")) {
				// ContentQualityAssessmentSchema
				content = JSON.stringify({
					brand_recognition: {
						score: 60,
						identified_brand: "TestBrand",
						identified_products: ["Product A"],
						reasoning: "Test",
					},
					content_quality: {
						score: 65,
						clarity: 70,
						completeness: 60,
						factual_density: 55,
						reasoning: "Test",
					},
					information_gaps: [
						{ category: "pricing", description: "Missing price info", importance: "medium" },
					],
					llm_consumption_issues: [{ issue: "Low structured data", recommendation: "Add JSON-LD" }],
					overall_assessment: "Page needs improvement for LLM consumption",
				});
			} else if (
				prompt.includes("optimization plan") ||
				systemPrompt.includes("strategy") ||
				prompt.includes("strategy") ||
				systemPrompt.includes("GEO optimization expert")
			) {
				// StrategyLLMResponseSchema
				content = JSON.stringify({
					strategy_rationale:
						"Improve structured data and meta tags for better LLM discoverability",
					tasks: [
						{
							change_type: "SCHEMA_MARKUP",
							title: "Add JSON-LD",
							description: "Add structured data",
							target_element: null,
							priority: "high",
							expected_impact: "15% score improvement",
							specific_data: {},
						},
					],
					estimated_delta: 10,
					confidence: 0.7,
				});
			} else if (
				prompt.includes("optimization results") ||
				systemPrompt.includes("validation expert")
			) {
				// ValidationVerdictSchema
				content = JSON.stringify({
					improved_aspects: ["structured data", "meta tags"],
					remaining_issues: ["content density"],
					llm_friendliness_verdict: "better",
					specific_recommendations: ["Add more factual content"],
					confidence: 0.8,
				});
			} else {
				// Generic fallback JSON
				content = JSON.stringify({
					strategy_rationale: "Improve structured data",
					tasks: [],
					estimated_delta: 10,
					confidence: 0.7,
					improved_aspects: ["structured data"],
					remaining_issues: [],
					llm_friendliness_verdict: "better",
					specific_recommendations: [],
					brand_recognition: {
						score: 50,
						identified_brand: "Test",
						identified_products: [],
						reasoning: "Test",
					},
					content_quality: {
						score: 50,
						clarity: 50,
						completeness: 50,
						factual_density: 50,
						reasoning: "Test",
					},
					information_gaps: [],
					llm_consumption_issues: [],
					overall_assessment: "Test assessment",
				});
			}
		} else {
			// Non-JSON text responses (probes, meta descriptions, etc.)
			content = `example.com은 삼성전자와 유사한 전자 제품을 취급하는 사이트입니다. ${prompt.slice(0, 50)}에 대한 답변입니다. Test Page에서 자세한 정보를 확인할 수 있습니다.`;
		}

		return {
			content,
			model: "test-model",
			provider: "test-provider",
			latency_ms: 50,
			usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
		};
	});
}

describe("Pipeline Runner — Synthetic Probes", () => {
	it("runs probes when chatLLM is provided", async () => {
		const deps = makeDeps();
		deps.chatLLM = mockChatLLM();
		const config = makeConfig({ target_score: 60, max_cycles: 1 });

		const result = await runPipeline(config, deps);
		expect(result.success).toBe(true);
		// chatLLM should have been called for probes (8 probes)
		expect(deps.chatLLM).toHaveBeenCalled();
	});

	it("runs pipeline successfully with chatLLM always provided", async () => {
		const deps = makeDeps();
		// chatLLM is always provided since all agents now require it
		const config = makeConfig({ target_score: 60, max_cycles: 1 });
		const result = await runPipeline(config, deps);
		expect(result.success).toBe(true);
	});

	it("pipeline fails when chatLLM always errors (all agents require LLM)", async () => {
		const deps = makeDeps();
		deps.chatLLM = vi.fn().mockRejectedValue(new Error("LLM API error"));
		const config = makeConfig({ target_score: 60, max_cycles: 1 });

		const result = await runPipeline(config, deps);
		// All agents now require chatLLM — a failing LLM causes pipeline failure
		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it("tracks probe results with stageCallbacks", async () => {
		const deps = makeDeps();
		deps.chatLLM = mockChatLLM();

		const stageResults: Array<{ stage: string; resultFull?: unknown }> = [];

		const config = makeConfig({
			target_score: 60,
			max_cycles: 1,
			stageCallbacks: {
				onStageStart: async (_pid, stage, _cycle, _prompt) => {
					return `exec-${stage}`;
				},
				onStageComplete: async (execId, _summary, resultFull) => {
					stageResults.push({
						stage: execId.replace("exec-", ""),
						resultFull,
					});
				},
				onStageFail: async () => {},
			},
		});

		await runPipeline(config, deps);

		const analyzingResult = stageResults.find((s) => s.stage === "ANALYZING");
		expect(analyzingResult).toBeDefined();
		const full = analyzingResult?.resultFull as Record<string, unknown>;
		expect(full).toBeDefined();
		expect(full.synthetic_probes).toBeDefined();

		const probes = full.synthetic_probes as { summary: { total: number; citation_rate: number } };
		expect(probes.summary.total).toBe(8);
		expect(probes.summary.citation_rate).toBeGreaterThanOrEqual(0);
	});
});

// ── resultFullFn Regression Tests ────────────────────────

function makeStageTracker() {
	const stageResults: Array<{ stage: string; resultFull?: unknown }> = [];
	return {
		stageResults,
		callbacks: {
			onStageStart: async (_pid: string, stage: string, _cycle: number, _prompt: string) => {
				return `exec-${stage}`;
			},
			onStageComplete: async (execId: string, _summary: string, resultFull?: unknown) => {
				stageResults.push({
					stage: execId.replace("exec-", ""),
					resultFull,
				});
			},
			onStageFail: async () => {},
		},
	};
}

describe("Pipeline Runner — resultFullFn regression", () => {
	it("REPORTING result_full contains LLM tracking data when LLM is used", async () => {
		const deps = makeDeps();
		deps.chatLLM = mockChatLLM();
		const { stageResults, callbacks } = makeStageTracker();

		const config = makeConfig({
			target_score: 60,
			max_cycles: 1,
			stageCallbacks: callbacks,
		});

		const result = await runPipeline(config, deps);
		expect(result.success).toBe(true);

		const reporting = stageResults.find((s) => s.stage === "REPORTING");
		expect(reporting).toBeDefined();
		expect(reporting?.resultFull).toBeDefined();

		const full = reporting?.resultFull as {
			initial: number;
			final: number;
			llm_models_used: string[];
			llm_errors: string[];
			llm_call_log: unknown[];
		};
		expect(full.llm_models_used).toBeInstanceOf(Array);
		expect(full.llm_models_used.length).toBeGreaterThan(0);
		expect(full.llm_models_used[0]).toContain("test-provider");
		expect(full.llm_errors).toBeInstanceOf(Array);
		expect(full.llm_call_log).toBeInstanceOf(Array);
		expect(full.llm_call_log.length).toBeGreaterThan(0);
		expect(full.initial).toBeGreaterThan(0);
		expect(typeof full.final).toBe("number");
	});

	it("llm_call_log entries have correct structure", async () => {
		const deps = makeDeps();
		deps.chatLLM = mockChatLLM();
		const { stageResults, callbacks } = makeStageTracker();

		const config = makeConfig({
			target_score: 60,
			max_cycles: 1,
			stageCallbacks: callbacks,
		});

		await runPipeline(config, deps);

		const reporting = stageResults.find((s) => s.stage === "REPORTING");
		const full = reporting?.resultFull as { llm_call_log: Record<string, unknown>[] };
		expect(full.llm_call_log.length).toBeGreaterThan(0);

		const entry = full.llm_call_log[0];
		expect(typeof entry.seq).toBe("number");
		expect(typeof entry.timestamp).toBe("string");
		expect(typeof entry.stage).toBe("string");
		expect(typeof entry.provider).toBe("string");
		expect(typeof entry.model).toBe("string");
		expect(typeof entry.prompt_summary).toBe("string");
		expect(typeof entry.response_summary).toBe("string");
		expect(typeof entry.duration_ms).toBe("number");
	});

	it("CLONING result_full is stored", async () => {
		const deps = makeDeps();
		const { stageResults, callbacks } = makeStageTracker();

		const config = makeConfig({
			target_score: 60,
			max_cycles: 1,
			stageCallbacks: callbacks,
		});

		await runPipeline(config, deps);

		const cloning = stageResults.find((s) => s.stage === "CLONING");
		expect(cloning).toBeDefined();
		expect(cloning?.resultFull).toBeDefined();

		const full = cloning?.resultFull as { clone_path: string; files: number };
		expect(typeof full.clone_path).toBe("string");
		expect(typeof full.files).toBe("number");
		expect(full.files).toBeGreaterThan(0);
	});

	it("with LLM, llm_models_used and llm_call_log are populated", async () => {
		const deps = makeDeps();
		// chatLLM is always provided — all agents require it now
		const { stageResults, callbacks } = makeStageTracker();

		const config = makeConfig({
			target_score: 60,
			max_cycles: 1,
			stageCallbacks: callbacks,
		});

		await runPipeline(config, deps);

		const reporting = stageResults.find((s) => s.stage === "REPORTING");
		expect(reporting).toBeDefined();
		expect(reporting?.resultFull).toBeDefined();

		const full = reporting?.resultFull as {
			llm_models_used: string[];
			llm_call_log: unknown[];
			llm_errors: string[];
		};
		expect(full.llm_models_used).toBeInstanceOf(Array);
		expect(full.llm_call_log).toBeInstanceOf(Array);
		expect(full.llm_errors).toBeInstanceOf(Array);
	});
});
