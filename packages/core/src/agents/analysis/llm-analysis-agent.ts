/**
 * LLM-Driven Analysis Agent
 *
 * Uses pi-ai's tool-calling agent loop to let the LLM drive the GEO evaluation.
 * The LLM follows the SKILL.md prompt and calls analysis tools to gather data.
 *
 * Falls back to the existing rule-based runAnalysis() if:
 * - No LLM is available (chatLLM not provided)
 * - The LLM fails or produces invalid output
 * - The agent loop exceeds maxIterations
 */
import { v4 as uuidv4 } from "uuid";
import type { Model, Api } from "@mariozechner/pi-ai";
import { piAiAgentLoop, type AgentLoopResult } from "../../llm/pi-ai-bridge.js";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import { loadBuiltinSkill } from "../../skills/skill-loader.js";
import {
	ANALYSIS_TOOLS,
	createAnalysisToolHandlers,
	createAnalysisToolState,
	type AnalysisToolDeps,
	type AnalysisToolState,
} from "./tools.js";
import { type AnalysisDeps, type AnalysisOutput, runAnalysis } from "./analysis-agent.js";
import type { RichAnalysisReport } from "./rich-analysis-schema.js";

// ── LLM Analysis Config ─────────────────────────────────────

export interface LLMAnalysisConfig {
	/** pi-ai Model for the agent loop */
	model: Model<Api>;
	/** API key for the LLM provider */
	apiKey?: string;
	/** Max iterations for the agent loop (default: 12) */
	maxIterations?: number;
	/** Temperature (default: 0.3) */
	temperature?: number;
}

export interface LLMAnalysisInput {
	target_id: string;
	target_url: string;
	crawl_timeout?: number;
}

export interface LLMAnalysisResult {
	/** The AnalysisOutput (same format as rule-based) */
	output: AnalysisOutput;
	/** Whether the LLM agent was used (vs rule-based fallback) */
	usedLLMAgent: boolean;
	/** The LLM's synthesized assessment (null if rule-based) */
	llmAssessment: string | null;
	/** Rich 10-tab report from the LLM (null if rule-based or parsing failed) */
	richReport: RichAnalysisReport | null;
	/** Agent loop details (null if rule-based) */
	agentLoopResult: AgentLoopResult | null;
	/** Tool call log from the agent loop */
	toolCallLog: Array<{ name: string; args: Record<string, unknown>; result: string }>;
}

// ── LLM-Driven Analysis ─────────────────────────────────────

/**
 * Run analysis using LLM agent loop with tool calling.
 * Falls back to rule-based analysis on failure.
 */
export async function runLLMAnalysis(
	input: LLMAnalysisInput,
	deps: AnalysisToolDeps,
	llmConfig: LLMAnalysisConfig,
): Promise<LLMAnalysisResult> {
	// Load the SKILL.md prompt
	let skillPrompt: string;
	try {
		const skill = loadBuiltinSkill("geo-analysis");
		skillPrompt = skill.systemPrompt;
	} catch {
		// If skill loading fails, fall back to a simple prompt
		skillPrompt = getDefaultAnalysisPrompt();
	}

	// Create tool state and handlers
	const state = createAnalysisToolState();
	const toolHandlers = createAnalysisToolHandlers(deps, state);

	try {
		const agentResult = await piAiAgentLoop({
			model: llmConfig.model,
			systemPrompt: skillPrompt,
			userMessage: `Analyze the following URL for GEO (Generative Engine Optimization) readiness: ${input.target_url}\n\nTarget ID: ${input.target_id}\nCrawl timeout: ${input.crawl_timeout ?? 15000}ms`,
			tools: ANALYSIS_TOOLS,
			toolHandlers,
			apiKey: llmConfig.apiKey,
			maxIterations: llmConfig.maxIterations ?? 12,
			temperature: llmConfig.temperature ?? 0.3,
			maxTokens: 4096,
		});

		// Build AnalysisOutput from accumulated tool state
		const output = buildOutputFromState(state, input);

		// Try to parse the LLM's final text as RichAnalysisReport
		let richReport: RichAnalysisReport | null = null;
		if (agentResult.finalText) {
			try {
				// Strip markdown code fences if present
				let jsonText = agentResult.finalText.trim();
				const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
				if (fenceMatch) jsonText = fenceMatch[1];
				richReport = JSON.parse(jsonText) as RichAnalysisReport;
			} catch {
				// LLM response wasn't valid JSON — store as assessment text instead
			}
		}

		return {
			output,
			usedLLMAgent: true,
			llmAssessment: agentResult.finalText || null,
			richReport,
			agentLoopResult: agentResult,
			toolCallLog: agentResult.toolCallLog,
		};
	} catch (err) {
		// Fall back to rule-based analysis
		return await fallbackToRuleBased(input, deps, err);
	}
}

/**
 * Run analysis with optional LLM enhancement.
 * If llmConfig is provided, attempts LLM-driven analysis first.
 * Otherwise, runs rule-based analysis directly.
 */
export async function runAnalysisWithLLM(
	input: LLMAnalysisInput,
	deps: AnalysisDeps,
	llmConfig?: LLMAnalysisConfig,
): Promise<LLMAnalysisResult> {
	if (!llmConfig) {
		// No LLM config — use pure rule-based
		const output = await runAnalysis(input, deps);
		return {
			output,
			usedLLMAgent: false,
			llmAssessment: null,
			richReport: null,
			agentLoopResult: null,
			toolCallLog: [],
		};
	}

	// Build AnalysisToolDeps from AnalysisDeps
	const toolDeps: AnalysisToolDeps = {
		crawlTarget: deps.crawlTarget,
		scoreTarget: deps.scoreTarget,
		classifySite: deps.classifySite,
		crawlMultiplePages: deps.crawlMultiplePages,
		chatLLM: deps.chatLLM,
	};

	return runLLMAnalysis(input, toolDeps, llmConfig);
}

// ── Build Output from Tool State ────────────────────────────

function buildOutputFromState(
	state: AnalysisToolState,
	input: LLMAnalysisInput,
): AnalysisOutput {
	const crawlData = state.homepageCrawl!;
	const scores = state.pageScores.get("homepage");
	const classification = state.classification;

	// Build dimensions array (use scores if available, otherwise empty)
	const dimensions = scores?.dimensions ?? [];
	const overallScore = scores?.overall_score ?? 0;
	const grade = scores?.grade ?? "Critical";

	// Build multi-page data if available
	let multiPage = null;
	let allPages = null;

	if (state.multiPageResult) {
		const mp = state.multiPageResult;
		const pageScoreEntries = Array.from(state.pageScores.entries());

		const homepageScores = scores ?? { overall_score: 0, grade: "Critical", dimensions: [] };
		const pageScores = mp.pages.map((p) => {
			const ps = state.pageScores.get(p.url);
			return {
				url: p.url,
				filename: p.path,
				scores: ps ?? { overall_score: 0, grade: "Critical", dimensions: [] },
			};
		});

		// Compute weighted aggregate
		const weights = [2, ...mp.pages.map(() => 1)];
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		const allScores = [homepageScores.overall_score, ...pageScores.map((p) => p.scores.overall_score)];
		const aggregateScore = Math.round(
			(allScores.reduce((sum, s, i) => sum + s * weights[i], 0) / totalWeight) * 10,
		) / 10;

		multiPage = {
			homepage_scores: {
				url: crawlData.url,
				filename: "index.html",
				scores: homepageScores,
			},
			page_scores: pageScores,
			aggregate_score: aggregateScore,
			aggregate_grade: aggregateScore >= 90 ? "Excellent" : aggregateScore >= 75 ? "Good" : aggregateScore >= 55 ? "Needs Improvement" : aggregateScore >= 35 ? "Poor" : "Critical",
			per_dimension_averages: dimensions.map((d) => ({ id: d.id, label: d.label, avg_score: d.score })),
		};

		allPages = mp.pages.map((p) => ({
			filename: p.path,
			crawl_data: p.crawl_data,
		}));
	}

	return {
		report: {
			report_id: uuidv4(),
			target_id: input.target_id,
			url: input.target_url,
			analyzed_at: new Date().toISOString(),
			machine_readability: {
				grade: overallScore >= 75 ? "A" : overallScore >= 55 ? "B" : overallScore >= 35 ? "C" : "F",
				js_dependency_ratio: 0,
				structure_quality: {
					semantic_tag_ratio: 0,
					div_nesting_depth: 0,
					text_to_markup_ratio: 0,
					heading_hierarchy_valid: false,
				},
				crawler_access: [{
					user_agent: "GEO-Agent/1.0",
					http_status: crawlData.status_code,
					blocked_by_robots_txt: false,
					content_accessible: crawlData.status_code === 200,
				}],
			},
			content_analysis: {
				word_count: 0,
				content_density: 0,
				readability_level: "general",
				key_topics_found: [],
				topic_alignment: 0,
			},
			structured_data: {
				json_ld_present: crawlData.json_ld.length > 0,
				json_ld_types: crawlData.json_ld
					.map((ld) => String((ld as Record<string, unknown>)["@type"] ?? ""))
					.filter(Boolean),
				schema_completeness: Math.min(crawlData.json_ld.length / 5, 1),
				og_tags_present: Object.keys(crawlData.meta_tags).some((k) => k.startsWith("og:")),
				meta_description: crawlData.meta_tags.description ?? null,
			},
			extracted_info_items: [],
			current_geo_score: {
				total: overallScore,
				citation_rate: 0,
				citation_accuracy: 0,
				info_recognition_score: 0,
				coverage: 0,
				rank_position: 0,
				structured_score: 0,
				measured_at: new Date().toISOString(),
				llm_breakdown: {},
			},
			competitor_gaps: [],
			llm_status: [],
		},
		crawl_data: crawlData,
		classification: classification ?? { site_type: "generic", confidence: 0, matched_signals: [] },
		geo_scores: { overall_score: overallScore, grade, dimensions },
		multi_page: multiPage,
		all_pages: allPages,
		eval_data: state.evalData ?? {
			bot_policies: [],
			llms_txt: { exists: false, content_preview: null },
			schema_coverage: [],
			marketing_claims: [],
			js_dependency: { script_count: 0, external_scripts: 0, inline_scripts: 0, frameworks_detected: [], estimated_js_dependency: 0 },
			product_info: [],
			blocked_paths: [],
			path_access: [],
			strengths: [],
			weaknesses: [],
			opportunities: [],
			improvements: [],
		},
		llm_assessment: null,
	};
}

// ── Fallback ────────────────────────────────────────────────

async function fallbackToRuleBased(
	input: LLMAnalysisInput,
	deps: AnalysisToolDeps,
	error: unknown,
): Promise<LLMAnalysisResult> {
	// Build AnalysisDeps from AnalysisToolDeps (they're compatible)
	const analysisDeps: AnalysisDeps = {
		crawlTarget: deps.crawlTarget,
		scoreTarget: deps.scoreTarget,
		classifySite: deps.classifySite,
		crawlMultiplePages: deps.crawlMultiplePages,
		chatLLM: deps.chatLLM,
	};

	const output = await runAnalysis(input, analysisDeps);

	return {
		output,
		usedLLMAgent: false,
		llmAssessment: `LLM agent failed (${error instanceof Error ? error.message : "unknown error"}), used rule-based fallback`,
		richReport: null,
		agentLoopResult: null,
		toolCallLog: [],
	};
}

// ── Default Prompt ──────────────────────────────────────────

function getDefaultAnalysisPrompt(): string {
	return `You are a GEO (Generative Engine Optimization) analysis agent. Use the provided tools to analyze a target URL and evaluate how well LLM services can discover, understand, and cite its content.

Steps:
1. Call crawl_page with the target URL
2. Call classify_site to determine site type
3. Call score_geo to get GEO scores across 7 dimensions
4. Call extract_evaluation_data for detailed analysis
5. If the site is a manufacturer, call crawl_multiple_pages
6. Synthesize findings into a final assessment

Always use tools to gather real data. Never fabricate scores.`;
}
