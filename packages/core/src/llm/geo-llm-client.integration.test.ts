/**
 * Integration tests for GeoLLMClient using real API keys.
 *
 * These tests ONLY run when a real API key is found in the workspace.
 * If no key is configured, tests are skipped (not failed).
 *
 * Reads from: ~/.geo-agent/llm-providers.json (default workspace)
 * or ./run/llm-providers.json
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GeoLLMClient, type LLMResponse } from "./geo-llm-client.js";
import { ProviderConfigManager } from "./provider-config.js";

// Find workspace with API key
function findWorkspaceWithApiKey(): string | null {
	const candidates = [path.join(process.env.HOME ?? "", ".geo-agent"), "./run", "."];
	for (const dir of candidates) {
		try {
			const mgr = new ProviderConfigManager(dir);
			const enabled = mgr.getEnabled().filter((p) => p.api_key);
			if (enabled.length > 0) return dir;
		} catch {}
	}
	return null;
}

const workspaceDir = findWorkspaceWithApiKey();
const hasApiKey = workspaceDir !== null;

describe("GeoLLMClient — real API integration", () => {
	it.skipIf(!hasApiKey)(
		"should complete a simple prompt via pi-ai",
		async () => {
			const client = new GeoLLMClient(workspaceDir!);
			const provider = client.selectProvider();

			const response: LLMResponse = await client.chat({
				prompt: "Reply with exactly: HELLO_GEO_TEST",
				max_tokens: 50,
				temperature: 0,
				json_mode: false,
			});

			// Basic structure checks
			expect(response.content).toBeTruthy();
			expect(response.content.length).toBeGreaterThan(0);
			expect(response.model).toBeTruthy();
			expect(response.provider).toBeTruthy();

			// Usage must be populated
			expect(response.usage.prompt_tokens).toBeGreaterThan(0);
			expect(response.usage.completion_tokens).toBeGreaterThan(0);
			expect(response.usage.total_tokens).toBeGreaterThan(0);

			// Latency and cost must be positive
			expect(response.latency_ms).toBeGreaterThan(0);
			expect(response.cost_usd).toBeGreaterThanOrEqual(0);

			// Cost tracker should have recorded
			const tracker = client.getCostTracker();
			expect(tracker.getTotalTokens()).toBeGreaterThan(0);
		},
		30000,
	);

	it.skipIf(!hasApiKey)(
		"should handle json_mode correctly",
		async () => {
			const client = new GeoLLMClient(workspaceDir!);

			const response = await client.chat({
				prompt: 'Return a JSON object with key "status" and value "ok". Respond in JSON format.',
				system_instruction: "You are a JSON generator. Always respond with valid JSON only.",
				max_tokens: 100,
				temperature: 0,
				json_mode: true,
			});

			expect(response.content).toBeTruthy();
			// Should be parseable JSON
			const parsed = JSON.parse(response.content);
			expect(parsed).toBeTruthy();
			expect(typeof parsed).toBe("object");
		},
		30000,
	);

	it.skipIf(!hasApiKey)(
		"should populate all LLMResponse fields",
		async () => {
			const client = new GeoLLMClient(workspaceDir!);

			const response = await client.chat({
				prompt: "Say hello in one word.",
				max_tokens: 16,
				temperature: 0,
				json_mode: false,
			});

			// Verify the response matches LLMResponseSchema structure
			expect(typeof response.content).toBe("string");
			expect(typeof response.model).toBe("string");
			expect(typeof response.provider).toBe("string");
			expect(typeof response.usage.prompt_tokens).toBe("number");
			expect(typeof response.usage.completion_tokens).toBe("number");
			expect(typeof response.usage.total_tokens).toBe("number");
			expect(typeof response.latency_ms).toBe("number");
			expect(typeof response.cost_usd).toBe("number");
		},
		30000,
	);
});
