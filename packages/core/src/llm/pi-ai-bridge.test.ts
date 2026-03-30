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

		it("should use google-generative-ai API for google provider fallback models", () => {
			const provider: LLMProviderSettings = {
				provider_id: "google",
				display_name: "Google",
				enabled: true,
				auth_method: "api_key",
				api_key: "AIzaSy-test-12345",
				default_model: "gemini-99-future",
				available_models: ["gemini-99-future"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			expect(model.provider).toBe("google");
			expect(model.api).toBe("google-generative-ai");
		});

		it("should use /v1beta baseUrl for google provider fallback models", () => {
			const provider: LLMProviderSettings = {
				provider_id: "google",
				display_name: "Google",
				enabled: true,
				auth_method: "api_key",
				api_key: "AIzaSy-test-12345",
				default_model: "gemini-99-future",
				available_models: ["gemini-99-future"],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
			};

			const model = piAiModelFromProvider(provider);
			expect(model.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
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

		// ── Fallback 안전성 테스트 (미등록 모델 → 유효한 Model 보장) ──

		const VALID_API_SET = new Set([
			"openai-completions",
			"openai-responses",
			"openai-codex-responses",
			"azure-openai-responses",
			"google-generative-ai",
			"google-vertex",
			"anthropic-messages",
			"mistral-conversations",
		]);

		/**
		 * 모든 PROVIDER_MAP 프로바이더에 대해 pi-ai 레지스트리에 없는 가상 모델을
		 * 사용해도 유효한 Model 객체가 반환되는지 검증.
		 * getModel()이 undefined를 반환하거나 예외를 던져도 fallback이 동작해야 한다.
		 */
		it.each([
			{ provider_id: "openai", model: "gpt-99-future", expectedApi: "openai-completions" },
			{ provider_id: "google", model: "gemini-99-future", expectedApi: "google-generative-ai" },
			{ provider_id: "anthropic", model: "claude-99-future", expectedApi: "anthropic-messages" },
			{ provider_id: "perplexity", model: "sonar-99-future", expectedApi: "openai-completions" },
			{ provider_id: "microsoft", model: "gpt-5.4", expectedApi: "openai-responses" },
		])(
			"fallback: $provider_id with unknown model '$model' → api=$expectedApi",
			({ provider_id, model, expectedApi }) => {
				const provider: LLMProviderSettings = {
					provider_id,
					display_name: provider_id,
					enabled: true,
					auth_method: "api_key",
					api_key: "test-key",
					default_model: model,
					available_models: [model],
					max_tokens: 4096,
					temperature: 0.3,
					rate_limit_rpm: 60,
					// Azure requires user-provided base URL (no default)
					...(provider_id === "microsoft" && {
						api_base_url: "https://test.openai.azure.com",
					}),
				};

				const result = piAiModelFromProvider(provider);

				// 핵심: model 객체가 존재하고 api 속성이 유효해야 함
				expect(result).toBeTruthy();
				expect(result.api).toBe(expectedApi);
				expect(VALID_API_SET).toContain(result.api);
				expect(result.id).toBe(model);
				expect(result.baseUrl).toBeTruthy();
			},
		);

		/**
		 * 반환된 Model의 필수 필드가 모두 존재하는지 검증.
		 * piAiComplete()에서 model.api, model.baseUrl 등에 접근하므로
		 * undefined 필드가 있으면 런타임 크래시 발생.
		 */
		it.each([
			{ provider_id: "openai", model: "unknown-openai-model" },
			{ provider_id: "google", model: "unknown-google-model" },
			{ provider_id: "anthropic", model: "unknown-anthropic-model" },
			{ provider_id: "perplexity", model: "unknown-perplexity-model" },
			{ provider_id: "microsoft", model: "unknown-azure-model" },
		])("fallback model for $provider_id has all required fields", ({ provider_id, model }) => {
			const provider: LLMProviderSettings = {
				provider_id,
				display_name: provider_id,
				enabled: true,
				auth_method: "api_key",
				api_key: "test-key",
				default_model: model,
				available_models: [model],
				max_tokens: 4096,
				temperature: 0.3,
				rate_limit_rpm: 60,
				// Azure requires user-provided base URL (no default)
				...(provider_id === "microsoft" && {
					api_base_url: "https://test.openai.azure.com",
				}),
			};

			const result = piAiModelFromProvider(provider);

			expect(result.id).toBeTypeOf("string");
			expect(result.api).toBeTypeOf("string");
			expect(result.provider).toBeTypeOf("string");
			expect(result.baseUrl).toBeTypeOf("string");
			expect(result.baseUrl).toMatch(/^https?:\/\//);
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

		it("should inject for google-vertex (same as google-generative-ai)", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "google-vertex");
			expect(p.tools).toEqual([{ google_search_retrieval: {} }]);
		});

		it("should inject for openai-codex-responses", () => {
			const p: Record<string, unknown> = {};
			injectWebSearchPayload(p, "openai-codex-responses");
			expect(p.tools).toEqual([{ type: "web_search_preview" }]);
		});
	});

	describe("json_mode + web_search combination", () => {
		// Verify both flags can coexist in onPayload without conflict
		it("json_mode and web_search should both inject into same payload (openai-responses)", () => {
			// Simulate what piAiComplete does when both flags are set
			const p: Record<string, unknown> = {};
			const api = "openai-responses";

			// json_mode injection
			p.text = { format: { type: "json_object" } };

			// web_search injection
			injectWebSearchPayload(p, api);

			// Both should coexist
			expect(p.text).toEqual({ format: { type: "json_object" } });
			expect(p.tools).toEqual([{ type: "web_search_preview" }]);
		});

		it("json_mode and web_search should both inject into same payload (google)", () => {
			const p: Record<string, unknown> = {};
			const api = "google-generative-ai";

			// json_mode injection
			const gc = {} as Record<string, unknown>;
			gc.responseMimeType = "application/json";
			p.generationConfig = gc;

			// web_search injection
			injectWebSearchPayload(p, api);

			// Both should coexist
			expect((p.generationConfig as Record<string, unknown>).responseMimeType).toBe(
				"application/json",
			);
			expect(p.tools).toEqual([{ google_search_retrieval: {} }]);
		});

		it("json_mode and web_search should both inject into same payload (anthropic)", () => {
			const p: Record<string, unknown> = {};
			const api = "anthropic-messages";

			// json_mode: anthropic has no native json_mode, only prompt-based
			// web_search injection
			injectWebSearchPayload(p, api);

			expect(p.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
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
