import { CloneManager } from "../../clone/clone-manager.js";
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import type { LLMProviderSettings } from "../../llm/provider-config.js";
/**
 * Pipeline Runner — Orchestrator에 모든 Agent를 등록하고 E2E 파이프라인 실행
 *
 * 사용법:
 *   const result = await runPipeline({ target_id, target_url, workspace_dir });
 *
 * 파이프라인 흐름:
 *   ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
 *   (VALIDATING에서 점수 미달 시 → STRATEGIZING 루프백)
 */
import { Orchestrator, type StageContext } from "../../pipeline/orchestrator.js";
import { ArchiveBuilder } from "../../report/archive-builder.js";
import { generateDashboardHtml } from "../../report/dashboard-html-generator.js";
import { ReportBuilder } from "../../report/report-generator.js";
import { type AnalysisOutput, runAnalysis } from "../analysis/analysis-agent.js";
import { resolveModel, runLLMAnalysis } from "../analysis/llm-analysis-agent.js";
import type { RichAnalysisReport } from "../analysis/rich-analysis-schema.js";
import { type OptimizationResult, runOptimization } from "../optimization/optimization-agent.js";
import {
	type MultiProviderProbeConfig,
	type MultiProviderProbeResult,
	runMultiProviderProbes,
} from "../probes/multi-provider-probes.js";
import {
	type ProbeContext,
	type SyntheticProbeRunResult,
	runProbes,
} from "../probes/synthetic-probes.js";
import { isLLMAuthError } from "../shared/llm-helpers.js";
import type { CrawlData } from "../shared/types.js";
import { type StrategyOutput, runStrategy } from "../strategy/strategy-agent.js";
import { type ValidationOutput, runValidation } from "../validation/validation-agent.js";

// ── Pipeline Config ─────────────────────────────────────────

export interface StageCallbacks {
	/** 스테이지 시작 시 호출. execution ID 반환. */
	onStageStart?: (
		pipelineId: string,
		stage: string,
		cycle: number,
		promptSummary: string,
	) => Promise<string>;
	/** 스테이지 완료 시 호출. */
	onStageComplete?: (
		executionId: string,
		resultSummary: string,
		resultFull?: unknown,
	) => Promise<void>;
	/** 스테이지 실패 시 호출. */
	onStageFail?: (executionId: string, error: string) => Promise<void>;
}

export interface PipelineConfig {
	target_id: string;
	target_url: string;
	workspace_dir: string;
	/** 목표 점수 (기본 80) */
	target_score?: number;
	/** 최대 사이클 수 (기본 10) */
	max_cycles?: number;
	/** 최대 재시도 수 (기본 3) */
	max_retries?: number;
	/** 타임아웃 ms (기본 30분) */
	timeout_ms?: number;
	/** 스테이지 실행 기록 콜백 (optional) */
	stageCallbacks?: StageCallbacks;
	/** 외부에서 stop 시그널을 보낼 수 있도록 stop 함수를 등록하는 콜백 */
	registerStop?: (stopFn: () => void) => void;
	/** 프로브 실행 모드: single(기존 단일 프로바이더) / multi(등록된 모든 프로바이더 병렬 실행) */
	probe_mode?: "single" | "multi";
	/** multi 모드에서 사용할 활성 프로바이더 목록 (probe_mode=multi 시 필수) */
	providers?: LLMProviderSettings[];
}

export interface LLMCallLogEntry {
	seq: number;
	timestamp: string;
	stage: string;
	provider: string;
	model: string;
	prompt_summary: string;
	response_summary: string;
	tokens_in?: number;
	tokens_out?: number;
	duration_ms: number;
	error?: string;
	/** System instruction summary (max 500 chars) */
	system_instruction_summary?: string;
	/** Request parameters */
	request_params?: {
		temperature?: number;
		max_tokens?: number;
		json_mode?: boolean;
	};
}

export interface PipelineResult {
	success: boolean;
	final_score: number;
	initial_score: number;
	delta: number;
	cycles_completed: number;
	report_path: string | null;
	dashboard_html: string | null;
	llm_models_used: string[];
	llm_errors: string[];
	llm_call_log: LLMCallLogEntry[];
	error?: string;
}

// ── Pipeline Dependencies (DI) ──────────────────────────────

export interface PipelineDeps {
	crawlTarget: (url: string, timeout?: number) => Promise<CrawlData>;
	scoreTarget: (data: CrawlData) => {
		overall_score: number;
		grade: string;
		dimensions: Array<{
			id: string;
			label: string;
			score: number;
			weight: number;
			details: string[];
		}>;
	};
	classifySite: (
		html: string,
		url: string,
	) => {
		site_type: string;
		confidence: number;
		matched_signals: string[];
		all_signals: Array<{ site_type: string; confidence: number; signals: string[] }>;
	};
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>;
	/** Override for the LLM analysis step (for testing). If not provided, uses runLLMAnalysis with resolveModel. */
	runLLMAnalysisOverride?: (
		input: { target_id: string; target_url: string },
		toolDeps: any,
	) => Promise<import("../analysis/llm-analysis-agent.js").LLMAnalysisResult>;
	/** 멀티 페이지 크롤링 (optional — 제공 시 manufacturer 사이트에서 자동 사용) */
	crawlMultiplePages?: (
		url: string,
		maxPages?: number,
		timeoutMs?: number,
	) => Promise<import("../shared/types.js").MultiPageCrawlResult>;
}

// ── Pipeline Runner ──────────────────────────────────────────

export async function runPipeline(
	config: PipelineConfig,
	deps: PipelineDeps,
): Promise<PipelineResult> {
	// Shared state across stages
	let analysisOutput: AnalysisOutput | null = null;
	let strategyOutput: StrategyOutput | null = null;
	let optimizationResult: OptimizationResult | null = null;
	let validationOutput: ValidationOutput | null = null;
	let cloneManager: CloneManager | null = null;
	let currentScore = 0;
	let currentGrade = "";
	let currentDimensions: Array<{
		id: string;
		label: string;
		score: number;
		weight: number;
		details: string[];
	}> = [];
	let initialScore = 0;
	let cycleCount = 0;
	let probeResults: SyntheticProbeRunResult | null = null;
	let multiProbeResults: MultiProviderProbeResult | null = null;
	let richReport: RichAnalysisReport | null = null;
	const llmModelsUsed = new Set<string>();
	const llmErrors: string[] = [];
	const llmCallLog: LLMCallLogEntry[] = [];
	let llmCallSeq = 0;
	let currentStageForLog = "INIT";

	// Wrap chatLLM to track which models are actually used + collect errors + full call log
	const trackedChatLLM = async (req: LLMRequest): Promise<LLMResponse> => {
		const seq = ++llmCallSeq;
		const startMs = Date.now();
		const promptText = req.prompt ?? "";
		const sysInstr = req.system_instruction ?? undefined;
		const reqParams =
			req.temperature !== undefined || req.max_tokens !== undefined || req.json_mode !== undefined
				? {
						temperature: req.temperature,
						max_tokens: req.max_tokens,
						json_mode: req.json_mode,
					}
				: undefined;
		try {
			const response = await deps.chatLLM(req);
			llmModelsUsed.add(`${response.provider}/${response.model}`);
			llmCallLog.push({
				seq,
				timestamp: new Date().toISOString(),
				stage: currentStageForLog,
				provider: response.provider,
				model: response.model,
				prompt_summary: promptText.slice(0, 500),
				response_summary: (response.content ?? "").slice(0, 1000),
				tokens_in: response.usage?.prompt_tokens,
				tokens_out: response.usage?.completion_tokens,
				duration_ms: Date.now() - startMs,
				system_instruction_summary: sysInstr?.slice(0, 500),
				request_params: reqParams,
			});
			return response;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			llmErrors.push(msg);
			llmCallLog.push({
				seq,
				timestamp: new Date().toISOString(),
				stage: currentStageForLog,
				provider: req.provider ?? "unknown",
				model: req.model ?? "unknown",
				prompt_summary: promptText.slice(0, 500),
				response_summary: "",
				duration_ms: Date.now() - startMs,
				error: msg.slice(0, 500),
				system_instruction_summary: sysInstr?.slice(0, 500),
				request_params: reqParams,
			});
			// Auth errors (401, 403, invalid key) → stop pipeline immediately
			if (isLLMAuthError(err)) {
				orchestrator.stop();
			}
			throw err; // Re-throw — auth errors stop pipeline, other errors propagate to caller
		}
	};

	const orchestrator = new Orchestrator({
		maxRetries: config.max_retries ?? 3,
		timeoutMs: config.timeout_ms ?? 30 * 60 * 1000,
		maxCycles: config.max_cycles ?? 10,
	});

	// Allow external callers (e.g., dashboard stop button) to signal the orchestrator
	if (config.registerStop) {
		config.registerStop(() => orchestrator.stop());
	}

	const cb = config.stageCallbacks;

	// Helper: wrap stage execution with callbacks
	async function trackStage<T>(
		stage: string,
		promptSummary: string,
		fn: () => Promise<T>,
		resultSummaryFn: (result: T) => string,
		resultFullFn?: (result: T) => unknown,
	): Promise<T> {
		currentStageForLog = stage;
		let execId: string | undefined;
		if (cb?.onStageStart) {
			execId = await cb.onStageStart(config.target_id, stage, cycleCount, promptSummary);
		}
		try {
			const result = await fn();
			if (cb?.onStageComplete && execId) {
				await cb.onStageComplete(
					execId,
					resultSummaryFn(result),
					resultFullFn ? resultFullFn(result) : undefined,
				);
			}
			return result;
		} catch (err) {
			if (cb?.onStageFail && execId) {
				await cb.onStageFail(execId, err instanceof Error ? err.message : String(err));
			}
			throw err;
		}
	}

	// ── ANALYZING ────────────────────────────────────────────
	orchestrator.registerHandler("ANALYZING", async (ctx: StageContext) => {
		await trackStage(
			"ANALYZING",
			`Crawling ${config.target_url}, LLM-driven 10-tab GEO analysis`,
			async () => {
				const toolDeps = {
					crawlTarget: deps.crawlTarget,
					scoreTarget: deps.scoreTarget,
					classifySite: deps.classifySite,
					crawlMultiplePages: deps.crawlMultiplePages,
					chatLLM: trackedChatLLM,
				};

				if (deps.runLLMAnalysisOverride) {
					const result = await deps.runLLMAnalysisOverride(
						{ target_id: config.target_id, target_url: config.target_url },
						toolDeps,
					);
					analysisOutput = result.output;
					richReport = result.richReport;
				} else {
					const piModel = resolveModel(config.workspace_dir);
					const result = await runLLMAnalysis(
						{ target_id: config.target_id, target_url: config.target_url },
						toolDeps,
						piModel,
					);
					analysisOutput = result.output;
					richReport = result.richReport;
				}
				ctx.setRef("analysis", analysisOutput.report.report_id);
				currentScore = analysisOutput.geo_scores.overall_score;
				currentGrade = analysisOutput.geo_scores.grade;
				currentDimensions = analysisOutput.geo_scores.dimensions;
				initialScore = currentScore;
				try {
					const productInfos = analysisOutput.eval_data?.product_info ?? [];
					const productNames = productInfos
						.map((pi) => pi.info.product_name)
						.filter((n): n is string => n !== null);
					const productPrices = productInfos.flatMap((pi) => pi.info.prices);
					const brandName = new URL(config.target_url).hostname.replace("www.", "").split(".")[0];
					const probeContext: ProbeContext = {
						site_name: analysisOutput.crawl_data.title || new URL(config.target_url).hostname,
						site_url: config.target_url,
						site_type: analysisOutput.classification.site_type,
						topics: analysisOutput.report.content_analysis?.key_topics_found ?? [],
						products: productNames,
						prices: productPrices,
						brand: brandName,
					};

					const probeMode = config.probe_mode ?? "single";

					if (probeMode === "multi" && config.providers && config.providers.length > 0) {
						// ── Multi-Provider 3-Layer Probes (A-0) ──
						const multiConfig: MultiProviderProbeConfig = {
							context: probeContext,
							crawlData: analysisOutput.crawl_data,
							evalData: {
								product_info: analysisOutput.eval_data?.product_info ?? [],
								marketing_claims: analysisOutput.eval_data?.marketing_claims ?? [],
							},
							providers: config.providers,
							judgeLLM: trackedChatLLM,
							delayMs: 500,
						};
						multiProbeResults = await runMultiProviderProbes(multiConfig);

						// provider_errors가 있으면 llmErrors에 추가하여 사용자에게 전달
						for (const [pid, errMsg] of Object.entries(multiProbeResults.provider_errors)) {
							llmErrors.push(`[${pid}] ${errMsg}`);
						}

						// Multi-provider 결과를 GEO Score에 반영
						const ks = multiProbeResults.comparison.knowledge_summary;
						analysisOutput.report.current_geo_score.citation_rate = Math.round(
							ks.avg_citation_rate * 100,
						);
						analysisOutput.report.current_geo_score.citation_accuracy = Math.round(
							ks.avg_accuracy_rate * 100,
						);
						// info_recognition: 팩트 인식률 기반
						const totalFacts = multiProbeResults.comparison.info_recognition_items.length;
						const recognizedFacts = multiProbeResults.comparison.info_recognition_items.filter(
							(item) =>
								item.llm_results.some(
									(l: { accuracy: string }) =>
										l.accuracy === "exact" || l.accuracy === "approximate",
								),
						).length;
						analysisOutput.report.current_geo_score.info_recognition_score = Math.round(
							(recognizedFacts / Math.max(totalFacts, 1)) * 100,
						);
						// rank_position: citation + info recognition 가중 평균
						analysisOutput.report.current_geo_score.rank_position = Math.round(
							(ks.avg_citation_rate * 0.6 + (recognizedFacts / Math.max(totalFacts, 1)) * 0.4) *
								100,
						);

						// llm_breakdown: 프로바이더별 GEO 점수 상세를 GeoScore에 반영
						analysisOutput.report.current_geo_score.llm_breakdown =
							multiProbeResults.comparison.llm_breakdown;

						// SyntheticProbeRunResult 호환 래퍼 (기존 UI 호환)
						probeResults = convertMultiToSingleProbeResult(multiProbeResults);
					} else {
						// ── Single-Provider Probes (기존 동작) ──
						probeResults = await runProbes(
							probeContext,
							{ chatLLM: trackedChatLLM },
							{ delayMs: 500 },
						);

						// Reflect probe results in GeoScore
						if (probeResults) {
							analysisOutput.report.current_geo_score.citation_rate = Math.round(
								probeResults.summary.citation_rate * 100,
							);
							analysisOutput.report.current_geo_score.citation_accuracy = Math.round(
								probeResults.summary.average_accuracy * 100,
							);
							analysisOutput.report.current_geo_score.info_recognition_score = Math.round(
								((probeResults.summary.pass + probeResults.summary.partial * 0.5) /
									Math.max(probeResults.summary.total, 1)) *
									100,
							);
							const citRate = probeResults.summary.citation_rate;
							const infoRate =
								(probeResults.summary.pass + probeResults.summary.partial * 0.5) /
								Math.max(probeResults.summary.total, 1);
							analysisOutput.report.current_geo_score.rank_position = Math.round(
								(citRate * 0.6 + infoRate * 0.4) * 100,
							);
						}
					}
				} catch (probeErr) {
					const probeErrMsg = `Synthetic Probes failed: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`;
					console.warn(`⚠️ ${probeErrMsg}`);
					llmErrors.push(probeErrMsg);
				}

				return analysisOutput;
			},
			(out) => {
				const pageInfo = out.multi_page
					? `, ${out.multi_page.page_scores.length + 1} pages crawled`
					: "";
				const probeInfo = probeResults
					? `, Probes: ${probeResults.summary.pass}P/${probeResults.summary.partial}A/${probeResults.summary.fail}F (citation ${Math.round(probeResults.summary.citation_rate * 100)}%)`
					: "";
				return `Score: ${out.geo_scores.overall_score}/100 (${out.geo_scores.grade}), Site: ${out.classification.site_type} (confidence: ${out.classification.confidence.toFixed(2)})${pageInfo}${probeInfo}`;
			},
			(out) => ({
				score: out.geo_scores.overall_score,
				grade: out.geo_scores.grade,
				site_type: out.classification.site_type,
				dimensions: out.geo_scores.dimensions.map((d) => ({
					id: d.id,
					label: d.label,
					score: d.score,
				})),
				multi_page: out.multi_page
					? {
							aggregate_score: out.multi_page.aggregate_score,
							aggregate_grade: out.multi_page.aggregate_grade,
							page_count: out.multi_page.page_scores.length + 1,
							pages: [out.multi_page.homepage_scores, ...out.multi_page.page_scores].map((p) => ({
								url: p.url,
								filename: p.filename,
								score: p.scores.overall_score,
								grade: p.scores.grade,
							})),
							per_dimension_averages: out.multi_page.per_dimension_averages,
						}
					: null,
				eval_data: out.eval_data,
				llm_assessment: out.llm_assessment,
				synthetic_probes: probeResults,
				multi_provider_probes: multiProbeResults,
				probe_mode: config.probe_mode ?? "single",
				rich_report: richReport,
			}),
		);
	});

	// ── CLONING ──────────────────────────────────────────────
	orchestrator.registerHandler("CLONING", async () => {
		const pageCount = analysisOutput?.all_pages?.length ?? 0;
		await trackStage(
			"CLONING",
			`Creating local clone of ${config.target_url}${pageCount > 0 ? ` + ${pageCount} sub-pages` : ""}`,
			async () => {
				if (!analysisOutput) throw new Error("Analysis output missing");
				cloneManager = new CloneManager(config.workspace_dir);

				// Build additional files map from multi-page crawl
				const additionalFiles = new Map<string, string>();
				if (analysisOutput.all_pages) {
					for (const page of analysisOutput.all_pages) {
						additionalFiles.set(page.filename, page.crawl_data.html);
					}
				}

				await cloneManager.createClone(
					config.target_id,
					config.target_url,
					analysisOutput.crawl_data.html,
					additionalFiles.size > 0 ? additionalFiles : undefined,
				);
				return { clone_path: config.workspace_dir, files: 1 + additionalFiles.size };
			},
			(out) => `Clone created at ${out.clone_path} (${out.files} files)`,
			(out) => out,
		);
	});

	// ── STRATEGIZING ─────────────────────────────────────────
	orchestrator.registerHandler("STRATEGIZING", async (ctx: StageContext) => {
		await trackStage(
			"STRATEGIZING",
			`Generating optimization plan (cycle ${cycleCount})`,
			async () => {
				if (!analysisOutput) throw new Error("Analysis output missing");
				strategyOutput = await runStrategy(
					{
						target_id: config.target_id,
						analysis_report: analysisOutput.report,
					},
					{ chatLLM: trackedChatLLM },
				);
				ctx.setRef("optimization", strategyOutput.plan.plan_id);
				return strategyOutput;
			},
			(out) =>
				`${out.plan.tasks.length} optimization tasks, rationale: ${(out.plan.strategy_rationale ?? "").slice(0, 100)}`,
			(out) => ({
				task_count: out.plan.tasks.length,
				tasks: out.plan.tasks.map((t) => ({ id: t.task_id, title: t.title })),
				rationale: out.plan.strategy_rationale,
			}),
		);
	});

	// ── OPTIMIZING ───────────────────────────────────────────
	orchestrator.registerHandler("OPTIMIZING", async () => {
		const taskTitles = strategyOutput?.plan.tasks.map((t) => t.title).join(", ") ?? "";
		await trackStage(
			"OPTIMIZING",
			`Applying ${strategyOutput?.plan.tasks.length ?? 0} tasks: ${taskTitles.slice(0, 300)}`,
			async () => {
				if (!strategyOutput || !cloneManager) throw new Error("Strategy or clone missing");

				const tid = config.target_id;
				optimizationResult = await runOptimization(
					{
						plan: strategyOutput.plan,
						readFile: async (p) => cloneManager!.readWorkingFile(tid, p) ?? "",
						writeFile: async (p, c) => cloneManager!.writeWorkingFile(tid, p, c),
						listFiles: async () => cloneManager!.listWorkingFiles(tid),
						target_url: config.target_url,
					},
					{ chatLLM: trackedChatLLM },
				);
				return optimizationResult;
			},
			(out) =>
				`Applied: ${out.applied_tasks.length}, Skipped: ${out.skipped_tasks.length}, Files: ${out.files_modified.length}`,
			(out) => ({
				applied: out.applied_tasks,
				skipped: out.skipped_tasks,
				files: out.files_modified,
			}),
		);
	});

	// ── VALIDATING ───────────────────────────────────────────
	orchestrator.registerHandler("VALIDATING", async (ctx: StageContext) => {
		const isMultiPage = !!analysisOutput?.multi_page;
		await trackStage(
			"VALIDATING",
			`Re-scoring optimized clone${isMultiPage ? ` (${(analysisOutput?.all_pages?.length ?? 0) + 1} pages)` : ""}, cycle ${cycleCount}, target: ${config.target_score ?? 80}`,
			async () => {
				if (!cloneManager) throw new Error("Clone missing");

				// Helper: read a clone file as CrawlData
				const fileAsCrawlData = (filename: string, pageUrl: string): CrawlData => {
					const html = cloneManager!.readWorkingFile(config.target_id, filename) ?? "";
					return {
						html,
						url: pageUrl,
						status_code: 200,
						content_type: "text/html",
						response_time_ms: 0,
						robots_txt: cloneManager!.readWorkingFile(config.target_id, "robots.txt") ?? null,
						llms_txt: cloneManager!.readWorkingFile(config.target_id, "llms.txt") ?? null,
						sitemap_xml: null,
						json_ld: [],
						meta_tags: {},
						title: "",
						canonical_url: null,
						links: [],
						headers: {},
					};
				};

				validationOutput = await runValidation(
					{
						target_id: config.target_id,
						target_url: config.target_url,
						before_score: currentScore,
						before_grade: currentGrade,
						before_dimensions: currentDimensions,
						target_score: config.target_score ?? 80,
						cycle_number: cycleCount,
						max_cycles: config.max_cycles ?? 10,
						before_page_scores: analysisOutput?.multi_page
							? [
									analysisOutput.multi_page.homepage_scores,
									...analysisOutput.multi_page.page_scores,
								]
							: undefined,
					},
					{
						crawlClone: async () => fileAsCrawlData("index.html", config.target_url),
						scoreTarget: deps.scoreTarget,
						crawlClonePages: isMultiPage
							? async () => {
									const pages: Array<{ filename: string; crawl_data: CrawlData }> = [];
									const allFiles = cloneManager!.listWorkingFiles(config.target_id);
									for (const f of allFiles) {
										if (f.endsWith(".html") && f !== "index.html") {
											const pageData = analysisOutput?.all_pages?.find((p) => p.filename === f);
											pages.push({
												filename: f,
												crawl_data: fileAsCrawlData(
													f,
													pageData?.crawl_data.url ?? config.target_url,
												),
											});
										}
									}
									return pages;
								}
							: undefined,
						chatLLM: trackedChatLLM,
					},
				);

				ctx.setRef("validation", `validation-cycle-${cycleCount}`);
				currentScore = validationOutput.after_score;
				currentGrade = validationOutput.after_grade;
				currentDimensions = validationOutput.after_dimensions;

				if (validationOutput.needs_more_cycles) {
					cycleCount++;
					cloneManager.incrementCycle(config.target_id);
					ctx.setNextStage("STRATEGIZING");
				}
				return validationOutput;
			},
			(out) =>
				`Score: ${out.after_score} (delta: ${out.delta >= 0 ? "+" : ""}${out.delta}), ${out.needs_more_cycles ? "continuing" : (out.stop_reason ?? "done")}`,
			(out) => ({
				after: out.after_score,
				delta: out.delta,
				needs_more: out.needs_more_cycles,
				stop_reason: out.stop_reason,
			}),
		);
	});

	// ── REPORTING ────────────────────────────────────────────
	let reportPath: string | null = null;
	let dashboardHtml: string | null = null;

	orchestrator.registerHandler("REPORTING", async () => {
		await trackStage(
			"REPORTING",
			"Generating report and dashboard HTML",
			async () => {
				const builder = new ReportBuilder(
					`report-${config.target_id}-${Date.now()}`,
					config.target_id,
					config.target_url,
				);

				builder
					.setSiteType(analysisOutput?.classification.site_type ?? "generic")
					.setCycleCount(cycleCount)
					.setOverallScores(initialScore, currentScore)
					.setGrades(analysisOutput?.geo_scores.grade ?? "Unknown", currentGrade);

				for (const dim of currentDimensions) {
					const before = analysisOutput?.geo_scores.dimensions.find((d) => d.id === dim.id);
					builder.addScoreComparison(`${dim.id} ${dim.label}`, before?.score ?? 0, dim.score);
				}

				if (optimizationResult) {
					// Calculate per-task impact based on overall score delta
					const totalDelta = currentScore - initialScore;
					const taskCount = Math.max(optimizationResult.applied_tasks.length, 1);
					const perTaskImpact = Math.round((totalDelta / taskCount) * 10) / 10;

					// Find changed dimensions
					const changedDims = currentDimensions
						.filter((d) => {
							const before = analysisOutput?.geo_scores.dimensions.find((b) => b.id === d.id);
							return before && Math.abs(d.score - before.score) > 0;
						})
						.map((d) => d.id);

					for (const taskId of optimizationResult.applied_tasks) {
						const task = strategyOutput?.plan.tasks.find((t) => t.task_id === taskId);
						if (task) {
							builder.addChange({
								file_path: task.target_element ?? "unknown",
								change_type: "modified",
								summary: task.title,
								impact_score: perTaskImpact,
								affected_dimensions: changedDims,
								diff_preview: "",
							});
						}
					}
				}

				builder.addKeyImprovement(
					`점수 ${initialScore} → ${currentScore} (+${currentScore - initialScore})`,
				);
				if (validationOutput?.stop_reason) {
					builder.addRemainingIssue(`중단 사유: ${validationOutput.stop_reason}`);
				}

				const report = builder.build();
				dashboardHtml = generateDashboardHtml({ report });

				try {
					const archiveBuilder = new ArchiveBuilder(config.workspace_dir);
					const origFiles = new Map<string, string>();
					const optFiles = new Map<string, string>();

					if (cloneManager) {
						const origHtml = cloneManager.readOriginalFile(config.target_id, "index.html");
						if (origHtml) origFiles.set("index.html", origHtml);
						const workHtml = cloneManager.readWorkingFile(config.target_id, "index.html");
						if (workHtml) optFiles.set("index.html", workHtml);
					}

					const archiveResult = archiveBuilder.build(report, origFiles, optFiles, new Map());
					reportPath = archiveResult.archive_path;
				} catch {
					// Archive generation failure is non-fatal
				}

				return {
					initial: initialScore,
					final: currentScore,
					llm_models_used: Array.from(llmModelsUsed),
					llm_errors: [...new Set(llmErrors)],
					llm_call_log: llmCallLog,
				};
			},
			(out) =>
				`Report: ${out.initial}→${out.final} (+${out.final - out.initial}), LLM: ${out.llm_models_used.join(", ") || "none"}`,
			(out) => out,
		);
	});

	// ── Execute Pipeline ─────────────────────────────────────
	try {
		const result = await orchestrator.run(config.target_id);

		return {
			success: result.finalState.stage === "COMPLETED",
			final_score: currentScore,
			initial_score: initialScore,
			delta: currentScore - initialScore,
			cycles_completed: cycleCount,
			report_path: reportPath,
			dashboard_html: dashboardHtml,
			llm_models_used: Array.from(llmModelsUsed),
			llm_errors: [...new Set(llmErrors)],
			llm_call_log: llmCallLog,
			error: result.finalState.error_message ?? undefined,
		};
	} catch (err) {
		return {
			success: false,
			final_score: currentScore,
			initial_score: initialScore,
			delta: currentScore - initialScore,
			cycles_completed: cycleCount,
			report_path: null,
			dashboard_html: null,
			llm_models_used: Array.from(llmModelsUsed),
			llm_errors: [...new Set(llmErrors)],
			llm_call_log: llmCallLog,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ── Multi → Single probe result converter ────────────────────

/**
 * MultiProviderProbeResult를 SyntheticProbeRunResult 형식으로 변환.
 * 기존 Dashboard UI가 synthetic_probes 필드로 프로브 결과를 렌더링하므로,
 * multi-provider 결과를 기존 UI와 호환되도록 변환한다.
 *
 * 변환 규칙:
 * - knowledge_results의 모든 프로바이더 프로브를 flat하게 합침
 * - accuracy는 comparison.llm_breakdown에서 가져옴
 * - citation은 comparison.knowledge_summary.citation_rates에서 가져옴
 */
function convertMultiToSingleProbeResult(multi: MultiProviderProbeResult): SyntheticProbeRunResult {
	const ks = multi.comparison.knowledge_summary;
	const probes: SyntheticProbeRunResult["probes"] = [];

	for (const kr of multi.knowledge_results) {
		const providerCitRate = ks.citation_rates[kr.provider_id] ?? 0;
		const providerAccRate = ks.accuracy_rates[kr.provider_id] ?? 0;

		for (const p of kr.probes) {
			const cited = providerCitRate > 0.3;
			const accuracy = providerAccRate;
			let verdict: "PASS" | "PARTIAL" | "FAIL";
			if (cited && accuracy >= 0.5) verdict = "PASS";
			else if (cited || accuracy >= 0.3) verdict = "PARTIAL";
			else verdict = "FAIL";

			probes.push({
				probe_id: `${kr.provider_id}/${p.probe_id}`,
				probe_name: p.probe_id,
				category: kr.track,
				query: "",
				response: p.response,
				cited,
				accuracy,
				verdict,
				latency_ms: p.latency_ms,
				model: kr.model,
				provider: kr.provider_id,
				error: p.error,
			});
		}
	}

	const total = probes.length;
	const pass = probes.filter((p) => p.verdict === "PASS").length;
	const partial = probes.filter((p) => p.verdict === "PARTIAL").length;
	const fail = probes.filter((p) => p.verdict === "FAIL").length;

	return {
		probes,
		summary: {
			total,
			pass,
			partial,
			fail,
			citation_rate: ks.avg_citation_rate,
			average_accuracy: ks.avg_accuracy_rate,
		},
	};
}
