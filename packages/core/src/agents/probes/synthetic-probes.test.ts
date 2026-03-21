import { describe, expect, it, vi } from "vitest";
import {
	PROBE_DEFINITIONS,
	type ProbeContext,
	type SyntheticProbeRunResult,
	runProbes,
} from "./synthetic-probes.js";

const defaultContext: ProbeContext = {
	site_name: "Samsung",
	site_url: "https://www.samsung.com",
	site_type: "manufacturer",
	topics: ["스마트폰", "Galaxy", "가전"],
	products: ["Galaxy S25 Ultra", "Galaxy Z Fold6"],
	prices: ["₩1,799,000"],
	brand: "Samsung",
};

/**
 * Smart mock that handles three call types per successful probe:
 * 1. Probe query (json_mode: false) — return content string
 * 2. Citation judgment (json_mode: true, system_instruction contains "citation analysis")
 * 3. Accuracy judgment (json_mode: true, system_instruction contains "accuracy evaluation")
 */
function mockChatLLM(content: string, cited = true, accuracy = 0.7) {
	return vi
		.fn()
		.mockImplementation(
			async (req: { prompt: string; system_instruction?: string; json_mode?: boolean }) => {
				// Distinguish citation vs accuracy by system_instruction content
				if (req.json_mode === true) {
					const sysInst = req.system_instruction || "";
					const prompt = req.prompt || "";

					if (sysInst.includes("accuracy evaluation") || prompt.includes("accuracy")) {
						return {
							content: JSON.stringify({ accuracy, reasoning: "mock accuracy judgment" }),
							model: "gpt-4o",
							provider: "openai",
							usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 },
							latency_ms: 200,
							cost_usd: 0.0005,
						};
					}

					// Default json_mode call = citation judgment
					return {
						content: JSON.stringify({ cited, reasoning: "mock citation judgment" }),
						model: "gpt-4o",
						provider: "openai",
						usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 },
						latency_ms: 200,
						cost_usd: 0.0005,
					};
				}

				// Non-json_mode = probe query
				return {
					content,
					model: "gpt-4o",
					provider: "openai",
					usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
					latency_ms: 500,
					cost_usd: 0.001,
				};
			},
		);
}

describe("Synthetic Probes", () => {
	describe("PROBE_DEFINITIONS", () => {
		it("has 8 probe definitions", () => {
			expect(PROBE_DEFINITIONS).toHaveLength(8);
		});

		it("each probe has id, name, category, generateQuery", () => {
			for (const probe of PROBE_DEFINITIONS) {
				expect(probe.id).toMatch(/^P-0[1-8]$/);
				expect(probe.name).toBeTruthy();
				expect(["citation", "accuracy", "recognition", "recommendation"]).toContain(probe.category);
				expect(typeof probe.generateQuery).toBe("function");
			}
		});

		it("generates queries with context", () => {
			for (const probe of PROBE_DEFINITIONS) {
				const query = probe.generateQuery(defaultContext);
				expect(query.length).toBeGreaterThan(5);
			}
		});

		it("generates queries without products/topics", () => {
			const emptyCtx: ProbeContext = {
				...defaultContext,
				products: [],
				topics: [],
				prices: [],
			};
			for (const probe of PROBE_DEFINITIONS) {
				const query = probe.generateQuery(emptyCtx);
				expect(query.length).toBeGreaterThan(5);
			}
		});
	});

	describe("runProbes — basic execution", () => {
		it("runs all 8 probes", async () => {
			const chat = mockChatLLM(
				"Samsung Galaxy S25 Ultra는 삼성의 최신 스마트폰입니다. samsung.com에서 확인하세요.",
			);
			const result = await runProbes(defaultContext, { chatLLM: chat }, { delayMs: 0 });

			expect(result.probes).toHaveLength(8);
			// 8 probes × 3 calls each (probe query + citation judgment + accuracy judgment)
			expect(chat).toHaveBeenCalledTimes(24);
		});

		it("runs selected probes only", async () => {
			const chat = mockChatLLM("Samsung response");
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01", "P-04"], delayMs: 0 },
			);

			expect(result.probes).toHaveLength(2);
			expect(result.probes[0].probe_id).toBe("P-01");
			expect(result.probes[1].probe_id).toBe("P-04");
			// 2 probes × 3 calls each
			expect(chat).toHaveBeenCalledTimes(6);
		});
	});

	describe("runProbes — citation detection", () => {
		it("detects citation by domain name", async () => {
			const chat = mockChatLLM("자세한 정보는 samsung.com에서 확인하세요.", true);
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			expect(result.probes[0].cited).toBe(true);
		});

		it("detects citation by site name", async () => {
			const chat = mockChatLLM("Samsung에서 출시한 제품입니다.", true);
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			expect(result.probes[0].cited).toBe(true);
		});

		it("detects citation by brand name", async () => {
			const chat = mockChatLLM("삼성전자의 Samsung Galaxy 시리즈입니다.", true);
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			expect(result.probes[0].cited).toBe(true);
		});

		it("reports no citation when not mentioned", async () => {
			const chat = mockChatLLM("최신 스마트폰은 다양한 기능을 제공합니다.", false);
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			expect(result.probes[0].cited).toBe(false);
		});
	});

	describe("runProbes — verdict determination", () => {
		it("PASS when cited and high accuracy", async () => {
			// cited=true, accuracy=0.8 → PASS (cited && accuracy >= 0.5)
			const chat = mockChatLLM(
				"Samsung Galaxy S25 Ultra는 삼성의 플래그십 스마트폰입니다.",
				true,
				0.8,
			);
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-04"], delayMs: 0 },
			);
			expect(result.probes[0].verdict).toBe("PASS");
		});

		it("FAIL when not cited and low accuracy", async () => {
			// cited=false, accuracy=0.1 → FAIL (not cited && accuracy < 0.3)
			const chat = mockChatLLM("일반적인 정보입니다.", false, 0.1);
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			expect(result.probes[0].verdict).toBe("FAIL");
		});
	});

	describe("runProbes — summary", () => {
		it("computes correct summary stats", async () => {
			const chat = mockChatLLM("Samsung Galaxy S25 Ultra 관련 정보입니다.", true);
			const result = await runProbes(defaultContext, { chatLLM: chat }, { delayMs: 0 });

			expect(result.summary.total).toBe(8);
			expect(result.summary.pass + result.summary.partial + result.summary.fail).toBe(8);
			expect(result.summary.citation_rate).toBeGreaterThanOrEqual(0);
			expect(result.summary.citation_rate).toBeLessThanOrEqual(1);
			expect(result.summary.average_accuracy).toBeGreaterThanOrEqual(0);
		});
	});

	describe("runProbes — error handling", () => {
		it("handles LLM call failure as FAIL verdict", async () => {
			const chat = vi.fn().mockRejectedValue(new Error("API timeout"));
			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01"], delayMs: 0 },
			);

			expect(result.probes[0].verdict).toBe("FAIL");
			expect(result.probes[0].response).toContain("API timeout");
			expect(result.probes[0].accuracy).toBe(0);
			// Only 1 call: probe query fails, citation/accuracy judgment never called
			expect(chat).toHaveBeenCalledTimes(1);
		});

		it("continues after individual probe failure", async () => {
			let callCount = 0;
			const chat = vi
				.fn()
				.mockImplementation(
					async (req: { prompt: string; system_instruction?: string; json_mode?: boolean }) => {
						callCount++;
						// First call is the probe query for P-01 — fails
						if (callCount === 1) throw new Error("First call fails");
						// Calls 2-4 are for P-02: probe query, citation judgment, accuracy judgment

						if (req.json_mode === true) {
							const sysInst = req.system_instruction || "";
							if (sysInst.includes("accuracy evaluation")) {
								return {
									content: JSON.stringify({ accuracy: 0.7, reasoning: "mock" }),
									model: "gpt-4o",
									provider: "openai",
									usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 },
									latency_ms: 200,
									cost_usd: 0.0005,
								};
							}
							return {
								content: JSON.stringify({ cited: true, reasoning: "mock" }),
								model: "gpt-4o",
								provider: "openai",
								usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 },
								latency_ms: 200,
								cost_usd: 0.0005,
							};
						}

						return {
							content: "Samsung response",
							model: "gpt-4o",
							provider: "openai",
							usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
							latency_ms: 100,
							cost_usd: 0.001,
						};
					},
				);

			const result = await runProbes(
				defaultContext,
				{ chatLLM: chat },
				{ probeIds: ["P-01", "P-02"], delayMs: 0 },
			);

			expect(result.probes).toHaveLength(2);
			expect(result.probes[0].verdict).toBe("FAIL");
			expect(result.probes[1].verdict).not.toBe("FAIL");
			// 1 call for failed P-01 + 3 calls for successful P-02 = 4
			expect(chat).toHaveBeenCalledTimes(4);
		});
	});

	describe("runProbes — accuracy estimation", () => {
		it("higher accuracy with more topic matches", async () => {
			const chatWithTopics = mockChatLLM(
				"Samsung Galaxy S25 Ultra 스마트폰은 가전 분야의 Galaxy 시리즈입니다.",
				true,
				0.8,
			);
			const chatNoTopics = mockChatLLM("일반적인 제품 정보입니다.", false, 0.2);

			const r1 = await runProbes(
				defaultContext,
				{ chatLLM: chatWithTopics },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			const r2 = await runProbes(
				defaultContext,
				{ chatLLM: chatNoTopics },
				{ probeIds: ["P-01"], delayMs: 0 },
			);

			expect(r1.probes[0].accuracy).toBeGreaterThan(r2.probes[0].accuracy);
		});

		it("higher accuracy with longer responses", async () => {
			const longResponse = `${"Samsung ".repeat(100)}Galaxy S25 Ultra 스마트폰`;
			const shortResponse = "Samsung";

			const r1 = await runProbes(
				defaultContext,
				{ chatLLM: mockChatLLM(longResponse, true, 0.8) },
				{ probeIds: ["P-01"], delayMs: 0 },
			);
			const r2 = await runProbes(
				defaultContext,
				{ chatLLM: mockChatLLM(shortResponse, true, 0.3) },
				{ probeIds: ["P-01"], delayMs: 0 },
			);

			expect(r1.probes[0].accuracy).toBeGreaterThanOrEqual(r2.probes[0].accuracy);
		});
	});
});
