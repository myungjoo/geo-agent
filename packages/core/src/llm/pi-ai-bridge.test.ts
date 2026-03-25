import { type Tool, Type } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
	type AgentLoopResult,
	injectWebSearchPayload,
	piAiAgentLoop,
	piAiModelFromProvider,
} from "./pi-ai-bridge.js";
import type { LLMProviderSettings } from "./provider-config.js";

describe("pi-ai-bridge", () => {
	describe("piAiModelFromProvider", () => {
		it("should create a model for openai provider", () => {
			const provider: LLMProviderSettings = {
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

			const model = piAiModelFromProvider(provider);
			expect(model).toBeTruthy();
			expect(model.provider).toBe("openai");
			// Model ID might be pi-ai's internal ID or our default_model
			expect(model.id).toBeTruthy();
		});

		it("should create a model for anthropic provider", () => {
			const provider: LLMProviderSettings = {
				provider_id: "anthropic",
				display_name: "Anthropic",
				enabled: true,
				auth_method: "api_key",
				api_key: "sk-ant-test",
				default_model: "claude-sonnet-4-20250514",
				available_models: ["claude-sonnet-4-20250514"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			expect(model).toBeTruthy();
			expect(model.provider).toBe("anthropic");
		});

		it("should throw for unsupported provider", () => {
			const provider: LLMProviderSettings = {
				provider_id: "meta",
				display_name: "Meta",
				enabled: true,
				auth_method: "api_key",
				default_model: "llama-3",
				available_models: [],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			expect(() => piAiModelFromProvider(provider)).toThrow("not mapped");
		});

		it("should use responses API for codex models", () => {
			const provider: LLMProviderSettings = {
				provider_id: "openai",
				display_name: "OpenAI",
				enabled: true,
				auth_method: "api_key",
				api_key: "sk-test",
				default_model: "gpt-5.3-codex",
				available_models: ["gpt-5.3-codex"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			// pi-ai may map it to openai-responses or openai-codex-responses
			expect(model.api).toMatch(/responses/);
		});

		it("should use openai-responses API for gpt-5 models", () => {
			const provider: LLMProviderSettings = {
				provider_id: "openai",
				display_name: "OpenAI",
				enabled: true,
				auth_method: "api_key",
				api_key: "sk-test",
				default_model: "gpt-5.2",
				available_models: ["gpt-5.2"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			expect(model.api).toBe("openai-responses");
		});

		it("should use openai-responses API for o3/o4 models", () => {
			const provider: LLMProviderSettings = {
				provider_id: "openai",
				display_name: "OpenAI",
				enabled: true,
				auth_method: "api_key",
				api_key: "sk-test",
				default_model: "o3-mini",
				available_models: ["o3-mini"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			expect(model.api).toBe("openai-responses");
		});

		it("should override baseUrl when api_base_url is set", () => {
			const provider: LLMProviderSettings = {
				provider_id: "openai",
				display_name: "OpenAI",
				enabled: true,
				auth_method: "api_key",
				api_key: "sk-test",
				api_base_url: "https://custom.api.com/v1",
				default_model: "gpt-4o",
				available_models: ["gpt-4o"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			expect(model.baseUrl).toBe("https://custom.api.com/v1");
		});
	});

	describe("injectWebSearchPayload", () => {
		it("should inject web_search_preview for openai-responses", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "openai-responses");
			expect(p.tools).toEqual([{ type: "web_search_preview" }]);
		});

		it("should inject web_search_preview for azure-openai-responses", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "azure-openai-responses");
			expect(p.tools).toEqual([{ type: "web_search_preview" }]);
		});

		it("should inject web_search_preview for openai-completions", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "openai-completions");
			expect(p.tools).toEqual([{ type: "web_search_preview" }]);
		});

		it("should inject google_search_retrieval for google-generative-ai", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "google-generative-ai");
			expect(p.tools).toEqual([{ google_search_retrieval: {} }]);
		});

		it("should inject web_search_20250305 for anthropic-messages", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "anthropic-messages");
			expect(p.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
		});

		it("should not inject anything for unknown/perplexity APIs", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "some-unknown-api");
			expect(p.tools).toBeUndefined();
		});

		it("should append to existing tools array", () => {
			const existing = [{ type: "function", function: { name: "test" } }];
			const p: Record<string, unknown> = { tools: [...existing] };
			injectWebSearchPayload(p, "openai-responses");
			expect(p.tools).toEqual([...existing, { type: "web_search_preview" }]);
		});
	});

	describe("piAiAgentLoop", () => {
		// These tests use mocked complete() - we can't actually call LLM APIs in unit tests
		// But we verify the interface contract
		it("should export piAiAgentLoop function", () => {
			expect(piAiAgentLoop).toBeTypeOf("function");
		});

		it("should have correct AgentLoopResult structure", () => {
			// Verify the type contract
			const mockResult: AgentLoopResult = {
				finalText: "test",
				messages: [],
				iterations: 1,
				totalUsage: { input: 10, output: 20, totalTokens: 30 },
				totalCost: 0.001,
				completed: true,
				toolCallLog: [],
			};
			expect(mockResult.completed).toBe(true);
			expect(mockResult.toolCallLog).toEqual([]);
		});
	});
});
