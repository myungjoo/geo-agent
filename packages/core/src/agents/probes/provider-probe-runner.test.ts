import { describe, expect, it, vi } from "vitest";
import type { LLMResponse } from "../../llm/geo-llm-client.js";
import type { LLMProviderSettings } from "../../llm/provider-config.js";
import {
	type ChatLLMFn,
	type ProviderProbeResult,
	runProbesForProvider,
	supportsWebSearch,
} from "./provider-probe-runner.js";
import type { ProbeContext } from "./synthetic-probes.js";

// ── Fixtures ────────────────────────────────────────────────

const defaultContext: ProbeContext = {
	site_name: "TestCo",
	site_url: "https://www.testco.com",
	site_type: "manufacturer",
	topics: ["electronics", "smartphones"],
	products: ["Galaxy S25"],
	prices: ["$1299"],
	brand: "TestCo",
};

const mockProvider: LLMProviderSettings = {
	provider_id: "openai",
	display_name: "OpenAI",
	enabled: true,
	auth_method: "api_key",
	api_key: "sk-test",
	default_model: "gpt-4o",
	available_models: ["gpt-4o"],
	max_tokens: 4096,
	temperature: 0.3,
	rate_limit_rpm: 60,
};

function makeMockChatLLM(response = "Mock response about TestCo"): ChatLLMFn {
	return vi.fn(async () => ({
		content: response,
		model: "gpt-4o",
		provider: "openai",
		usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
		latency_ms: 200,
		cost_usd: 0.001,
	})) as ChatLLMFn;
}

// ── Tests ───────────────────────────────────────────────────

describe("provider-probe-runner", () => {
	describe("runProbesForProvider — basic", () => {
		it("runs all 8 probes and returns ProviderProbeResult", async () => {
			const chatLLM = makeMockChatLLM();
			const result = await runProbesForProvider(
				defaultContext,
				{ provider: mockProvider, track: "knowledge" },
				{ chatLLM },
				{ delayMs: 0 },
			);

			expect(result.provider_id).toBe("openai");
			expect(result.model).toBe("gpt-4o");
			expect(result.track).toBe("knowledge");
			expect(result.probes).toHaveLength(8);
		});

		it("runs selected probes only", async () => {
			const chatLLM = makeMockChatLLM();
			const result = await runProbesForProvider(
				defaultContext,
				{ provider: mockProvider, track: "knowledge" },
				{ chatLLM },
				{ probeIds: ["P-01", "P-04"], delayMs: 0 },
			);

			expect(result.probes).toHaveLength(2);
			expect(result.probes[0].probe_id).toBe("P-01");
			expect(result.probes[1].probe_id).toBe("P-04");
		});
	});

	describe("runProbesForProvider — track handling", () => {
		it("passes web_search: true for web_search track", async () => {
			const chatLLM = vi.fn(async (req) => ({
				content: "Search result",
				model: "gpt-4o",
				provider: "openai",
				usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
				latency_ms: 200,
				cost_usd: 0.001,
			})) as unknown as ChatLLMFn;

			await runProbesForProvider(
				defaultContext,
				{ provider: mockProvider, track: "web_search" },
				{ chatLLM },
				{ probeIds: ["P-01"], delayMs: 0 },
			);

			expect(chatLLM).toHaveBeenCalledWith(expect.objectContaining({ web_search: true }));
		});

		it("passes web_search: undefined for knowledge track", async () => {
			const chatLLM = vi.fn(async () => ({
				content: "Knowledge result",
				model: "gpt-4o",
				provider: "openai",
				usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
				latency_ms: 200,
				cost_usd: 0.001,
			})) as unknown as ChatLLMFn;

			await runProbesForProvider(
				defaultContext,
				{ provider: mockProvider, track: "knowledge" },
				{ chatLLM },
				{ probeIds: ["P-01"], delayMs: 0 },
			);

			expect(chatLLM).toHaveBeenCalledWith(expect.objectContaining({ web_search: undefined }));
		});
	});

	describe("runProbesForProvider — error handling", () => {
		it("captures errors without stopping other probes", async () => {
			let callCount = 0;
			const chatLLM: ChatLLMFn = async () => {
				callCount++;
				if (callCount === 2) {
					throw new Error("Rate limited");
				}
				return {
					content: "Response",
					model: "gpt-4o",
					provider: "openai",
					usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
					latency_ms: 200,
					cost_usd: 0.001,
				};
			};

			const result = await runProbesForProvider(
				defaultContext,
				{ provider: mockProvider, track: "knowledge" },
				{ chatLLM },
				{ delayMs: 0 },
			);

			expect(result.probes).toHaveLength(8);

			// Second probe should have error
			const errorProbe = result.probes[1];
			expect(errorProbe.error).toBe("Rate limited");
			expect(errorProbe.response).toBe("");

			// Other probes should be fine
			const okProbes = result.probes.filter((p) => !p.error);
			expect(okProbes.length).toBe(7);
		});
	});

	describe("runProbesForProvider — response collection", () => {
		it("collects probe responses with metadata", async () => {
			const chatLLM = makeMockChatLLM("TestCo Galaxy S25 has a 6.8 inch display");
			const result = await runProbesForProvider(
				defaultContext,
				{ provider: mockProvider, track: "knowledge" },
				{ chatLLM },
				{ probeIds: ["P-01"], delayMs: 0 },
			);

			const probe = result.probes[0];
			expect(probe.probe_id).toBe("P-01");
			expect(probe.probe_name).toBe("제품/서비스 스펙");
			expect(probe.category).toBe("accuracy");
			expect(probe.query).toContain("Galaxy S25");
			expect(probe.response).toContain("6.8 inch");
			expect(probe.latency_ms).toBe(200);
			expect(probe.error).toBeUndefined();
		});
	});

	describe("supportsWebSearch", () => {
		it("returns true for providers with web search", () => {
			expect(supportsWebSearch("openai")).toBe(true);
			expect(supportsWebSearch("anthropic")).toBe(true);
			expect(supportsWebSearch("google")).toBe(true);
			expect(supportsWebSearch("perplexity")).toBe(true);
			expect(supportsWebSearch("microsoft")).toBe(true);
		});

		it("returns false for providers without web search", () => {
			expect(supportsWebSearch("meta")).toBe(false);
			expect(supportsWebSearch("unknown")).toBe(false);
		});
	});
});
