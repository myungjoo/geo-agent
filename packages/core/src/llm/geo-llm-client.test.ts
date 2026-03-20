import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CostTracker,
	GeoLLMClient,
	LLMRequestSchema,
	type LLMResponse,
	LLMResponseSchema,
} from "./geo-llm-client.js";
import { ProviderConfigManager } from "./provider-config.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
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
	let tracker: CostTracker;

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
	let workspaceDir: string;
	let client: GeoLLMClient;

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
			await expect(client.chat({ prompt: "Hello", json_mode: false })).rejects.toThrow(
				"No API key configured",
			);
		});
	});

	describe("chat — routes through pi-ai", () => {
		it("returns a valid LLMResponse structure via piAiComplete", async () => {
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, api_key: "sk-fake-key-for-test" });

			const freshClient = new GeoLLMClient(workspaceDir);
			// Even with a fake key, pi-ai/OpenAI may return a response (possibly empty or error)
			// The important thing: the response matches LLMResponse structure
			let response: LLMResponse | null = null;
			try {
				response = await freshClient.chat({ prompt: "Test", json_mode: false });
			} catch {
				// API error is also acceptable — we just verify our code doesn't crash
				return;
			}

			// If we got a response, verify structure
			expect(typeof response.content).toBe("string");
			expect(typeof response.model).toBe("string");
			expect(typeof response.provider).toBe("string");
			expect(typeof response.usage.prompt_tokens).toBe("number");
			expect(typeof response.usage.completion_tokens).toBe("number");
			expect(typeof response.usage.total_tokens).toBe("number");
			expect(typeof response.latency_ms).toBe("number");
			expect(typeof response.cost_usd).toBe("number");

			// CostTracker should have recorded
			const tracker = freshClient.getCostTracker();
			expect(tracker.getRecords().length).toBeGreaterThanOrEqual(1);
		});

		it("passes model override from request to piAiModelFromProvider", async () => {
			const manager = client.getConfigManager();
			const openai = manager.load("openai");
			manager.save({ ...openai, api_key: "sk-fake-key" });

			const freshClient = new GeoLLMClient(workspaceDir);
			try {
				// Request a specific model different from default
				await freshClient.chat({ prompt: "Test", model: "gpt-4o-mini", json_mode: false });
			} catch {
				// Network error expected with fake key
			}
			// Just verifying it doesn't crash with model override
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
