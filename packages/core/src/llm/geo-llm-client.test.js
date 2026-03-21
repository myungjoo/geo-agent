import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CostTracker,
	GeoLLMClient,
	LLMRequestSchema,
	LLMResponseSchema,
} from "./geo-llm-client.js";
import { ProviderConfigManager } from "./provider-config.js";
let tmpDirs = [];
function makeTmpDir() {
	const dir = path.join(os.tmpdir(), `geo-llm-test-${crypto.randomBytes(8).toString("hex")}`);
	fs.mkdirSync(dir, { recursive: true });
	tmpDirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of tmpDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
	tmpDirs = [];
	vi.restoreAllMocks();
});
// ── Schema Tests ─────────────────────────────────────────
describe("LLMRequestSchema", () => {
	it("validates a minimal request", () => {
		const result = LLMRequestSchema.safeParse({ prompt: "Hello" });
		expect(result.success).toBe(true);
	});
	it("validates a full request", () => {
		const result = LLMRequestSchema.safeParse({
			prompt: "Hello",
			system_instruction: "You are a GEO expert",
			model: "gpt-4o",
			provider: "openai",
			max_tokens: 1000,
			temperature: 0.7,
			json_mode: true,
		});
		expect(result.success).toBe(true);
	});
	it("rejects empty prompt", () => {
		const result = LLMRequestSchema.safeParse({});
		expect(result.success).toBe(false);
	});
	it("rejects temperature out of range", () => {
		const result = LLMRequestSchema.safeParse({ prompt: "Hi", temperature: 3 });
		expect(result.success).toBe(false);
	});
	it("rejects negative max_tokens", () => {
		const result = LLMRequestSchema.safeParse({ prompt: "Hi", max_tokens: -1 });
		expect(result.success).toBe(false);
	});
});
describe("LLMResponseSchema", () => {
	it("validates a complete response", () => {
		const result = LLMResponseSchema.safeParse({
			content: "Hello!",
			model: "gpt-4o",
			provider: "openai",
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			latency_ms: 120,
			cost_usd: 0.001,
		});
		expect(result.success).toBe(true);
	});
	it("rejects missing usage", () => {
		const result = LLMResponseSchema.safeParse({
			content: "Hello!",
			model: "gpt-4o",
			provider: "openai",
			latency_ms: 120,
			cost_usd: 0.001,
		});
		expect(result.success).toBe(false);
	});
});
// ── CostTracker Tests ────────────────────────────────────
describe("CostTracker", () => {
	let tracker;
	beforeEach(() => {
		tracker = new CostTracker();
	});
	it("starts with zero cost and tokens", () => {
		expect(tracker.getTotalCost()).toBe(0);
		expect(tracker.getTotalTokens()).toBe(0);
		expect(tracker.getRecords()).toEqual([]);
	});
	it("records and sums cost", () => {
		tracker.record("openai", "gpt-4o", 100, 0.01);
		tracker.record("openai", "gpt-4o", 200, 0.02);
		expect(tracker.getTotalCost()).toBeCloseTo(0.03);
		expect(tracker.getTotalTokens()).toBe(300);
	});
	it("tracks cost by provider", () => {
		tracker.record("openai", "gpt-4o", 100, 0.01);
		tracker.record("anthropic", "claude-sonnet-4-20250514", 200, 0.02);
		tracker.record("openai", "gpt-4o-mini", 50, 0.005);
		const byProvider = tracker.getCostByProvider();
		expect(byProvider.openai).toBeCloseTo(0.015);
		expect(byProvider.anthropic).toBeCloseTo(0.02);
	});
	it("returns a copy of records", () => {
		tracker.record("openai", "gpt-4o", 100, 0.01);
		const records = tracker.getRecords();
		records.push({ provider: "fake", model: "fake", tokens: 0, cost_usd: 0, timestamp: "" });
		expect(tracker.getRecords()).toHaveLength(1);
	});
	it("resets all records", () => {
		tracker.record("openai", "gpt-4o", 100, 0.01);
		tracker.reset();
		expect(tracker.getTotalCost()).toBe(0);
		expect(tracker.getRecords()).toEqual([]);
	});
	it("records include timestamp", () => {
		tracker.record("openai", "gpt-4o", 100, 0.01);
		const records = tracker.getRecords();
		expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});
// ── GeoLLMClient Tests ───────────────────────────────────
describe("GeoLLMClient", () => {
	let workspaceDir;
	let client;
	beforeEach(() => {
		workspaceDir = makeTmpDir();
		client = new GeoLLMClient(workspaceDir);
	});
	describe("selectProvider", () => {
		it("selects first enabled provider by default", () => {
			const provider = client.selectProvider();
			expect(provider.provider_id).toBe("openai");
			expect(provider.enabled).toBe(true);
		});
		it("selects preferred provider when available", () => {
			// Enable anthropic
			const manager = client.getConfigManager();
			const anthropic = manager.load("anthropic");
			manager.save({ ...anthropic, enabled: true });
			const provider = client.selectProvider("anthropic");
			expect(provider.provider_id).toBe("anthropic");
		});
		it("falls back to first enabled if preferred is not available", () => {
			const provider = client.selectProvider("nonexistent");
			expect(provider.provider_id).toBe("openai");
		});
		it("throws when no providers are enabled", () => {
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, enabled: false });
			expect(() => client.selectProvider()).toThrow("No LLM providers enabled");
		});
	});
	describe("chat — error handling", () => {
		it("throws when API key is not set", async () => {
			// Default openai has no api_key set
			await expect(client.chat({ prompt: "Hello", json_mode: false })).rejects.toThrow(
				"No API key configured",
			);
		});
		it("throws for unsupported provider", async () => {
			const manager = client.getConfigManager();
			const meta = manager.load("meta");
			manager.save({ ...meta, enabled: true, api_key: "test-key" });
			// Disable openai so meta is selected
			const openai = manager.load("openai");
			manager.save({ ...openai, enabled: false });
			await expect(client.chat({ prompt: "Hello", json_mode: false })).rejects.toThrow(
				"not yet supported",
			);
		});
	});
	describe("chat — OpenAI integration (mocked)", () => {
		it("calls OpenAI SDK and returns formatted response", async () => {
			// Mock OpenAI SDK
			vi.doMock("openai", () => ({
				default: class MockOpenAI {
					chat = {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [{ message: { content: "Mocked OpenAI response" } }],
								model: "gpt-4o",
								usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
							}),
						},
					};
				},
			}));
			// Set API key
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, api_key: "sk-test-key-12345" });
			// Re-create client to pick up mock
			const freshClient = new GeoLLMClient(workspaceDir);
			const response = await freshClient.chat({
				prompt: "Test prompt",
				system_instruction: "You are a helper",
				json_mode: false,
			});
			expect(response.content).toBe("Mocked OpenAI response");
			expect(response.provider).toBe("openai");
			expect(response.model).toBe("gpt-4o");
			expect(response.usage.total_tokens).toBe(30);
			expect(response.latency_ms).toBeGreaterThanOrEqual(0);
			expect(response.cost_usd).toBeGreaterThan(0);
			// Verify cost tracker recorded
			const tracker = freshClient.getCostTracker();
			expect(tracker.getTotalTokens()).toBe(30);
			vi.doUnmock("openai");
		});
	});
	describe("chat — Anthropic integration (mocked)", () => {
		it("calls Anthropic SDK and returns formatted response", async () => {
			vi.doMock("@anthropic-ai/sdk", () => ({
				default: class MockAnthropic {
					messages = {
						create: vi.fn().mockResolvedValue({
							content: [{ type: "text", text: "Mocked Anthropic response" }],
							model: "claude-sonnet-4-20250514",
							usage: { input_tokens: 15, output_tokens: 25 },
						}),
					};
				},
			}));
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, enabled: false });
			const anthropic = manager.load("anthropic");
			manager.save({ ...anthropic, enabled: true, api_key: "sk-ant-test-12345" });
			const freshClient = new GeoLLMClient(workspaceDir);
			const response = await freshClient.chat({
				prompt: "Test prompt",
				json_mode: false,
			});
			expect(response.content).toBe("Mocked Anthropic response");
			expect(response.provider).toBe("anthropic");
			expect(response.usage.prompt_tokens).toBe(15);
			expect(response.usage.completion_tokens).toBe(25);
			expect(response.usage.total_tokens).toBe(40);
			vi.doUnmock("@anthropic-ai/sdk");
		});
	});
	describe("chat — Google integration (mocked)", () => {
		it("calls Google Generative AI SDK and returns formatted response", async () => {
			vi.doMock("@google/generative-ai", () => ({
				GoogleGenerativeAI: class MockGoogleAI {
					getGenerativeModel() {
						return {
							generateContent: vi.fn().mockResolvedValue({
								response: {
									text: () => "Mocked Google response",
									usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12 },
								},
							}),
						};
					}
				},
			}));
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, enabled: false });
			const google = manager.load("google");
			manager.save({ ...google, enabled: true, api_key: "AIzaSy-test-12345" });
			const freshClient = new GeoLLMClient(workspaceDir);
			const response = await freshClient.chat({
				prompt: "Test prompt",
				json_mode: false,
			});
			expect(response.content).toBe("Mocked Google response");
			expect(response.provider).toBe("google");
			expect(response.usage.prompt_tokens).toBe(8);
			expect(response.usage.completion_tokens).toBe(12);
			vi.doUnmock("@google/generative-ai");
		});
	});
	describe("chat — Perplexity (OpenAI-compatible, mocked)", () => {
		it("routes Perplexity through OpenAI-compatible API", async () => {
			vi.doMock("openai", () => ({
				default: class MockOpenAI {
					chat = {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [{ message: { content: "Mocked Perplexity response" } }],
								model: "sonar-pro",
								usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
							}),
						},
					};
					constructor(opts) {
						// Verify it uses Perplexity base URL
						if (!opts.baseURL?.includes("perplexity")) {
							throw new Error("Expected Perplexity base URL");
						}
					}
				},
			}));
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, enabled: false });
			const perplexity = manager.load("perplexity");
			manager.save({ ...perplexity, enabled: true, api_key: "pplx-test-12345" });
			const freshClient = new GeoLLMClient(workspaceDir);
			const response = await freshClient.chat({
				prompt: "Test prompt",
				json_mode: false,
			});
			expect(response.content).toBe("Mocked Perplexity response");
			expect(response.provider).toBe("perplexity");
			vi.doUnmock("openai");
		});
	});
	describe("getCostTracker / getConfigManager", () => {
		it("returns CostTracker instance", () => {
			expect(client.getCostTracker()).toBeInstanceOf(CostTracker);
		});
		it("returns ProviderConfigManager instance", () => {
			expect(client.getConfigManager()).toBeInstanceOf(ProviderConfigManager);
		});
	});
});
//# sourceMappingURL=geo-llm-client.test.js.map
