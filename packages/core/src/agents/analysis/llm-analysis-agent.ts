import type { Api, Model } from "@mariozechner/pi-ai";
/**
 * LLM-Driven Analysis Agent
 *
 * Uses pi-ai's tool-calling agent loop to let the LLM drive the GEO evaluation.
 * The LLM follows the SKILL.md prompt and calls analysis tools to gather data.
 * Produces a RichAnalysisReport (10-tab dashboard).
 *
 * No fallback. If LLM fails, the pipeline fails.
 */
import { v4 as uuidv4 } from "uuid";
import type { ModelCostOverrideMap } from "../../db/repositories/model-cost-override-repository.js";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import {
	type AgentLoopResult,
	piAiAgentLoop,
	piAiModelFromProvider,
} from "../../llm/pi-ai-bridge.js";
import { ProviderConfigManager } from "../../llm/provider-config.js";
import { loadBuiltinSkill } from "../../skills/skill-loader.js";
import type { AnalysisOutput } from "./analysis-agent.js";
import type { RichAnalysisReport } from "./rich-analysis-schema.js";
import {
	ANALYSIS_TOOLS,
	type AnalysisToolDeps,
	type AnalysisToolState,
	createAnalysisToolHandlers,
	createAnalysisToolState,
} from "./tools.js";

// ── Types ───────────────────────────────────────────────────

export interface LLMAnalysisInput {
	target_id: string;
	target_url: string;
	crawl_timeout?: number;
}

export interface LLMAnalysisResult {
	/** The AnalysisOutput (compatible with existing pipeline) */
	output: AnalysisOutput;
	/** Rich 10-tab report from the LLM */
	richReport: RichAnalysisReport;
	/** The LLM's raw final text */
	llmAssessment: string;
	/** Agent loop details */
	agentLoopResult: AgentLoopResult;
	/** Tool call log from the agent loop */
	toolCallLog: Array<{ name: string; args: Record<string, unknown>; result: string }>;
}

// ── Model Resolution ────────────────────────────────────────

/**
 * Resolve a pi-ai Model from the workspace LLM provider settings.
 * Uses whatever provider is configured and enabled with an API key.
 */
export function resolveModel(
	workspaceDir: string,
	costOverrides?: ModelCostOverrideMap,
): { model: Model<Api>; apiKey: string; provider: string } {
	const configManager = new ProviderConfigManager(workspaceDir);
	const enabled = configManager.getEnabled().filter((p) => p.api_key);
	if (enabled.length === 0) {
		throw new Error(
			"No LLM provider with API key configured. Set one in Dashboard > LLM Providers.",
		);
	}
	const provider = enabled[0];
	const model = piAiModelFromProvider(provider, costOverrides);
	return { model, apiKey: provider.api_key!, provider: provider.provider_id };
}

// ── LLM-Driven Analysis ─────────────────────────────────────

/**
 * Run analysis using LLM agent loop with tool calling.
 * No fallback — throws on failure.
 */
export async function runLLMAnalysis(
	input: LLMAnalysisInput,
	deps: AnalysisToolDeps,
	piModel: { model: Model<Api>; apiKey: string },
): Promise<LLMAnalysisResult> {
	const { model, apiKey } = piModel;

	// Load the SKILL.md prompt
	const skill = loadBuiltinSkill("geo-analysis");
	const skillPrompt = skill.systemPrompt;

	// Create tool state and handlers
	const state = createAnalysisToolState();
	const toolHandlers = createAnalysisToolHandlers(deps, state);

	const agentResult = await piAiAgentLoop({
		model,
		systemPrompt: skillPrompt,
		userMessage: `Analyze the following URL for GEO (Generative Engine Optimization) readiness: ${input.target_url}\n\nTarget ID: ${input.target_id}\nCrawl timeout: ${input.crawl_timeout ?? 15000}ms`,
		tools: ANALYSIS_TOOLS,
		toolHandlers,
		apiKey,
		maxIterations: 15,
		temperature: 0.3,
		maxTokens: 8192,
	});

	// Ensure critical tools were called — if LLM skipped them, call them now
	if (!state.homepageCrawl) {
		await toolHandlers.crawl_page({
			url: input.target_url,
			timeout_ms: input.crawl_timeout ?? 15000,
		});
	}
	if (!state.classification) {
		await toolHandlers.classify_site({});
	}
	if (!state.pageScores.has("homepage")) {
		await toolHandlers.score_geo({ crawl_data_key: "homepage" });
	}
	// Ensure all multi-page scores exist — LLM may skip pages due to iteration limits
	if (state.multiPageResult) {
		for (const page of state.multiPageResult.pages) {
			if (!state.pageScores.has(page.url)) {
				await toolHandlers.score_geo({ crawl_data_key: page.url });
			}
		}
	}
	if (!state.evalData) {
		await toolHandlers.extract_evaluation_data({});
	}

	if (!agentResult.finalText) {
		throw new Error("LLM agent loop produced no output");
	}

	// Parse the LLM's final text as RichAnalysisReport
	let jsonText = agentResult.finalText.trim();
	const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
	if (fenceMatch) jsonText = fenceMatch[1];

	let richReport: RichAnalysisReport;
	try {
		richReport = JSON.parse(jsonText) as RichAnalysisReport;
	} catch (err) {
		throw new Error(
			`LLM produced invalid JSON for RichAnalysisReport: ${err instanceof Error ? err.message : String(err)}\n\nRaw output (first 500 chars): ${agentResult.finalText.slice(0, 500)}`,
		);
	}

	// Build AnalysisOutput from accumulated tool state (for pipeline compatibility)
	const output = buildOutputFromState(state, input);

	return {
		output,
		richReport,
		llmAssessment: agentResult.finalText,
		agentLoopResult: agentResult,
		toolCallLog: agentResult.toolCallLog,
	};
}

// ── Build Output from Tool State ────────────────────────────

function buildOutputFromState(state: AnalysisToolState, input: LLMAnalysisInput): AnalysisOutput {
	const crawlData = state.homepageCrawl!;
	const scores = state.pageScores.get("homepage");
	const classification = state.classification;

	const dimensions = scores?.dimensions ?? [];
	const overallScore = scores?.overall_score ?? 0;
	const grade = scores?.grade ?? "Critical";

	let multiPage = null;
	let allPages = null;

	if (state.multiPageResult) {
		const mp = state.multiPageResult;
		const homepageScores = scores ?? { overall_score: 0, grade: "Critical", dimensions: [] };
		const pageScores = mp.pages.map((p) => {
			const ps = state.pageScores.get(p.url);
			if (!ps) {
				console.warn(
					`[GEO] Page "${p.url}" (${p.path}) has no scores — score_geo was not called or key mismatch. Defaulting to 0.`,
				);
			}
			return {
				url: p.url,
				filename: p.path,
				scores: ps ?? { overall_score: 0, grade: "Critical", dimensions: [] },
			};
		});

		const weights = [2, ...mp.pages.map(() => 1)];
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		const allScores = [
			homepageScores.overall_score,
			...pageScores.map((p) => p.scores.overall_score),
		];
		const aggregateScore =
			Math.round((allScores.reduce((sum, s, i) => sum + s * weights[i], 0) / totalWeight) * 10) /
			10;

		multiPage = {
			homepage_scores: { url: crawlData.url, filename: "index.html", scores: homepageScores },
			page_scores: pageScores,
			aggregate_score: aggregateScore,
			aggregate_grade:
				aggregateScore >= 90
					? "Excellent"
					: aggregateScore >= 75
						? "Good"
						: aggregateScore >= 55
							? "Needs Improvement"
							: aggregateScore >= 35
								? "Poor"
								: "Critical",
			per_dimension_averages: dimensions.map((d) => ({
				id: d.id,
				label: d.label,
				avg_score: d.score,
			})),
		};

		allPages = mp.pages.map((p) => ({ filename: p.path, crawl_data: p.crawl_data }));
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
				crawler_access: [
					{
						user_agent: "GEO-Agent/1.0",
						http_status: crawlData.status_code,
						blocked_by_robots_txt: false,
						content_accessible: crawlData.status_code === 200,
					},
				],
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
			js_dependency: {
				script_count: 0,
				external_scripts: 0,
				inline_scripts: 0,
				frameworks_detected: [],
				estimated_js_dependency: 0,
			},
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
