/**
 * pi-ai Bridge — Adapts @mariozechner/pi-ai to the GEO Agent system
 *
 * Provides:
 * 1. piAiModelFromProvider() — maps GeoLLMClient provider config to pi-ai Model
 * 2. piAiComplete() — single-turn completion returning GEO LLMResponse
 * 3. piAiAgentLoop() — multi-turn tool-calling agent loop
 */
import {
	type AssistantMessage,
	type Context,
	type Model,
	type Api,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	type TextContent,
	type UserMessage,
	complete,
	getModel,
	getEnvApiKey,
	calculateCost,
	validateToolCall,
} from "@mariozechner/pi-ai";
import type { TSchema } from "@mariozechner/pi-ai";
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
 * Falls back to env-based API key discovery if no explicit key.
 */
export function piAiModelFromProvider(provider: LLMProviderSettings): Model<Api> {
	const piProvider = PROVIDER_MAP[provider.provider_id];
	if (!piProvider) {
		throw new Error(`Provider "${provider.provider_id}" not mapped to pi-ai provider`);
	}

	try {
		const model = getModel(piProvider as any, provider.default_model as any);
		// Override baseUrl if provider has custom one
		if (provider.api_base_url) {
			return { ...model, baseUrl: provider.api_base_url };
		}
		return model;
	} catch {
		// Model not in pi-ai's registry — build a minimal Model object
		return {
			id: provider.default_model,
			name: provider.default_model,
			api: piProvider === "anthropic" ? "anthropic-messages" : "openai-completions",
			provider: piProvider,
			baseUrl: provider.api_base_url ?? getDefaultBaseUrl(piProvider),
			reasoning: false,
			input: ["text"],
			cost: { input: 0.002, output: 0.006, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: provider.max_tokens,
		} as Model<Api>;
	}
}

function getDefaultBaseUrl(provider: string): string {
	switch (provider) {
		case "openai":
			return "https://api.openai.com/v1";
		case "anthropic":
			return "https://api.anthropic.com";
		case "google":
			return "https://generativelanguage.googleapis.com";
		default:
			return "";
	}
}

// ── Single-turn Completion ──────────────────────────────────

/**
 * Complete a single LLM request using pi-ai, returning the GEO LLMResponse format.
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

	const startTime = Date.now();
	const response = await complete(model, context, {
		apiKey: options?.apiKey,
		temperature: request.temperature,
		maxTokens: request.max_tokens,
	});

	const textContent = response.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("");

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

export interface ToolHandler<TParams = Record<string, unknown>> {
	(params: TParams): Promise<string>;
}

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

	let totalUsage = { input: 0, output: 0, totalTokens: 0 };
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
		const toolCalls = response.content.filter(
			(c): c is ToolCall => c.type === "toolCall",
		);

		// If no tool calls, we're done
		if (toolCalls.length === 0 || response.stopReason === "stop") {
			finalText = response.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("");
			return { finalText, messages, iterations, totalUsage, totalCost, completed: true, toolCallLog };
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
