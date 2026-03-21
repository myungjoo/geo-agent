import { describe, expect, it, vi } from "vitest";
import type { AnalysisReport } from "../../models/analysis-report.js";
import { type StrategyInput, _rules, runStrategy } from "./strategy-agent.js";

// ── Helper: create a valid AnalysisReport ───────────────────

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
	return {
		report_id: "550e8400-e29b-41d4-a716-446655440001",
		target_id: "550e8400-e29b-41d4-a716-446655440000",
		url: "https://www.samsung.com",
		analyzed_at: new Date().toISOString(),
		machine_readability: {
			grade: "B",
			js_dependency_ratio: 0,
			structure_quality: {
				semantic_tag_ratio: 0.7,
				div_nesting_depth: 5,
				text_to_markup_ratio: 0.3,
				heading_hierarchy_valid: true,
			},
			crawler_access: [
				{
					user_agent: "GEO-Agent",
					http_status: 200,
					blocked_by_robots_txt: false,
					content_accessible: true,
				},
			],
		},
		content_analysis: {
			word_count: 5000,
			content_density: 40,
			readability_level: "general",
			key_topics_found: ["smartphone", "galaxy"],
			topic_alignment: 0.8,
		},
		structured_data: {
			json_ld_present: true,
			json_ld_types: ["Product", "Organization"],
			schema_completeness: 0.8,
			og_tags_present: true,
			meta_description: "Samsung Galaxy S25 Ultra",
		},
		extracted_info_items: [],
		current_geo_score: {
			total: 71,
			citation_rate: 0,
			citation_accuracy: 0,
			info_recognition_score: 0,
			coverage: 70,
			rank_position: 0,
			structured_score: 85,
			measured_at: new Date().toISOString(),
			llm_breakdown: {},
		},
		competitor_gaps: [],
		llm_status: [],
		...overrides,
	};
}

describe("Strategy Agent", () => {
	describe("runStrategy — basic execution", () => {
		it("returns plan with tasks", async () => {
			const result = await runStrategy({
				target_id: "550e8400-e29b-41d4-a716-446655440000",
				analysis_report: makeReport(),
			});

			expect(result.plan).toBeDefined();
			expect(result.plan.plan_id).toBeTruthy();
			expect(result.plan.target_id).toBe("550e8400-e29b-41d4-a716-446655440000");
			expect(result.tasks_count).toBeGreaterThan(0);
			expect(result.plan.tasks.length).toBe(result.tasks_count);
		});

		it("plan has correct analysis_report_ref", async () => {
			const report = makeReport();
			const result = await runStrategy({ target_id: report.target_id, analysis_report: report });
			expect(result.plan.analysis_report_ref).toBe(report.report_id);
		});

		it("plan status is draft", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			expect(result.plan.status).toBe("draft");
		});

		it("all tasks have pending status", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			for (const task of result.plan.tasks) {
				expect(task.status).toBe("pending");
			}
		});

		it("tasks have unique IDs", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			const ids = result.plan.tasks.map((t) => t.task_id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it("tasks are ordered by priority", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			const priorities = result.plan.tasks.map((t) => t.priority);
			const order = { critical: 0, high: 1, medium: 2, low: 3 };
			for (let i = 1; i < priorities.length; i++) {
				expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
			}
		});

		it("tasks have sequential order field", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			result.plan.tasks.forEach((t, i) => {
				expect(t.order).toBe(i);
			});
		});
	});

	describe("runStrategy — rule-based task generation", () => {
		it("generates JSON-LD task when missing", async () => {
			const report = makeReport({
				structured_data: {
					json_ld_present: false,
					json_ld_types: [],
					schema_completeness: 0,
					og_tags_present: true,
					meta_description: "test",
				},
			});
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const jsonLdTask = result.plan.tasks.find((t) => t.title.includes("JSON-LD"));
			expect(jsonLdTask).toBeDefined();
			expect(jsonLdTask!.priority).toBe("critical");
		});

		it("generates OG tags task when missing", async () => {
			const report = makeReport({
				structured_data: {
					json_ld_present: true,
					json_ld_types: ["Product"],
					schema_completeness: 0.8,
					og_tags_present: false,
					meta_description: "test",
				},
			});
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const ogTask = result.plan.tasks.find((t) => t.title.includes("Open Graph"));
			expect(ogTask).toBeDefined();
			expect(ogTask!.priority).toBe("high");
		});

		it("generates meta description task when missing", async () => {
			const report = makeReport({
				structured_data: {
					json_ld_present: true,
					json_ld_types: ["Product"],
					schema_completeness: 0.8,
					og_tags_present: true,
					meta_description: null,
				},
			});
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const metaTask = result.plan.tasks.find((t) => t.title.includes("Meta description"));
			expect(metaTask).toBeDefined();
		});

		it("generates heading task when hierarchy invalid", async () => {
			const report = makeReport();
			report.machine_readability.structure_quality.heading_hierarchy_valid = false;
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const headingTask = result.plan.tasks.find((t) => t.title.includes("헤딩"));
			expect(headingTask).toBeDefined();
		});

		it("generates semantic tags task when ratio low", async () => {
			const report = makeReport();
			report.machine_readability.structure_quality.semantic_tag_ratio = 0.1;
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const semanticTask = result.plan.tasks.find((t) => t.title.includes("시맨틱"));
			expect(semanticTask).toBeDefined();
		});

		it("generates llms.txt task", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			const llmsTask = result.plan.tasks.find((t) => t.title.includes("llms.txt"));
			expect(llmsTask).toBeDefined();
		});

		it("generates content expansion task when word count low", async () => {
			const report = makeReport();
			report.content_analysis.word_count = 100;
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const contentTask = result.plan.tasks.find((t) => t.title.includes("콘텐츠 확충"));
			expect(contentTask).toBeDefined();
		});

		it("generates robots.txt task when bot blocked", async () => {
			const report = makeReport();
			report.machine_readability.crawler_access = [
				{
					user_agent: "GPTBot",
					http_status: 403,
					blocked_by_robots_txt: true,
					content_accessible: false,
				},
			];
			const result = await runStrategy({ target_id: "t1", analysis_report: report });
			const robotsTask = result.plan.tasks.find((t) => t.title.includes("robots.txt"));
			expect(robotsTask).toBeDefined();
			expect(robotsTask!.priority).toBe("critical");
		});
	});

	describe("runStrategy — impact estimation", () => {
		it("estimated_delta increases with more tasks", async () => {
			const good = makeReport(); // Few issues
			const bad = makeReport({
				structured_data: {
					json_ld_present: false,
					json_ld_types: [],
					schema_completeness: 0,
					og_tags_present: false,
					meta_description: null,
				},
			});
			bad.machine_readability.structure_quality.heading_hierarchy_valid = false;
			bad.machine_readability.structure_quality.semantic_tag_ratio = 0.1;

			const resultGood = await runStrategy({ target_id: "t1", analysis_report: good });
			const resultBad = await runStrategy({ target_id: "t1", analysis_report: bad });

			expect(resultBad.estimated_delta).toBeGreaterThan(resultGood.estimated_delta);
		});

		it("confidence is between 0 and 1", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			expect(result.plan.estimated_impact.confidence).toBeGreaterThanOrEqual(0);
			expect(result.plan.estimated_impact.confidence).toBeLessThanOrEqual(1);
		});
	});

	describe("runStrategy — LLM enhancement", () => {
		it("uses LLM when use_llm=true and chatLLM provided", async () => {
			const llmResponse = {
				strategy_rationale: "LLM-generated strategy rationale",
				tasks: [
					{
						change_type: "SCHEMA_MARKUP",
						title: "LLM: Add JSON-LD",
						description: "Add comprehensive JSON-LD markup",
						target_element: null,
						priority: "critical",
						expected_impact: "Significant improvement in structured data",
					},
				],
				estimated_delta: 20,
				confidence: 0.8,
			};
			const mockChat = vi.fn().mockResolvedValue({
				content: JSON.stringify(llmResponse),
				model: "gpt-4o",
				provider: "openai",
				usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
				latency_ms: 500,
				cost_usd: 0.01,
			});

			const result = await runStrategy(
				{ target_id: "t1", analysis_report: makeReport(), use_llm: true },
				{ chatLLM: mockChat },
			);

			expect(mockChat).toHaveBeenCalled();
			expect(result.plan.strategy_rationale).toBe("LLM-generated strategy rationale");
			// LLM tasks should be included
			expect(result.plan.tasks.some((t) => t.title === "LLM: Add JSON-LD")).toBe(true);
			// LLM estimated delta should be used
			expect(result.estimated_delta).toBe(20);
		});

		it("throws when LLM fails after retry", async () => {
			const mockChat = vi.fn().mockRejectedValue(new Error("API error"));

			await expect(
				runStrategy(
					{ target_id: "t1", analysis_report: makeReport(), use_llm: true },
					{ chatLLM: mockChat },
				),
			).rejects.toThrow("LLM call failed after retry: API error");
		});

		it("uses rule-based rationale when use_llm=false", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			expect(result.plan.strategy_rationale).toContain("규칙 기반");
		});
	});

	describe("runStrategy — edge cases", () => {
		it("generates unique plan_id each call", async () => {
			const report = makeReport();
			const r1 = await runStrategy({ target_id: "t1", analysis_report: report });
			const r2 = await runStrategy({ target_id: "t1", analysis_report: report });
			expect(r1.plan.plan_id).not.toBe(r2.plan.plan_id);
		});

		it("handles perfectly optimized site (minimal tasks)", async () => {
			const result = await runStrategy({ target_id: "t1", analysis_report: makeReport() });
			// Even a good site gets llms.txt suggestion
			expect(result.tasks_count).toBeGreaterThan(0);
		});
	});

	describe("_rules export", () => {
		it("exports strategy rules for inspection", () => {
			expect(_rules.length).toBeGreaterThan(5);
			for (const rule of _rules) {
				expect(typeof rule.condition).toBe("function");
				expect(typeof rule.generate).toBe("function");
			}
		});
	});
});
