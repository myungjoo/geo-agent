import { describe, expect, it, vi } from "vitest";
import type { OptimizationPlan, OptimizationTask } from "../models/optimization-plan.js";
import { type OptimizationInput, runOptimization } from "./optimization-agent.js";

function makeTask(overrides: Partial<OptimizationTask> = {}): OptimizationTask {
	return {
		task_id: "550e8400-e29b-41d4-a716-446655440099",
		order: 0,
		change_type: "METADATA",
		title: "Meta description 추가",
		description: "Test task",
		target_element: null,
		priority: "high",
		info_recognition_ref: null,
		status: "pending",
		change_record_ref: null,
		...overrides,
	};
}

function makePlan(tasks: OptimizationTask[]): OptimizationPlan {
	return {
		plan_id: "550e8400-e29b-41d4-a716-446655440098",
		target_id: "550e8400-e29b-41d4-a716-446655440000",
		created_at: new Date().toISOString(),
		analysis_report_ref: "550e8400-e29b-41d4-a716-446655440001",
		strategy_rationale: "Test strategy",
		memory_context: { effectiveness_data: [], similar_cases: [], negative_patterns: [] },
		tasks,
		estimated_impact: { expected_delta: 10, confidence: 0.5, rationale: "Test" },
		status: "draft",
	};
}

function makeInput(
	tasks: OptimizationTask[],
	fileContents: Record<string, string> = {},
): OptimizationInput {
	const files = { ...fileContents };
	if (!files["index.html"]) {
		files["index.html"] =
			"<html><head><title>Test Page</title></head><body><p>Content</p></body></html>";
	}
	return {
		plan: makePlan(tasks),
		readFile: vi.fn(async (path: string) => {
			if (files[path]) return files[path];
			throw new Error(`File not found: ${path}`);
		}),
		writeFile: vi.fn(async () => {}),
		listFiles: vi.fn(async () => Object.keys(files)),
	};
}

describe("Optimization Agent", () => {
	describe("runOptimization — METADATA tasks", () => {
		it("adds meta description when missing", async () => {
			const input = makeInput([
				makeTask({ change_type: "METADATA", title: "Meta description 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);
			expect(result.files_modified).toContain("index.html");
			expect(input.writeFile).toHaveBeenCalled();
		});

		it("adds OG tags when missing", async () => {
			const input = makeInput([
				makeTask({ change_type: "METADATA", title: "Open Graph 메타태그 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);
		});

		it("creates robots.txt for bot access", async () => {
			const input = makeInput([
				makeTask({ change_type: "METADATA", title: "robots.txt에서 AI 봇 허용" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);
			expect(result.files_modified).toContain("robots.txt");
		});
	});

	describe("runOptimization — SCHEMA_MARKUP tasks", () => {
		it("adds JSON-LD when missing", async () => {
			const input = makeInput([
				makeTask({ change_type: "SCHEMA_MARKUP", title: "JSON-LD 구조화 데이터 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);

			const writeCall = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: string[]) => c[0] === "index.html",
			);
			expect(writeCall).toBeTruthy();
			expect(writeCall![1]).toContain("application/ld+json");
		});

		it("skips when JSON-LD already exists", async () => {
			const input = makeInput([makeTask({ change_type: "SCHEMA_MARKUP", title: "JSON-LD 추가" })], {
				"index.html":
					'<html><head><script type="application/ld+json">{"@type":"WebPage"}</script></head><body></body></html>',
			});
			const result = await runOptimization(input);
			expect(result.skipped_tasks).toHaveLength(1);
		});
	});

	describe("runOptimization — LLMS_TXT tasks", () => {
		it("creates llms.txt file", async () => {
			const input = makeInput([makeTask({ change_type: "LLMS_TXT", title: "llms.txt 파일 생성" })]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);
			expect(result.files_modified).toContain("llms.txt");
		});
	});

	describe("runOptimization — SEMANTIC_STRUCTURE tasks", () => {
		it("adds H1 when missing", async () => {
			const input = makeInput([
				makeTask({ change_type: "SEMANTIC_STRUCTURE", title: "헤딩 계층 구조 수정" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);

			const writeCall = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: string[]) => c[0] === "index.html",
			);
			expect(writeCall![1]).toContain("<h1>");
		});
	});

	describe("runOptimization — task status handling", () => {
		it("skips non-pending tasks", async () => {
			const input = makeInput([
				makeTask({ status: "completed", task_id: "t1" }),
				makeTask({ status: "in_progress", task_id: "t2" }),
			]);
			const result = await runOptimization(input);
			expect(result.skipped_tasks).toEqual(["t1", "t2"]);
			expect(result.applied_tasks).toHaveLength(0);
		});

		it("skips unknown change types", async () => {
			const input = makeInput([makeTask({ change_type: "EXTERNAL" as "METADATA" })]);
			const result = await runOptimization(input);
			expect(result.skipped_tasks).toHaveLength(1);
		});
	});

	describe("runOptimization — multiple tasks", () => {
		it("processes multiple tasks sequentially", async () => {
			const input = makeInput([
				makeTask({ task_id: "t1", change_type: "METADATA", title: "Meta description 추가" }),
				makeTask({ task_id: "t2", change_type: "LLMS_TXT", title: "llms.txt 파일 생성" }),
				makeTask({ task_id: "t3", change_type: "SCHEMA_MARKUP", title: "JSON-LD 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks.length).toBeGreaterThanOrEqual(2);
		});

		it("deduplicates modified files", async () => {
			const input = makeInput([
				makeTask({ task_id: "t1", change_type: "METADATA", title: "Meta description 추가" }),
				makeTask({ task_id: "t2", change_type: "SCHEMA_MARKUP", title: "JSON-LD 추가" }),
			]);
			const result = await runOptimization(input);
			const indexCount = result.files_modified.filter((f) => f === "index.html").length;
			expect(indexCount).toBeLessThanOrEqual(1);
		});
	});

	describe("runOptimization — error handling", () => {
		it("captures file read errors as failed tasks", async () => {
			const input = makeInput([makeTask({ change_type: "SCHEMA_MARKUP", title: "JSON-LD 추가" })]);
			(input.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Read failed"));
			const result = await runOptimization(input);
			expect(result.failed_tasks).toHaveLength(1);
			expect(result.failed_tasks[0].error).toContain("Read failed");
		});
	});

	describe("runOptimization — with LLM", () => {
		function makeLLMResponse(content: string) {
			return {
				content,
				model: "gpt-4o",
				provider: "openai",
				usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
				latency_ms: 200,
				cost_usd: 0.01,
			};
		}

		it("generates real meta description via LLM", async () => {
			const chatLLM = vi
				.fn()
				.mockResolvedValue(
					makeLLMResponse("Galaxy S25 Ultra - Premium flagship smartphone with AI features"),
				);
			const input = makeInput([
				makeTask({ change_type: "METADATA", title: "Meta description 추가" }),
			]);

			const result = await runOptimization(input, { chatLLM });

			expect(result.applied_tasks).toHaveLength(1);
			const writeCall = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: string[]) => c[0] === "index.html",
			);
			expect(writeCall).toBeTruthy();
			expect(writeCall![1]).toContain("Galaxy S25 Ultra");
			expect(writeCall![1]).not.toContain("Optimized page description for LLM discoverability");
		});

		it("generates JSON-LD via LLM", async () => {
			const llmJsonLd = JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Product",
				name: "Test Page",
				description: "A test product page",
			});
			const chatLLM = vi.fn().mockResolvedValue(makeLLMResponse(llmJsonLd));
			const input = makeInput([
				makeTask({ change_type: "SCHEMA_MARKUP", title: "JSON-LD 구조화 데이터 추가" }),
			]);

			const result = await runOptimization(input, { chatLLM });

			expect(result.applied_tasks).toHaveLength(1);
			const writeCall = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: string[]) => c[0] === "index.html",
			);
			expect(writeCall).toBeTruthy();
			expect(writeCall![1]).toContain("Product");
			expect(writeCall![1]).toContain("application/ld+json");
		});

		it("generates site-specific llms.txt via LLM", async () => {
			const llmContent =
				"# Test Page\n\nA detailed description of Test Page with specific content.\n\n## Key Sections\n- Products overview\n- Technical specifications";
			const chatLLM = vi.fn().mockResolvedValue(makeLLMResponse(llmContent));
			const input = makeInput([makeTask({ change_type: "LLMS_TXT", title: "llms.txt 파일 생성" })]);

			const result = await runOptimization(input, { chatLLM });

			expect(result.applied_tasks).toHaveLength(1);
			expect(result.files_modified).toContain("llms.txt");
			const writeCall = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: string[]) => c[0] === "llms.txt",
			);
			expect(writeCall).toBeTruthy();
			// Should contain LLM-generated content, not boilerplate
			expect(writeCall![1]).toContain("Test Page");
			expect(writeCall![1]).toContain("Technical specifications");
			expect(writeCall![1]).not.toBe(
				"# Site Information\n\nThis site provides information about products and services.\n\n## Key Content\n- Products and specifications\n- Pricing information\n- Company information\n",
			);
		});

		it("falls back to hardcoded when LLM fails", async () => {
			const chatLLM = vi.fn().mockRejectedValue(new Error("API error"));
			const input = makeInput([
				makeTask({ change_type: "METADATA", title: "Meta description 추가" }),
			]);

			const result = await runOptimization(input, { chatLLM });

			expect(result.applied_tasks).toHaveLength(1);
			const writeCall = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: string[]) => c[0] === "index.html",
			);
			expect(writeCall).toBeTruthy();
			// Should have the fallback description
			expect(writeCall![1]).toContain("Optimized page description for LLM discoverability");
		});
	});

	describe("runOptimization — multi-page support (KI-003)", () => {
		function makeMultiPageInput(tasks: OptimizationTask[]): OptimizationInput {
			const files: Record<string, string> = {
				"index.html": "<html><head><title>Home</title></head><body><p>Home page</p></body></html>",
				"products.html":
					"<html><head><title>Products</title></head><body><p>Product list</p></body></html>",
				"about.html": "<html><head><title>About</title></head><body><p>About us</p></body></html>",
			};
			return {
				plan: makePlan(tasks),
				readFile: vi.fn(async (path: string) => {
					if (files[path]) return files[path];
					throw new Error(`File not found: ${path}`);
				}),
				writeFile: vi.fn(async () => {}),
				listFiles: vi.fn(async () => Object.keys(files)),
			};
		}

		it("METADATA applies meta description to ALL html files", async () => {
			const input = makeMultiPageInput([
				makeTask({ change_type: "METADATA", title: "Meta description 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.applied_tasks).toHaveLength(1);
			expect(result.files_modified).toContain("index.html");
			expect(result.files_modified).toContain("products.html");
			expect(result.files_modified).toContain("about.html");
			expect(result.files_modified.length).toBe(3);
		});

		it("SCHEMA_MARKUP adds JSON-LD to ALL html files without it", async () => {
			const input = makeMultiPageInput([
				makeTask({ change_type: "SCHEMA_MARKUP", title: "JSON-LD 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.files_modified).toContain("index.html");
			expect(result.files_modified).toContain("products.html");
			expect(result.files_modified).toContain("about.html");
		});

		it("SEMANTIC_STRUCTURE adds H1 to ALL html files missing it", async () => {
			const input = makeMultiPageInput([
				makeTask({ change_type: "SEMANTIC_STRUCTURE", title: "헤딩 계층 구조 수정" }),
			]);
			const result = await runOptimization(input);
			expect(result.files_modified).toContain("index.html");
			expect(result.files_modified).toContain("products.html");
			expect(result.files_modified).toContain("about.html");
		});

		it("skips HTML files that already have the target element", async () => {
			const files: Record<string, string> = {
				"index.html":
					'<html><head><title>Home</title><meta name="description" content="existing"></head><body></body></html>',
				"products.html": "<html><head><title>Products</title></head><body></body></html>",
			};
			const input: OptimizationInput = {
				plan: makePlan([makeTask({ change_type: "METADATA", title: "Meta description 추가" })]),
				readFile: vi.fn(async (path: string) => {
					if (files[path]) return files[path];
					throw new Error(`File not found: ${path}`);
				}),
				writeFile: vi.fn(async () => {}),
				listFiles: vi.fn(async () => Object.keys(files)),
			};
			const result = await runOptimization(input);
			// index.html already has meta description, products.html doesn't
			expect(result.files_modified).toContain("products.html");
			expect(result.files_modified).not.toContain("index.html");
		});

		it("OG tags applied to all pages", async () => {
			const input = makeMultiPageInput([
				makeTask({ change_type: "METADATA", title: "Open Graph 메타태그 추가" }),
			]);
			const result = await runOptimization(input);
			expect(result.files_modified.length).toBe(3);
			// Verify writeFile was called with OG content for each
			const writeCalls = (input.writeFile as ReturnType<typeof vi.fn>).mock.calls;
			const ogWrites = writeCalls.filter(
				(c: [string, string]) => c[1] && c[1].includes("og:title"),
			);
			expect(ogWrites.length).toBe(3);
		});
	});
});
