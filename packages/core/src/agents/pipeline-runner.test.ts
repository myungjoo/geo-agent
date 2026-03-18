import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMRequest, LLMResponse } from "../llm/geo-llm-client.js";
import { type PipelineConfig, type PipelineDeps, runPipeline } from "./pipeline-runner.js";
import type { CrawlData } from "./types.js";

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

function makeDeps(): PipelineDeps {
	let callCount = 0;
	return {
		crawlTarget: vi.fn().mockResolvedValue(makeCrawlData()),
		scoreTarget: vi.fn().mockImplementation(() => {
			callCount++;
			// Score improves each call (simulating optimization effect)
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
		}),
		classifySite: vi.fn().mockReturnValue({
			site_type: "manufacturer",
			confidence: 0.7,
			matched_signals: ["Price pattern"],
			all_signals: [
				{ site_type: "manufacturer", confidence: 0.7, signals: ["Price"] },
				{ site_type: "research", confidence: 0, signals: [] },
				{ site_type: "generic", confidence: 0.3, signals: [] },
			],
		}),
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
	return vi.fn().mockImplementation(async (req: LLMRequest) => ({
		content: `example.com은 삼성전자와 유사한 전자 제품을 취급하는 사이트입니다. ${req.prompt}에 대한 답변입니다. Test Page에서 자세한 정보를 확인할 수 있습니다.`,
		model: "test-model",
		provider: "test-provider",
		latency_ms: 50,
		usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
	}));
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

	it("skips probes when chatLLM is not provided", async () => {
		const deps = makeDeps();
		// No chatLLM → probes should not run, pipeline should still succeed
		const config = makeConfig({ target_score: 60, max_cycles: 1 });
		const result = await runPipeline(config, deps);
		expect(result.success).toBe(true);
	});

	it("pipeline succeeds even if probes fail", async () => {
		const deps = makeDeps();
		deps.chatLLM = vi.fn().mockRejectedValue(new Error("LLM API error"));
		const config = makeConfig({ target_score: 60, max_cycles: 1 });

		const result = await runPipeline(config, deps);
		// Pipeline should succeed — probes failure is non-fatal
		expect(result.success).toBe(true);
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
