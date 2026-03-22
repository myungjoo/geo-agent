/**
 * Azure OpenAI LLM Integration Tests
 *
 * Requires AZURE_OPENAI_API_KEY and AZURE_OPENAI_BASE_URL env vars.
 * Skips cleanly when credentials are absent (fork PRs, local dev).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeoLLMClient } from "../../packages/core/src/llm/geo-llm-client.js";
import { ProviderConfigManager } from "../../packages/core/src/llm/provider-config.js";

const hasAzureCredentials =
	!!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_BASE_URL;

describe.skipIf(!hasAzureCredentials)("Azure OpenAI Integration", () => {
	let workspaceDir: string;

	beforeAll(() => {
		// Temp workspace — no llm-providers.json, rely on env vars
		workspaceDir = fs.mkdtempSync(
			path.join(os.tmpdir(), `geo-llm-integration-${crypto.randomBytes(4).toString("hex")}-`),
		);
	});

	afterAll(() => {
		try {
			fs.rmSync(workspaceDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("env var fallback populates microsoft provider", () => {
		const manager = new ProviderConfigManager(workspaceDir);
		const providers = manager.loadAll();
		const microsoft = providers.find((p) => p.provider_id === "microsoft");

		expect(microsoft?.api_key).toBe(process.env.AZURE_OPENAI_API_KEY);
		expect(microsoft?.api_base_url).toBe(process.env.AZURE_OPENAI_BASE_URL);
		expect(microsoft?.enabled).toBe(true);
	});

	it("GeoLLMClient selects microsoft provider", () => {
		const client = new GeoLLMClient(workspaceDir);
		const provider = client.selectProvider();

		expect(provider.provider_id).toBe("microsoft");
		expect(provider.api_key).toBe(process.env.AZURE_OPENAI_API_KEY);
	});

	it("completes a simple chat request via Azure OpenAI", async () => {
		const client = new GeoLLMClient(workspaceDir);
		const response = await client.chat({
			prompt: "Reply with exactly one word: HELLO",
			max_tokens: 50,
			temperature: 0,
			json_mode: false,
		});

		expect(response.content).toContain("HELLO");
		expect(response.provider).toBeDefined();
		expect(response.usage.total_tokens).toBeGreaterThan(0);
	});

	it("json_mode returns parseable JSON", async () => {
		const client = new GeoLLMClient(workspaceDir);
		const response = await client.chat({
			prompt: 'Return a JSON object with key "status" and value "ok". No other text.',
			max_tokens: 100,
			temperature: 0,
			json_mode: true,
		});

		const parsed = JSON.parse(response.content);
		expect(parsed.status).toBe("ok");
	});
});
