import {
	type AppSettings,
	type GeoDatabase,
	GeoLLMClient,
	type PipelineConfig,
	type PipelineDeps,
	PipelineRepository,
	ProviderConfigManager,
	type StageCallbacks,
	StageExecutionRepository,
	TargetRepository,
	classifySite,
	runPipeline,
} from "@geo-agent/core";
import { crawlMultiplePages, crawlTarget, scoreTarget } from "@geo-agent/skills";
/**
 * Pipeline & Cycle Control Routes
 *
 * /api/targets/:id/pipeline — 파이프라인 관리 + 실행
 * /api/targets/:id/pipeline/:pipelineId/stages — 스테이지 실행 기록
 * /api/targets/:id/cycle    — 사이클 제어
 */
import { Hono } from "hono";
import { broadcastSSE } from "../server.js";

let sharedPipelineRepo: PipelineRepository | null = null;
let sharedStageRepo: StageExecutionRepository | null = null;
let sharedTargetRepo: TargetRepository | null = null;
let sharedSettings: AppSettings | null = null;

export function initPipelineRouter(db: GeoDatabase, settings?: AppSettings): void {
	sharedPipelineRepo = new PipelineRepository(db);
	sharedStageRepo = new StageExecutionRepository(db);
	sharedTargetRepo = new TargetRepository(db);
	if (settings) sharedSettings = settings;
}

function getRepo(): PipelineRepository {
	if (!sharedPipelineRepo) {
		throw new Error("Pipeline router not initialized. Call initPipelineRouter(db) at startup.");
	}
	return sharedPipelineRepo;
}

function getStageRepo(): StageExecutionRepository {
	if (!sharedStageRepo) {
		throw new Error("Pipeline router not initialized. Call initPipelineRouter(db) at startup.");
	}
	return sharedStageRepo;
}

function getTargetRepo(): TargetRepository {
	if (!sharedTargetRepo) {
		throw new Error("Pipeline router not initialized. Call initPipelineRouter(db) at startup.");
	}
	return sharedTargetRepo;
}

// Track running pipelines to prevent double execution and enable stop signaling
const runningPipelines = new Map<string, { stop: () => void }>();

const pipelineRouter = new Hono();

// ── Pipeline Routes ────────────────────────────────────────

// GET /api/targets/:id/pipeline — 타겟의 전체 파이프라인 목록
pipelineRouter.get("/:id/pipeline", async (c) => {
	const targetRepo = getTargetRepo();
	const target = await targetRepo.findById(c.req.param("id"));
	if (!target) {
		return c.json({ error: "Target not found" }, 404);
	}
	const repo = getRepo();
	const pipelines = await repo.findByTargetId(c.req.param("id"));
	return c.json(pipelines);
});

// GET /api/targets/:id/pipeline/latest — 최신 파이프라인 상태
pipelineRouter.get("/:id/pipeline/latest", async (c) => {
	const repo = getRepo();
	const pipeline = await repo.findLatestByTargetId(c.req.param("id"));
	if (!pipeline) {
		return c.json({ error: "No pipeline found for this target" }, 404);
	}
	return c.json(pipeline);
});

// GET /api/targets/:id/pipeline/:pipelineId — 특정 파이프라인 상태
pipelineRouter.get("/:id/pipeline/:pipelineId", async (c) => {
	const repo = getRepo();
	const pipeline = await repo.findById(c.req.param("pipelineId"));
	if (!pipeline) {
		return c.json({ error: "Pipeline not found" }, 404);
	}
	return c.json(pipeline);
});

// POST /api/targets/:id/pipeline — 새 파이프라인 생성 (+ execute=true 시 비동기 실행)
pipelineRouter.post("/:id/pipeline", async (c) => {
	const repo = getRepo();
	const targetId = c.req.param("id");
	const shouldExecute = c.req.query("execute") === "true";
	const probeMode = (c.req.query("probe_mode") === "multi" ? "multi" : "single") as
		| "single"
		| "multi";

	if (shouldExecute) {
		// Prevent double execution
		if (runningPipelines.has(targetId)) {
			return c.json({ error: "Pipeline already running for this target" }, 409);
		}

		const targetRepo = getTargetRepo();
		const target = await targetRepo.findById(targetId);
		if (!target) {
			return c.json({ error: "Target not found" }, 404);
		}

		const pipeline = await repo.create(targetId);
		const stageRepo = getStageRepo();

		// Build stage callbacks
		const stageCallbacks: StageCallbacks = {
			onStageStart: async (_pipelineId, stage, cycle, promptSummary) => {
				await repo.updateStage(pipeline.pipeline_id, stage as never);
				const exec = await stageRepo.create(pipeline.pipeline_id, stage, cycle, promptSummary);
				broadcastSSE("pipeline:stage", {
					target_id: targetId,
					pipeline_id: pipeline.pipeline_id,
					stage,
					cycle,
					status: "running",
					prompt_summary: promptSummary,
				});
				return exec.id;
			},
			onStageComplete: async (executionId, resultSummary, resultFull) => {
				await stageRepo.complete(executionId, resultSummary, resultFull);
				broadcastSSE("pipeline:stage-complete", {
					target_id: targetId,
					pipeline_id: pipeline.pipeline_id,
					execution_id: executionId,
					result_summary: resultSummary,
				});
			},
			onStageFail: async (executionId, error) => {
				await stageRepo.fail(executionId, error);
				broadcastSSE("pipeline:stage-fail", {
					target_id: targetId,
					pipeline_id: pipeline.pipeline_id,
					execution_id: executionId,
					error,
				});
			},
		};

		// Build chatLLM dependency — LLM is REQUIRED (ARCHITECTURE.md 9-A.1)
		const workspaceDir = sharedSettings?.workspace_dir ?? "./run";
		let chatLLM: PipelineDeps["chatLLM"];
		let providersWithKey: ReturnType<ProviderConfigManager["getEnabled"]> = [];
		try {
			const configManager = new ProviderConfigManager(workspaceDir);
			const enabledProviders = configManager.getEnabled();
			providersWithKey = enabledProviders.filter((p) => p.api_key);
			if (providersWithKey.length === 0) {
				// API Key 미설정 → 파이프라인 실행 거부
				const errMsg =
					"LLM API Key가 설정되지 않았습니다. Dashboard > LLM Providers 탭에서 API Key를 입력하세요.";
				console.error(`❌ ${errMsg}`);
				await repo.setError(pipeline.pipeline_id, errMsg);
				broadcastSSE("pipeline:failed", {
					target_id: targetId,
					pipeline_id: pipeline.pipeline_id,
					error: errMsg,
				});
				return c.json({ ...pipeline, error: errMsg }, 201);
			}
			const client = new GeoLLMClient(workspaceDir);
			chatLLM = (req) => client.chat(req);
			console.log(`🤖 LLM enabled: ${providersWithKey.map((p) => p.provider_id).join(", ")}`);
		} catch (err) {
			// LLM 초기화 실패 → 파이프라인 중단
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error("❌ LLM initialization failed:", errMsg);
			await repo.setError(pipeline.pipeline_id, `LLM 초기화 실패: ${errMsg}`);
			broadcastSSE("pipeline:failed", {
				target_id: targetId,
				pipeline_id: pipeline.pipeline_id,
				error: `LLM 초기화 실패: ${errMsg}`,
			});
			return c.json(
				{
					...pipeline,
					error: `LLM 초기화 실패: ${errMsg}. Dashboard > LLM Providers 탭에서 API Key를 확인하세요.`,
				},
				201,
			);
		}

		const deps: PipelineDeps = {
			crawlTarget,
			scoreTarget,
			classifySite,
			crawlMultiplePages,
			chatLLM,
		};

		let pipelineStopFn: (() => void) | undefined;
		const config: PipelineConfig = {
			target_id: targetId,
			target_url: target.url,
			workspace_dir: workspaceDir,
			stageCallbacks,
			registerStop: (stopFn) => {
				pipelineStopFn = stopFn;
			},
			probe_mode: probeMode,
			providers: probeMode === "multi" ? providersWithKey : undefined,
		};

		// LLM mode is always "llm" (chatLLM is required, ARCHITECTURE.md 9-A.1)
		const configManager2 = new ProviderConfigManager(workspaceDir);
		const enabledForDisplay = configManager2.getEnabled().filter((p) => p.api_key);
		const llmMode = "llm";
		const configuredProviders = enabledForDisplay.map((p) => {
			return `${p.provider_id}/${p.default_model ?? "default"}`;
		});

		broadcastSSE("pipeline:started", {
			target_id: targetId,
			pipeline_id: pipeline.pipeline_id,
			llm_mode: llmMode,
			probe_mode: probeMode,
			configured_providers: configuredProviders,
		});

		// Fire-and-forget: execute pipeline in background
		runningPipelines.set(targetId, { stop: () => pipelineStopFn?.() });
		executePipelineAsync(pipeline.pipeline_id, targetId, config, deps, repo).finally(() => {
			runningPipelines.delete(targetId);
		});

		return c.json(
			{ ...pipeline, llm_mode: llmMode, configured_providers: configuredProviders },
			201,
		);
	}

	// Default: just create DB record (no execution)
	const pipeline = await repo.create(targetId);
	return c.json(pipeline, 201);
});

/**
 * Runs the pipeline asynchronously, updating DB state as it progresses.
 */
async function executePipelineAsync(
	pipelineId: string,
	targetId: string,
	config: PipelineConfig,
	deps: PipelineDeps,
	repo: PipelineRepository,
): Promise<void> {
	try {
		console.log(`⏳ Pipeline started for target ${targetId} (${config.target_url}) [LLM-enhanced]`);
		const result = await runPipeline(config, deps);

		// LLM 인증 에러가 있으면 성공 여부와 관계없이 실패 처리
		const hasAuthError = result.llm_errors.some((e) => {
			const patterns = [
				/401/i,
				/403/i,
				/unauthorized/i,
				/forbidden/i,
				/invalid.*(?:key|token|subscription)/i,
				/access.*denied/i,
				/authentication/i,
				/invalid_api_key/i,
				/incorrect.*api.*key/i,
			];
			return patterns.some((p) => p.test(e));
		});

		if (hasAuthError) {
			const authErrMsg = `LLM API 인증 오류: ${result.llm_errors[0]?.slice(0, 200)}. Dashboard > LLM Providers 탭에서 API Key를 확인하세요.`;
			await repo.setError(pipelineId, authErrMsg);
			broadcastSSE("pipeline:failed", {
				target_id: targetId,
				pipeline_id: pipelineId,
				error: authErrMsg,
			});
			console.error(`❌ Pipeline stopped for ${targetId}: ${authErrMsg}`);
		} else if (result.success) {
			await repo.updateStage(pipelineId, "COMPLETED");
			broadcastSSE("pipeline:completed", {
				target_id: targetId,
				pipeline_id: pipelineId,
				initial_score: result.initial_score,
				final_score: result.final_score,
				delta: result.delta,
				cycles: result.cycles_completed,
			});
			const modelsStr =
				result.llm_models_used.length > 0
					? ` LLM: ${result.llm_models_used.join(", ")}`
					: " (no LLM)";
			if (result.llm_errors.length > 0) {
				console.warn(`⚠️ LLM errors during pipeline (${result.llm_errors.length} unique):`);
				for (const e of result.llm_errors.slice(0, 5)) {
					console.warn(`   - ${e.slice(0, 200)}`);
				}
				broadcastSSE("pipeline:llm-warning", {
					target_id: targetId,
					pipeline_id: pipelineId,
					errors: result.llm_errors.slice(0, 5),
				});
			}
			console.log(
				`✅ Pipeline completed for ${targetId}: ${result.initial_score} → ${result.final_score} (+${result.delta}) [${result.cycles_completed} cycles]${modelsStr}`,
			);
		} else {
			await repo.setError(pipelineId, result.error ?? "Unknown error");
			broadcastSSE("pipeline:failed", {
				target_id: targetId,
				pipeline_id: pipelineId,
				error: result.error,
			});
			console.log(`❌ Pipeline failed for ${targetId}: ${result.error}`);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await repo.setError(pipelineId, msg);
		console.error(`❌ Pipeline crashed for ${targetId}:`, msg);
	}
}

// DELETE /api/targets/:id/pipeline/:pipelineId — 파이프라인 + 스테이지 실행 기록 삭제
pipelineRouter.delete("/:id/pipeline/:pipelineId", async (c) => {
	const repo = getRepo();
	const stageRepo = getStageRepo();
	const pipelineId = c.req.param("pipelineId");

	// Prevent deleting running pipelines
	const pipeline = await repo.findById(pipelineId);
	if (!pipeline) {
		return c.json({ error: "Pipeline not found" }, 404);
	}
	if (runningPipelines.has(pipeline.target_id)) {
		return c.json({ error: "Cannot delete a running pipeline" }, 409);
	}

	// Delete stage executions first (FK dependency), then pipeline record
	const deletedStages = await stageRepo.deleteByPipelineId(pipelineId);
	const deleted = await repo.deleteById(pipelineId);

	return c.json({ deleted, deleted_stages: deletedStages });
});

// PUT /api/targets/:id/pipeline/:pipelineId/stage — 스테이지 변경
pipelineRouter.put("/:id/pipeline/:pipelineId/stage", async (c) => {
	const repo = getRepo();
	const body = await c.req.json();
	if (!body.stage) {
		return c.json({ error: "stage is required" }, 400);
	}
	const updated = await repo.updateStage(c.req.param("pipelineId"), body.stage);
	if (!updated) {
		return c.json({ error: "Pipeline not found" }, 404);
	}
	return c.json(updated);
});

// ── Stage Execution Routes ───────────────────────────────

// GET /api/targets/:id/pipeline/:pipelineId/stages — 스테이지 실행 목록
pipelineRouter.get("/:id/pipeline/:pipelineId/stages", async (c) => {
	const stageRepo = getStageRepo();
	const pipelineId = c.req.param("pipelineId");
	const stages = await stageRepo.findByPipelineId(pipelineId);

	// result_full 제외하여 응답 경량화
	const summary = stages.map((s) => ({
		id: s.id,
		pipeline_id: s.pipeline_id,
		stage: s.stage,
		cycle: s.cycle,
		status: s.status,
		prompt_summary: s.prompt_summary,
		result_summary: s.result_summary,
		error_message: s.error_message,
		started_at: s.started_at,
		completed_at: s.completed_at,
		duration_ms: s.duration_ms,
	}));

	return c.json(summary);
});

// GET /api/targets/:id/pipeline/:pipelineId/stages/:stageId — 스테이지 단건 (result_full 포함)
pipelineRouter.get("/:id/pipeline/:pipelineId/stages/:stageId", async (c) => {
	const stageRepo = getStageRepo();
	const stage = await stageRepo.findById(c.req.param("stageId"));
	if (!stage) {
		return c.json({ error: "Stage execution not found" }, 404);
	}
	return c.json(stage);
});

// ── Evaluation Results Route ─────────────────────────────

// GET /api/targets/:id/pipeline/:pipelineId/evaluation — 평가 결과 조회
pipelineRouter.get("/:id/pipeline/:pipelineId/evaluation", async (c) => {
	const stageRepo = getStageRepo();
	const pipelineId = c.req.param("pipelineId");
	const stages = await stageRepo.findByPipelineId(pipelineId);

	// Find ANALYZING and latest VALIDATING stages
	const analyzingStage = stages.find((s) => s.stage === "ANALYZING" && s.result_full);
	const validatingStages = stages.filter((s) => s.stage === "VALIDATING" && s.result_full);
	const latestValidating =
		validatingStages.length > 0 ? validatingStages[validatingStages.length - 1] : null;

	if (!analyzingStage?.result_full) {
		return c.json({ error: "No evaluation data available" }, 404);
	}

	let initial: Record<string, unknown>;
	try {
		initial = JSON.parse(analyzingStage.result_full);
	} catch {
		return c.json({ error: "Failed to parse evaluation data" }, 500);
	}

	let final_data: Record<string, unknown> | null = null;
	const parseWarnings: string[] = [];
	if (latestValidating?.result_full) {
		try {
			final_data = JSON.parse(latestValidating.result_full);
		} catch (err) {
			const msg = `Validation result parse error: ${err instanceof Error ? err.message : String(err)}`;
			console.warn(`⚠️ ${msg}`);
			parseWarnings.push(msg);
		}
	}

	const initialScore = (initial.score as number) ?? 0;
	const finalScore = final_data
		? ((final_data.after as number) ?? ((final_data.delta as number) ?? 0) + initialScore)
		: initialScore;

	// Extract LLM models + generated summaries from REPORTING stage
	const reportingStage = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	let llmModelsUsed: string[] = [];
	let llmErrors: string[] = [];
	let reportExecutiveSummary: Record<string, unknown> | null = null;
	let reportStructuredRecs: Record<string, unknown> | null = null;
	let reportDimInterpretations: Record<string, unknown> | null = null;
	if (reportingStage?.result_full) {
		try {
			const reportData = JSON.parse(reportingStage.result_full);
			llmModelsUsed = reportData.llm_models_used ?? [];
			llmErrors = reportData.llm_errors ?? [];
			reportExecutiveSummary = reportData.executive_summary ?? null;
			reportStructuredRecs = reportData.structured_recommendations ?? null;
			reportDimInterpretations = reportData.dimension_interpretations ?? null;
		} catch (err) {
			const msg = `Reporting stage parse error: ${err instanceof Error ? err.message : String(err)}`;
			console.warn(`⚠️ ${msg}`);
			parseWarnings.push(msg);
		}
	}
	// Fallback: scan all stages for llm_call_log entries (for in-progress pipelines)
	if (llmModelsUsed.length === 0) {
		const modelSet = new Set<string>();
		for (const s of stages) {
			if (!s.result_full) continue;
			try {
				const rf = JSON.parse(s.result_full);
				if (Array.isArray(rf.llm_call_log)) {
					for (const entry of rf.llm_call_log) {
						if (entry.provider && entry.model) modelSet.add(`${entry.provider}/${entry.model}`);
					}
				}
				if (Array.isArray(rf.llm_models_used)) {
					for (const m of rf.llm_models_used) modelSet.add(m);
				}
			} catch (err) {
				const msg = `Stage ${s.stage} parse error: ${err instanceof Error ? err.message : String(err)}`;
				console.warn(`⚠️ ${msg}`);
				parseWarnings.push(msg);
			}
		}
		llmModelsUsed = Array.from(modelSet);
	}

	// parseWarnings를 llmErrors에 합산하여 사용자에게 전달
	const allErrors = [...llmErrors, ...parseWarnings];

	// GEO Score (Level 1) — probe 결과가 반영된 종합 점수
	const geoScore = (initial.geo_score as Record<string, unknown>) ?? null;
	const readinessScore = (initial.readiness_score as number) ?? initialScore;

	return c.json({
		initial_score: initialScore,
		initial_grade: initial.grade ?? "Unknown",
		final_score: finalScore,
		final_grade: final_data ? (initial.grade ?? "Unknown") : (initial.grade ?? "Unknown"),
		delta: finalScore - initialScore,
		site_type: initial.site_type ?? "unknown",
		dimensions: initial.dimensions ?? [],
		geo_score: geoScore,
		readiness_score: readinessScore,
		multi_page: initial.multi_page ?? null,
		eval_data: initial.eval_data ?? null,
		synthetic_probes: initial.synthetic_probes ?? null,
		multi_provider_probes: initial.multi_provider_probes ?? null,
		probe_mode: initial.probe_mode ?? "single",
		rich_report: initial.rich_report ?? null,
		executive_summary:
			reportExecutiveSummary ??
			(initial.executive_summary as Record<string, unknown> | null) ??
			null,
		structured_recommendations:
			reportStructuredRecs ??
			(initial.structured_recommendations as Record<string, unknown> | null) ??
			null,
		dimension_interpretations:
			reportDimInterpretations ??
			(initial.dimension_interpretations as Record<string, unknown> | null) ??
			null,
		analysis_report: initial,
		validation: final_data,
		llm_models_used: llmModelsUsed,
		llm_errors: allErrors,
		stages: stages.map((s) => ({
			stage: s.stage,
			status: s.status,
			result_summary: s.result_summary,
			duration_ms: s.duration_ms,
		})),
	});
});

// GET /api/targets/:id/pipeline/:pipelineId/executive-summary — LLM 기반 종합 평가 의견 (캐시 지원)
pipelineRouter.get("/:id/pipeline/:pipelineId/executive-summary", async (c) => {
	const stageRepo = getStageRepo();
	const targetRepo = getTargetRepo();
	const pipelineId = c.req.param("pipelineId");
	const targetId = c.req.param("id");

	// 1. Gather evaluation data
	const stages = await stageRepo.findByPipelineId(pipelineId);
	const analyzingStage = stages.find((s) => s.stage === "ANALYZING" && s.result_full);
	if (!analyzingStage?.result_full) {
		return c.json({ error: "No evaluation data available" }, 404);
	}

	let initial: Record<string, unknown>;
	try {
		initial = JSON.parse(analyzingStage.result_full);
	} catch {
		return c.json({ error: "Failed to parse evaluation data" }, 500);
	}

	// 2. Return cached summary: check REPORTING stage first, then ANALYZING
	const reportingStg = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	if (reportingStg?.result_full) {
		try {
			const rd = JSON.parse(reportingStg.result_full);
			if (rd.executive_summary?.catchphrase) {
				return c.json(rd.executive_summary);
			}
		} catch {
			/* ignore */
		}
	}
	const cached = initial.executive_summary as Record<string, unknown> | undefined;
	if (cached?.catchphrase) {
		return c.json(cached);
	}

	// 3. Build LLM client
	const workspaceDir = sharedSettings?.workspace_dir ?? "./run";
	let client: GeoLLMClient;
	try {
		const configManager = new ProviderConfigManager(workspaceDir);
		const providersWithKey = configManager.getEnabled().filter((p) => p.api_key);
		if (providersWithKey.length === 0) {
			return c.json({ error: "LLM API Key not configured" }, 400);
		}
		client = new GeoLLMClient(workspaceDir);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: `LLM initialization failed: ${msg}` }, 500);
	}

	// 4. Build compact summary of evaluation data for LLM
	const target = await targetRepo.findById(targetId);
	const score = (initial.score as number) ?? 0;
	const grade = (initial.grade as string) ?? "Unknown";
	const siteType = (initial.site_type as string) ?? "unknown";
	const dimensions =
		(initial.dimensions as Array<{
			id: string;
			label: string;
			score: number;
			details: string[];
		}>) ?? [];
	const evalData = (initial.eval_data as Record<string, unknown>) ?? {};
	const richReport = (initial.rich_report as Record<string, unknown>) ?? {};

	const dimSummary = dimensions
		.map(
			(d) =>
				`${d.id} ${d.label}: ${d.score.toFixed(1)}/100 (${d.details?.slice(0, 2).join("; ") ?? ""})`,
		)
		.join("\n");

	const strengths =
		((richReport as Record<string, unknown>)?.overview as Record<string, unknown>)?.strengths ??
		(evalData as Record<string, unknown>)?.strengths ??
		[];
	const weaknesses =
		((richReport as Record<string, unknown>)?.overview as Record<string, unknown>)?.weaknesses ??
		(evalData as Record<string, unknown>)?.weaknesses ??
		[];

	const strengthsText = Array.isArray(strengths)
		? (strengths as Array<{ title?: string; description?: string }>)
				.map((s) => `- ${s.title ?? ""}: ${s.description ?? ""}`)
				.join("\n")
		: "";
	const weaknessesText = Array.isArray(weaknesses)
		? (weaknesses as Array<{ title?: string; description?: string }>)
				.map((w) => `- ${w.title ?? ""}: ${w.description ?? ""}`)
				.join("\n")
		: "";

	const prompt = `You are a senior GEO (Generative Engine Optimization) consultant writing an executive summary for a client report.

Target: ${target?.name ?? "Unknown"} (${target?.url ?? ""})
Site Type: ${siteType}
Overall GEO Readiness Score: ${score.toFixed(1)}/100 (Grade: ${grade})

Dimension Scores:
${dimSummary}

Strengths:
${strengthsText || "None identified"}

Weaknesses:
${weaknessesText || "None identified"}

Generate a JSON response with these fields:
1. "catchphrase": A single impactful Korean sentence (max 20 chars) that captures the site's GEO status. Like a consulting headline. Examples: "구조는 탄탄, 콘텐츠는 미흡", "AI 시대 준비 완료", "기초부터 재점검 필요"
2. "verdict": A 2-3 sentence Korean summary of the overall GEO readiness assessment. Be specific about what the score means in practice.
3. "top_priorities": Array of exactly 3 objects, each with "title" (short Korean, max 15 chars) and "description" (1-sentence Korean explanation of why this matters and what to do). These should be the most impactful improvements ranked by priority.
4. "risk_level": One of "critical", "warning", "moderate", "good", "excellent" based on overall readiness.

Be concise, professional, and actionable. Write in Korean.
Return ONLY valid JSON, no markdown fences.`;

	try {
		const response = await client.chat({
			prompt,
			temperature: 0.3,
			json_mode: true,
			max_tokens: 1000,
		});

		let parsed: Record<string, unknown>;
		try {
			const cleaned = response.content
				.replace(/```json\s*/g, "")
				.replace(/```\s*/g, "")
				.trim();
			parsed = JSON.parse(cleaned);
		} catch {
			return c.json({ error: "Failed to parse LLM response", raw: response.content }, 500);
		}

		const result = {
			...parsed,
			score,
			grade,
			site_type: siteType,
			generated_at: new Date().toISOString(),
			model: `${response.provider}/${response.model}`,
		};

		// 5. Save to ANALYZING stage result_full for future reuse
		await stageRepo.patchResultFull(analyzingStage.id, { executive_summary: result });

		return c.json(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: `LLM call failed: ${msg}` }, 500);
	}
});

// GET /api/targets/:id/pipeline/:pipelineId/recommendations — LLM 기반 권고사항 구조화 (캐시 지원)
pipelineRouter.get("/:id/pipeline/:pipelineId/recommendations", async (c) => {
	const stageRepo = getStageRepo();
	const targetRepo = getTargetRepo();
	const pipelineId = c.req.param("pipelineId");
	const targetId = c.req.param("id");

	const stages = await stageRepo.findByPipelineId(pipelineId);
	const analyzingStage = stages.find((s) => s.stage === "ANALYZING" && s.result_full);
	if (!analyzingStage?.result_full) {
		return c.json({ error: "No evaluation data available" }, 404);
	}

	let initial: Record<string, unknown>;
	try {
		initial = JSON.parse(analyzingStage.result_full);
	} catch {
		return c.json({ error: "Failed to parse evaluation data" }, 500);
	}

	// Return cached: check REPORTING stage first, then ANALYZING
	const reportingStgR = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	if (reportingStgR?.result_full) {
		try {
			const rd = JSON.parse(reportingStgR.result_full);
			if (rd.structured_recommendations?.items) {
				return c.json(rd.structured_recommendations);
			}
		} catch {
			/* ignore */
		}
	}
	const cached = initial.structured_recommendations as Record<string, unknown> | undefined;
	if (cached?.items) {
		return c.json(cached);
	}

	// Build LLM client
	const workspaceDir = sharedSettings?.workspace_dir ?? "./run";
	let client: GeoLLMClient;
	try {
		const configManager = new ProviderConfigManager(workspaceDir);
		const providersWithKey = configManager.getEnabled().filter((p) => p.api_key);
		if (providersWithKey.length === 0) {
			return c.json({ error: "LLM API Key not configured" }, 400);
		}
		client = new GeoLLMClient(workspaceDir);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: `LLM initialization failed: ${msg}` }, 500);
	}

	// Gather all recommendation sources
	const target = await targetRepo.findById(targetId);
	const score = (initial.score as number) ?? 0;
	const grade = (initial.grade as string) ?? "Unknown";
	const siteType = (initial.site_type as string) ?? "unknown";
	const dimensions =
		(initial.dimensions as Array<{
			id: string;
			label: string;
			score: number;
			details: string[];
		}>) ?? [];
	const evalData = (initial.eval_data as Record<string, unknown>) ?? {};
	const richReport = (initial.rich_report as Record<string, unknown>) ?? {};

	// Collect existing recommendations
	const rrRecs = (richReport as Record<string, unknown>)?.recommendations as Record<
		string,
		unknown
	> | null;
	const edImprovements = (evalData as Record<string, unknown>)?.improvements as
		| Array<Record<string, unknown>>
		| undefined;

	let existingRecs = "";
	if (rrRecs) {
		const allRr = [
			...((rrRecs.high_priority as Array<Record<string, unknown>>) ?? []),
			...((rrRecs.medium_priority as Array<Record<string, unknown>>) ?? []),
			...((rrRecs.low_priority as Array<Record<string, unknown>>) ?? []),
		];
		existingRecs = allRr
			.map(
				(r) =>
					`[${r.priority ?? "medium"}] ${r.title ?? ""}: ${r.description ?? ""} (impact: ${r.impact ?? ""}, effort: ${r.effort ?? ""})`,
			)
			.join("\n");
	}
	if (edImprovements && edImprovements.length > 0) {
		const edText = edImprovements
			.map(
				(r) =>
					`[impact:${r.impact ?? "?"}/5, difficulty:${r.difficulty ?? "?"}] ${r.title ?? ""}: ${r.description ?? ""} (현재: ${r.current_state ?? ""}, 영향: ${Array.isArray(r.affected_dimensions) ? (r.affected_dimensions as string[]).join(",") : ""})`,
			)
			.join("\n");
		existingRecs += existingRecs ? `\n${edText}` : edText;
	}

	const dimSummary = dimensions
		.map((d) => `${d.id} ${d.label}: ${d.score.toFixed(1)}/100`)
		.join(", ");

	// Gather strengths/weaknesses for context
	const overview = (richReport as Record<string, unknown>)?.overview as
		| Record<string, unknown>
		| undefined;
	const strengths = (overview?.strengths ??
		(evalData as Record<string, unknown>)?.strengths ??
		[]) as Array<Record<string, unknown>>;
	const weaknesses = (overview?.weaknesses ??
		(evalData as Record<string, unknown>)?.weaknesses ??
		[]) as Array<Record<string, unknown>>;
	const contextText = [
		strengths.length > 0 ? `강점: ${strengths.map((s) => s.title ?? "").join(", ")}` : "",
		weaknesses.length > 0 ? `약점: ${weaknesses.map((w) => w.title ?? "").join(", ")}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const prompt = `You are a senior GEO consultant. Based on the analysis data below, produce structured improvement recommendations in Korean.

Target: ${target?.name ?? "Unknown"} (${target?.url ?? ""})
Site Type: ${siteType}
GEO Score: ${score.toFixed(1)}/100 (${grade})
Dimensions: ${dimSummary}
${contextText}

Existing analysis recommendations:
${existingRecs || "None"}

Generate a JSON with:
- "items": Array of 5-8 recommendation objects, ordered by priority (highest first). Each object must have:
  - "priority": "critical" | "high" | "medium" | "low"
  - "title": Short Korean title (max 25 chars)
  - "rationale": 1-2 sentence Korean explanation of WHY this is a problem, citing specific data from the analysis (scores, missing schemas, blocked bots, etc.)
  - "action": 1-2 sentence Korean description of WHAT to do concretely
  - "expected_effect": 1 sentence Korean description of the expected improvement (which dimensions improve, estimated score impact)
  - "effort": "easy" | "medium" | "hard"
  - "affected_dimensions": array of dimension IDs like ["S1","S2"]

Rules:
- Every rationale MUST reference specific findings from the analysis data (e.g. "S2 점수 32.5점으로 구조화 데이터 부재", "GPTBot 차단 상태")
- Do NOT invent data. Only reference what is provided above.
- Be actionable and specific in the action field.
- Write entirely in Korean.
Return ONLY valid JSON.`;

	try {
		const response = await client.chat({
			prompt,
			temperature: 0.3,
			json_mode: true,
			max_tokens: 2000,
		});

		let parsed: Record<string, unknown>;
		try {
			const cleaned = response.content
				.replace(/```json\s*/g, "")
				.replace(/```\s*/g, "")
				.trim();
			parsed = JSON.parse(cleaned);
		} catch {
			return c.json({ error: "Failed to parse LLM response", raw: response.content }, 500);
		}

		const result = {
			...parsed,
			generated_at: new Date().toISOString(),
			model: `${response.provider}/${response.model}`,
		};

		await stageRepo.patchResultFull(analyzingStage.id, { structured_recommendations: result });

		return c.json(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: `LLM call failed: ${msg}` }, 500);
	}
});

// GET /api/targets/:id/pipeline/:pipelineId/llm-log — LLM 호출 전체 로그
pipelineRouter.get("/:id/pipeline/:pipelineId/llm-log", async (c) => {
	const stageRepo = getStageRepo();
	const pipelineId = c.req.param("pipelineId");

	const stages = await stageRepo.findByPipelineId(pipelineId);

	// Try REPORTING stage first (has the complete log)
	const reportingStage = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	if (reportingStage?.result_full) {
		try {
			const reportData = JSON.parse(reportingStage.result_full);
			return c.json({
				llm_call_log: reportData.llm_call_log ?? [],
				llm_models_used: reportData.llm_models_used ?? [],
				total_calls: (reportData.llm_call_log ?? []).length,
			});
		} catch {
			/* fall through */
		}
	}

	// Fallback: scan all stages for llm_call_log entries
	const allLogs: unknown[] = [];
	const modelSet = new Set<string>();
	for (const s of stages) {
		if (!s.result_full) continue;
		try {
			const rf = JSON.parse(s.result_full);
			if (Array.isArray(rf.llm_call_log)) {
				allLogs.push(...rf.llm_call_log);
				for (const entry of rf.llm_call_log) {
					if (entry.provider && entry.model) modelSet.add(`${entry.provider}/${entry.model}`);
				}
			}
		} catch {
			/* ignore */
		}
	}
	return c.json({
		llm_call_log: allLogs,
		llm_models_used: Array.from(modelSet),
		total_calls: allLogs.length,
	});
});

// ── Cycle Control Routes ──────────────────────────────────

// POST /api/targets/:id/cycle/stop — 수동 중단
pipelineRouter.post("/:id/cycle/stop", async (c) => {
	const repo = getRepo();
	const targetId = c.req.param("id");
	const pipeline = await repo.findLatestByTargetId(targetId);
	if (!pipeline) {
		return c.json({ error: "No active pipeline" }, 404);
	}
	if (["COMPLETED", "FAILED", "PARTIAL_FAILURE", "STOPPED"].includes(pipeline.stage)) {
		return c.json({ error: "Pipeline already terminated" }, 400);
	}
	// Signal the running orchestrator to stop and release the pipeline lock
	runningPipelines.get(targetId)?.stop();
	runningPipelines.delete(targetId);
	const updated = await repo.updateStage(pipeline.pipeline_id, "STOPPED");
	return c.json({ stopped: true, pipeline: updated });
});

// GET /api/targets/:id/cycle/status — 현재 사이클 상태
pipelineRouter.get("/:id/cycle/status", async (c) => {
	const repo = getRepo();
	const stageRepo = getStageRepo();
	const pipeline = await repo.findLatestByTargetId(c.req.param("id"));
	if (!pipeline) {
		return c.json({ error: "No active pipeline" }, 404);
	}

	// 최신 실행 중인 스테이지의 prompt_summary를 가져와서 collapsed 상태에서 표시
	const stages = await stageRepo.findByPipelineId(pipeline.pipeline_id);
	const latestStage = stages.length > 0 ? stages[stages.length - 1] : null;

	// Extract LLM models — try REPORTING stage first, then scan all stages
	const reportingStage = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	let llmModels: string[] = [];
	if (reportingStage?.result_full) {
		try {
			const rd = JSON.parse(reportingStage.result_full);
			llmModels = rd.llm_models_used ?? [];
		} catch {
			/* ignore */
		}
	}

	// During execution (no REPORTING yet), scan stage result_full for llm_call_log entries
	if (llmModels.length === 0) {
		const modelSet = new Set<string>();
		for (const s of stages) {
			if (!s.result_full) continue;
			try {
				const rf = JSON.parse(s.result_full);
				// Check for llm_call_log array in result_full
				if (Array.isArray(rf.llm_call_log)) {
					for (const entry of rf.llm_call_log) {
						if (entry.provider && entry.model) {
							modelSet.add(`${entry.provider}/${entry.model}`);
						}
					}
				}
				// Check for llm_models_used array
				if (Array.isArray(rf.llm_models_used)) {
					for (const m of rf.llm_models_used) modelSet.add(m);
				}
			} catch {
				/* ignore */
			}
		}
		llmModels = Array.from(modelSet);
	}

	// Determine LLM mode: check configured providers
	let llmMode = "unknown";
	try {
		const workspaceDir = sharedSettings?.workspace_dir ?? "./run";
		const cfgMgr = new ProviderConfigManager(workspaceDir);
		const enabled = cfgMgr.getEnabled().filter((p) => p.api_key);
		llmMode = enabled.length > 0 ? "llm" : "rule-based";
	} catch {
		/* ignore */
	}

	// Configured providers (what will/was used)
	let configuredProviders: string[] = [];
	try {
		const workspaceDir = sharedSettings?.workspace_dir ?? "./run";
		const cfgMgr = new ProviderConfigManager(workspaceDir);
		configuredProviders = cfgMgr
			.getEnabled()
			.filter((p) => p.api_key)
			.map((p) => `${p.provider_id}/${p.default_model ?? "default"}`);
	} catch {
		/* ignore */
	}

	return c.json({
		pipeline_id: pipeline.pipeline_id,
		stage: pipeline.stage,
		is_terminal: ["COMPLETED", "FAILED", "PARTIAL_FAILURE", "STOPPED"].includes(pipeline.stage),
		retry_count: pipeline.retry_count,
		started_at: pipeline.started_at,
		updated_at: pipeline.updated_at,
		completed_at: pipeline.completed_at ?? null,
		current_prompt: latestStage?.prompt_summary ?? null,
		current_result: latestStage?.result_summary ?? null,
		stage_count: stages.length,
		llm_mode: llmMode,
		configured_providers: configuredProviders,
		llm_models_used: llmModels,
	});
});

export { pipelineRouter };
