/**
 * pi-ai Bridge — Adapts @mariozechner/pi-ai to the GEO Agent system
 *
 * Provides:
 * 1. piAiModelFromProvider() — maps GeoLLMClient provider config to pi-ai Model
 * 2. piAiComplete() — single-turn completion returning GEO LLMResponse
 * 3. piAiAgentLoop() — multi-turn tool-calling agent loop
 */
import {
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type TextContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	type UserMessage,
	calculateCost,
	complete,
	getEnvApiKey,
	getModel,
	validateToolCall,
} from "@mariozechner/pi-ai";
import type { TSchema } from "@mariozechner/pi-ai";
import type { ModelCostOverrideMap } from "../db/repositories/model-cost-override-repository.js";
import type { LLMRequest, LLMResponse } from "./geo-llm-client.js";
import type { LLMProviderSettings } from "./provider-config.js";

// ── Provider Mapping ────────────────────────────────────────

/** Map GEO provider_id + model to pi-ai's known provider/model pair */
const PROVIDER_MAP: Record<string, string> = {
	openai: "openai",
	anthropic: "anthropic",
	google: "google",
	perplexity: "openai", // OpenAI-compatible
	microsoft: "azure-openai-responses",
};

/**
 * Resolve a pi-ai Model from GEO provider settings.
 * Applies cost overrides from the override map when available.
 * Falls back to pi-ai's built-in registry, then hardcoded fallback.
 *
 * @param provider - GEO LLM provider settings
 * @param costOverrides - Optional override map keyed by "provider_id:model_id"
 */
export function piAiModelFromProvider(
	provider: LLMProviderSettings,
	costOverrides?: ModelCostOverrideMap,
): Model<Api> {
	const piProvider = PROVIDER_MAP[provider.provider_id];
	if (!piProvider) {
		throw new Error(`Provider "${provider.provider_id}" not mapped to pi-ai provider`);
	}

	// Perplexity uses OpenAI-compatible API with custom baseUrl
	const effectiveBaseUrl =
		provider.api_base_url ??
		(provider.provider_id === "perplexity" ? "https://api.perplexity.ai" : undefined);

	// Check cost override map first (keyed by GEO provider_id:model_id)
	const overrideKey = `${provider.provider_id}:${provider.default_model}`;
	const costOverride = costOverrides?.get(overrideKey);

	// Try pi-ai's built-in registry
	let model: Model<Api> | undefined;
	try {
		model = getModel(piProvider as any, provider.default_model as any);
	} catch {
		// getModel threw — fall through to manual build
	}

	if (model) {
		// Apply cost override on top of registry model if present
		const finalModel = effectiveBaseUrl ? { ...model, baseUrl: effectiveBaseUrl } : { ...model };
		if (costOverride) {
			finalModel.cost = {
				input: costOverride.input_per_1m,
				output: costOverride.output_per_1m,
				cacheRead: costOverride.cache_read_per_1m,
				cacheWrite: costOverride.cache_write_per_1m,
			};
		}
		return finalModel;
	}

	// Model not in pi-ai's registry — build a minimal Model object
	const modelId = provider.default_model.toLowerCase();
	let api: string;
	if (piProvider === "google") {
		api = "google-generative-ai";
	} else if (piProvider === "anthropic") {
		api = "anthropic-messages";
	} else if (modelId.includes("codex")) {
		api = "openai-codex-responses";
	} else if (modelId.startsWith("gpt-5") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
		api = "openai-responses";
	} else {
		api = "openai-completions";
	}

	// Use override cost if available; otherwise use minimal fallback
	const cost = costOverride
		? {
				input: costOverride.input_per_1m,
				output: costOverride.output_per_1m,
				cacheRead: costOverride.cache_read_per_1m,
				cacheWrite: costOverride.cache_write_per_1m,
			}
		: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

	return {
		id: provider.default_model,
		name: provider.default_model,
		api,
		provider: piProvider,
		baseUrl: effectiveBaseUrl ?? getDefaultBaseUrl(piProvider),
		reasoning: false,
		input: ["text"],
		cost,
		contextWindow: 128000,
		maxTokens: provider.max_tokens,
	} as Model<Api>;
}

function getDefaultBaseUrl(provider: string): string {
	switch (provider) {
		case "openai":
			return "https://api.openai.com/v1";
		case "anthropic":
			return "https://api.anthropic.com";
		case "google":
			return "https://generativelanguage.googleapis.com/v1beta";
		default:
			return "";
	}
}

// ── Web Search Payload Injection ─────────────────────────────

/**
 * Injects web search tool configuration into the raw API payload.
 * Each provider has its own format for enabling web search.
 *
 * - OpenAI Responses / Azure: `tools` array with `{ type: "web_search_preview" }`
 * - OpenAI Completions: `tools` array with `{ type: "web_search_preview" }`
 * - Google: `tools` array with `{ google_search_retrieval: {} }`
 * - Anthropic: `tools` array with `{ type: "web_search_20250305", name: "web_search", max_uses: 3 }`
 * - Perplexity: inherently uses web search, no injection needed
 */
export function injectWebSearchPayload(p: Record<string, unknown>, api: string): void {
	if (
		api === "openai-responses" ||
		api === "openai-codex-responses" ||
		api === "azure-openai-responses"
	) {
		const tools = (p.tools ?? []) as unknown[];
		tools.push({ type: "web_search_preview" });
		p.tools = tools;
	} else if (api === "openai-completions" || api === "mistral-conversations") {
		const tools = (p.tools ?? []) as unknown[];
		tools.push({ type: "web_search_preview" });
		p.tools = tools;
	} else if (api === "google-generative-ai" || api === "google-vertex") {
		const tools = (p.tools ?? []) as unknown[];
		tools.push({ google_search_retrieval: {} });
		p.tools = tools;
	} else if (api === "anthropic-messages") {
		const tools = (p.tools ?? []) as unknown[];
		tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 3 });
		p.tools = tools;
	}
	// Perplexity (openai-completions with perplexity baseUrl): web search is default, no injection
}

// ── Single-turn Completion ──────────────────────────────────

/**
 * Complete a single LLM request using pi-ai, returning the GEO LLMResponse format.
 * Supports json_mode via onPayload injection for providers that need it.
 */
export async function piAiComplete(
	model: Model<Api>,
	request: LLMRequest,
	options?: { apiKey?: string },
): Promise<LLMResponse> {
	const messages: UserMessage[] = [
		{
			role: "user",
			content: request.prompt,
			timestamp: Date.now(),
		},
	];

	const context: Context = {
		systemPrompt: request.system_instruction,
		messages,
	};

	// Build onPayload: inject json_mode and/or web_search into raw API payload
	const needsPayloadHook = request.json_mode || request.web_search;
	const onPayload = needsPayloadHook
		? (payload: unknown) => {
				const p = payload as Record<string, unknown>;
				const api = model.api;

				// ── json_mode ───────────────────────────────────────
				if (request.json_mode) {
					if (api === "openai-completions" || api === "mistral-conversations") {
						p.response_format = { type: "json_object" };
					} else if (
						api === "openai-responses" ||
						api === "openai-codex-responses" ||
						api === "azure-openai-responses"
					) {
						p.text = { format: { type: "json_object" } };
					} else if (api === "google-generative-ai" || api === "google-vertex") {
						const gc = (p.generationConfig ?? {}) as Record<string, unknown>;
						gc.responseMimeType = "application/json";
						p.generationConfig = gc;
					}
					// Anthropic: no native json_mode — handled via prompt instructions
				}

				// ── web_search ──────────────────────────────────────
				if (request.web_search) {
					injectWebSearchPayload(p, api);
				}

				return p;
			}
		: undefined;

	const startTime = Date.now();
	const response = await complete(model, context, {
		apiKey: options?.apiKey,
		temperature: request.temperature,
		maxTokens: request.max_tokens,
		onPayload,
	});

	const textContent = response.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("");

	// 4-D 원칙: 빈 응답 + errorMessage는 에러로 전파 (silent failure 금지)
	if (!textContent && response.errorMessage) {
		const errDetail =
			typeof response.errorMessage === "string"
				? response.errorMessage
				: JSON.stringify(response.errorMessage);
		throw new Error(`LLM API error (${model.provider}/${model.id}): ${errDetail}`);
	}

	const cost = calculateCost(model, response.usage);

	return {
		content: textContent,
		model: response.model,
		provider: response.provider,
		usage: {
			prompt_tokens: response.usage.input,
			completion_tokens: response.usage.output,
			total_tokens: response.usage.totalTokens,
		},
		latency_ms: Date.now() - startTime,
		cost_usd: cost.total,
	};
}

// ── Tool-calling Agent Loop ─────────────────────────────────

export type ToolHandler<TParams = Record<string, unknown>> = (params: TParams) => Promise<string>;

export interface AgentLoopOptions {
	/** pi-ai Model to use */
	model: Model<Api>;
	/** System prompt (from SKILL.md or defaults) */
	systemPrompt: string;
	/** User message to start the conversation */
	userMessage: string;
	/** Tool definitions (pi-ai format with TypeBox schemas) */
	tools: Tool[];
	/** Map of tool name → handler function */
	toolHandlers: Record<string, ToolHandler>;
	/** API key for the provider */
	apiKey?: string;
	/** Max iterations to prevent infinite loops (default: 15) */
	maxIterations?: number;
	/** Temperature (default: 0.3) */
	temperature?: number;
	/** Max tokens per response (default: 4096) */
	maxTokens?: number;
	/** Callback for each assistant message (for logging/tracking) */
	onAssistantMessage?: (msg: AssistantMessage, iteration: number) => void;
	/** Callback for each tool result (for logging/tracking) */
	onToolResult?: (toolName: string, result: string, iteration: number) => void;
}

export interface AgentLoopResult {
	/** Final text response from the LLM */
	finalText: string;
	/** All messages in the conversation */
	messages: (UserMessage | AssistantMessage | ToolResultMessage)[];
	/** Number of iterations (LLM calls) */
	iterations: number;
	/** Total usage across all calls */
	totalUsage: { input: number; output: number; totalTokens: number };
	/** Total cost across all calls */
	totalCost: number;
	/** Whether the loop completed normally (vs hitting maxIterations) */
	completed: boolean;
	/** Tool calls made during the loop */
	toolCallLog: Array<{ name: string; args: Record<string, unknown>; result: string }>;
}

/**
 * Run a multi-turn agent loop: LLM → tool calls → results → LLM → ... → final text.
 *
 * The loop continues until:
 * - The LLM produces a response with no tool calls (stopReason: "stop")
 * - maxIterations is reached
 * - An error occurs
 */
export async function piAiAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
	const {
		model,
		systemPrompt,
		userMessage,
		tools,
		toolHandlers,
		apiKey,
		maxIterations = 15,
		temperature = 0.3,
		maxTokens = 4096,
		onAssistantMessage,
		onToolResult,
	} = options;

	const messages: (UserMessage | AssistantMessage | ToolResultMessage)[] = [
		{ role: "user", content: userMessage, timestamp: Date.now() },
	];

	const totalUsage = { input: 0, output: 0, totalTokens: 0 };
	let totalCost = 0;
	let iterations = 0;
	let finalText = "";
	const toolCallLog: AgentLoopResult["toolCallLog"] = [];

	for (let i = 0; i < maxIterations; i++) {
		iterations++;

		const context: Context = {
			systemPrompt,
			messages,
			tools: tools.length > 0 ? tools : undefined,
		};

		const response = await complete(model, context, {
			apiKey,
			temperature,
			maxTokens,
		});

		messages.push(response);
		onAssistantMessage?.(response, iterations);

		// Accumulate usage
		totalUsage.input += response.usage.input;
		totalUsage.output += response.usage.output;
		totalUsage.totalTokens += response.usage.totalTokens;
		totalCost += calculateCost(model, response.usage).total;

		// Extract tool calls
		const toolCalls = response.content.filter((c): c is ToolCall => c.type === "toolCall");

		// If no tool calls, we're done
		if (toolCalls.length === 0 || response.stopReason === "stop") {
			finalText = response.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("");
			return {
				finalText,
				messages,
				iterations,
				totalUsage,
				totalCost,
				completed: true,
				toolCallLog,
			};
		}

		// Execute tool calls
		for (const toolCall of toolCalls) {
			const handler = toolHandlers[toolCall.name];
			let resultText: string;
			let isError = false;

			if (!handler) {
				resultText = `Error: Unknown tool "${toolCall.name}"`;
				isError = true;
			} else {
				try {
					// Validate arguments against schema
					const validatedArgs = validateToolCall(tools, toolCall);
					resultText = await handler(validatedArgs);
				} catch (err) {
					resultText = `Error executing tool "${toolCall.name}": ${err instanceof Error ? err.message : String(err)}`;
					isError = true;
				}
			}

			toolCallLog.push({ name: toolCall.name, args: toolCall.arguments, result: resultText });
			onToolResult?.(toolCall.name, resultText, iterations);

			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: resultText }],
				isError,
				timestamp: Date.now(),
			};
			messages.push(toolResult);
		}
	}

	// maxIterations reached — extract whatever text we have
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") as
		| AssistantMessage
		| undefined;
	if (lastAssistant) {
		finalText = lastAssistant.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("");
	}

	return { finalText, messages, iterations, totalUsage, totalCost, completed: false, toolCallLog };
}
