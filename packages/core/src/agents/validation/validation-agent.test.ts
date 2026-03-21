import { describe, expect, it, vi } from "vitest";
import type { CrawlData } from "../shared/types.js";
import { type ValidationInput, runValidation } from "./validation-agent.js";

function makeCrawlData(): CrawlData {
	return {
		html: "<html><head><title>Test</title></head><body><h1>Title</h1></body></html>",
		url: "https://example.com",
		status_code: 200,
		content_type: "text/html",
		response_time_ms: 300,
		robots_txt: "User-agent: *\nAllow: /",
		llms_txt: null,
		sitemap_xml: null,
		json_ld: [],
		meta_tags: {},
		title: "Test",
		canonical_url: null,
		links: [],
		headers: {},
	};
}

const baseDimensions = [
	{ id: "S1", label: "크롤링", score: 50, weight: 0.15, details: [] },
	{ id: "S2", label: "구조화", score: 60, weight: 0.25, details: [] },
	{ id: "S3", label: "가독성", score: 55, weight: 0.2, details: [] },
	{ id: "S4", label: "팩트", score: 40, weight: 0.1, details: [] },
	{ id: "S5", label: "브랜드", score: 70, weight: 0.1, details: [] },
	{ id: "S6", label: "AI", score: 20, weight: 0.1, details: [] },
	{ id: "S7", label: "네비게이션", score: 45, weight: 0.1, details: [] },
];

function makeInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
	return {
		target_id: "t1",
		target_url: "https://example.com",
		before_score: 50,
		before_grade: "Needs Improvement",
		before_dimensions: baseDimensions,
		cycle_number: 0,
		...overrides,
	};
}

/** Creates a mock chatLLM that returns a valid ValidationVerdict JSON */
function mockChatLLM() {
	return vi.fn().mockResolvedValue({
		content: JSON.stringify({
			improved_aspects: ["schema markup"],
			remaining_issues: ["content density"],
			llm_friendliness_verdict: "better",
			specific_recommendations: ["Add FAQ"],
			confidence: 0.8,
		}),
		model: "gpt-4o",
		provider: "openai",
		usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
		latency_ms: 200,
		cost_usd: 0.005,
	});
}

function makeDeps(afterScore = 65) {
	const afterDimensions = baseDimensions.map((d) => ({
		...d,
		score: d.score + 15,
		details: ["Improved by 15"],
	}));
	return {
		crawlClone: vi.fn().mockResolvedValue(makeCrawlData()),
		scoreTarget: vi.fn().mockReturnValue({
			overall_score: afterScore,
			grade: afterScore >= 75 ? "Good" : "Needs Improvement",
			dimensions: afterDimensions,
		}),
		chatLLM: mockChatLLM(),
	};
}

describe("Validation Agent", () => {
	describe("runValidation — basic", () => {
		it("returns after scores", async () => {
			const result = await runValidation(makeInput(), makeDeps(65));
			expect(result.after_score).toBe(65);
			expect(result.after_grade).toBe("Needs Improvement");
		});

		it("computes delta correctly", async () => {
			const result = await runValidation(makeInput({ before_score: 50 }), makeDeps(65));
			expect(result.delta).toBe(15);
			expect(result.improved).toBe(true);
		});

		it("detects no improvement", async () => {
			const result = await runValidation(makeInput({ before_score: 70 }), makeDeps(65));
			expect(result.delta).toBe(-5);
			expect(result.improved).toBe(false);
		});

		it("calls crawlClone and scoreTarget", async () => {
			const deps = makeDeps(60);
			await runValidation(makeInput(), deps);
			expect(deps.crawlClone).toHaveBeenCalledOnce();
			expect(deps.scoreTarget).toHaveBeenCalledOnce();
		});
	});

	describe("runValidation — dimension deltas", () => {
		it("computes per-dimension deltas", async () => {
			const result = await runValidation(makeInput(), makeDeps(65));
			expect(result.dimension_deltas).toHaveLength(7);
			for (const dd of result.dimension_deltas) {
				expect(dd).toHaveProperty("id");
				expect(dd).toHaveProperty("before");
				expect(dd).toHaveProperty("after");
				expect(dd).toHaveProperty("delta");
			}
		});

		it("handles missing before dimension", async () => {
			const input = makeInput({ before_dimensions: [] });
			const result = await runValidation(input, makeDeps(65));
			// All before values default to 0
			for (const dd of result.dimension_deltas) {
				expect(dd.before).toBe(0);
			}
		});
	});

	describe("runValidation — cycle control", () => {
		it("stops when score reaches target", async () => {
			const result = await runValidation(makeInput({ target_score: 60 }), makeDeps(65));
			expect(result.needs_more_cycles).toBe(false);
			expect(result.stop_reason).toContain("score_sufficient");
		});

		it("continues when score below target", async () => {
			const result = await runValidation(makeInput({ target_score: 80 }), makeDeps(65));
			expect(result.needs_more_cycles).toBe(true);
			expect(result.stop_reason).toBeNull();
		});

		it("stops when delta < 2 (no more improvements)", async () => {
			const result = await runValidation(
				makeInput({ before_score: 64, cycle_number: 1, target_score: 80 }),
				makeDeps(65),
			);
			expect(result.needs_more_cycles).toBe(false);
			expect(result.stop_reason).toContain("no_more_improvements");
		});

		it("does NOT stop for small delta on first cycle", async () => {
			const result = await runValidation(
				makeInput({ before_score: 64, cycle_number: 0, target_score: 80 }),
				makeDeps(65),
			);
			// cycle_number=0 → first validation, delta check requires cycle_number > 0
			expect(result.needs_more_cycles).toBe(true);
		});

		it("stops when max_cycles reached", async () => {
			const result = await runValidation(
				makeInput({ cycle_number: 9, max_cycles: 10, target_score: 90 }),
				makeDeps(65),
			);
			expect(result.needs_more_cycles).toBe(false);
			expect(result.stop_reason).toContain("max_cycles");
		});

		it("uses default target_score=80", async () => {
			const result = await runValidation(makeInput(), makeDeps(85));
			expect(result.needs_more_cycles).toBe(false);
			expect(result.stop_reason).toContain("score_sufficient");
		});

		it("uses default max_cycles=10", async () => {
			const result = await runValidation(
				makeInput({ cycle_number: 9, target_score: 99 }),
				makeDeps(65),
			);
			expect(result.needs_more_cycles).toBe(false);
			expect(result.stop_reason).toContain("max_cycles");
		});
	});

	describe("runValidation — with LLM verdict", () => {
		const mockLLMVerdict = {
			improved_aspects: ["Better meta tags", "Added JSON-LD"],
			remaining_issues: ["Missing FAQ schema"],
			llm_friendliness_verdict: "better" as const,
			specific_recommendations: ["Add FAQ section"],
			confidence: 0.75,
		};

		function makeLLMResponse(content: string) {
			return {
				content,
				model: "gpt-4o",
				provider: "openai",
				usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
				latency_ms: 250,
				cost_usd: 0.01,
			};
		}

		it("includes llm_verdict when chatLLM provided", async () => {
			const deps = makeDeps(65);
			const chatLLM = vi.fn().mockResolvedValue(makeLLMResponse(JSON.stringify(mockLLMVerdict)));
			const depsWithLLM = { ...deps, chatLLM };

			const result = await runValidation(makeInput(), depsWithLLM);

			expect(result.llm_verdict).not.toBeNull();
			expect(result.llm_verdict!.improved_aspects).toEqual(["Better meta tags", "Added JSON-LD"]);
			expect(result.llm_verdict!.remaining_issues).toEqual(["Missing FAQ schema"]);
			expect(result.llm_verdict!.llm_friendliness_verdict).toBe("better");
			expect(result.llm_verdict!.specific_recommendations).toEqual(["Add FAQ section"]);
			expect(result.llm_verdict!.confidence).toBe(0.75);
			expect(chatLLM).toHaveBeenCalledOnce();
		});

		it("throws when chatLLM fails after retry", async () => {
			const deps = makeDeps(65);
			const chatLLM = vi
				.fn()
				.mockRejectedValueOnce(new Error("LLM timeout"))
				.mockRejectedValueOnce(new Error("LLM timeout"));
			const depsWithLLM = { ...deps, chatLLM };

			await expect(runValidation(makeInput(), depsWithLLM)).rejects.toThrow(
				"LLM call failed after retry",
			);
			expect(chatLLM).toHaveBeenCalledTimes(2);
		});
	});

	describe("runValidation — edge cases", () => {
		it("handles crawl error", async () => {
			const deps = {
				crawlClone: vi.fn().mockRejectedValue(new Error("Clone not found")),
				scoreTarget: vi.fn(),
				chatLLM: mockChatLLM(),
			};
			await expect(runValidation(makeInput(), deps)).rejects.toThrow("Clone not found");
		});

		it("handles identical scores", async () => {
			const result = await runValidation(makeInput({ before_score: 65 }), makeDeps(65));
			expect(result.delta).toBe(0);
			expect(result.improved).toBe(false);
		});
	});
});
