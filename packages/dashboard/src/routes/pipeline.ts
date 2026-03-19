import {
	type AppSettings,
	type GeoDatabase,
	GeoLLMClient,
	PipelineRepository,
	ProviderConfigManager,
	StageExecutionRepository,
	TargetRepository,
	type PipelineConfig,
	type PipelineDeps,
	type StageCallbacks,
	runPipeline,
	classifySite,
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

// Track running pipelines to prevent double execution
const runningPipelines = new Set<string>();

const pipelineRouter = new Hono();

// ── Pipeline Routes ────────────────────────────────────────

// GET /api/targets/:id/pipeline — 타겟의 전체 파이프라인 목록
pipelineRouter.get("/:id/pipeline", async (c) => {
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

		// Build chatLLM dependency — graceful degradation if no API key configured
		let chatLLM: PipelineDeps["chatLLM"] | undefined;
		const workspaceDir = sharedSettings?.workspace_dir ?? "./run";
		try {
			const configManager = new ProviderConfigManager(workspaceDir);
			const enabledProviders = configManager.getEnabled();
			if (enabledProviders.length > 0 && enabledProviders.some((p) => p.api_key)) {
				const client = new GeoLLMClient(workspaceDir);
				chatLLM = (req) => client.chat(req);
				console.log(
					`🤖 LLM enabled: ${enabledProviders
						.filter((p) => p.api_key)
						.map((p) => p.provider_id)
						.join(", ")}`,
				);
			} else {
				console.log(
					"⚠️ No LLM API key configured — running pipeline in rule-based mode. " +
						"Configure via Dashboard > LLM Providers tab.",
				);
			}
		} catch (err) {
			console.warn(
				"⚠️ Failed to initialize LLM client — running pipeline in rule-based mode:",
				err instanceof Error ? err.message : String(err),
			);
		}

		const deps: PipelineDeps = {
			crawlTarget,
			scoreTarget,
			classifySite,
			crawlMultiplePages,
			chatLLM,
		};

		const config: PipelineConfig = {
			target_id: targetId,
			target_url: target.url,
			workspace_dir: workspaceDir,
			stageCallbacks,
		};

		// Fire-and-forget: execute pipeline in background
		runningPipelines.add(targetId);
		executePipelineAsync(pipeline.pipeline_id, targetId, config, deps, repo).finally(() => {
			runningPipelines.delete(targetId);
		});

		return c.json(pipeline, 201);
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
		const llmMode = deps.chatLLM ? "LLM-enhanced" : "rule-based only";
		console.log(`⏳ Pipeline started for target ${targetId} (${config.target_url}) [${llmMode}]`);
		const result = await runPipeline(config, deps);

		if (result.success) {
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
	if (latestValidating?.result_full) {
		try {
			final_data = JSON.parse(latestValidating.result_full);
		} catch {
			// ignore parse error
		}
	}

	const initialScore = (initial.score as number) ?? 0;
	const finalScore = final_data
		? ((final_data.after as number) ?? ((final_data.delta as number) ?? 0) + initialScore)
		: initialScore;

	// Extract LLM models from REPORTING stage result_full
	const reportingStage = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	let llmModelsUsed: string[] = [];
	let llmErrors: string[] = [];
	if (reportingStage?.result_full) {
		try {
			const reportData = JSON.parse(reportingStage.result_full);
			llmModelsUsed = reportData.llm_models_used ?? [];
			llmErrors = reportData.llm_errors ?? [];
		} catch {
			/* ignore */
		}
	}

	return c.json({
		initial_score: initialScore,
		initial_grade: initial.grade ?? "Unknown",
		final_score: finalScore,
		final_grade: final_data ? (initial.grade ?? "Unknown") : (initial.grade ?? "Unknown"),
		delta: finalScore - initialScore,
		site_type: initial.site_type ?? "unknown",
		dimensions: initial.dimensions ?? [],
		multi_page: initial.multi_page ?? null,
		eval_data: initial.eval_data ?? null,
		synthetic_probes: initial.synthetic_probes ?? null,
		validation: final_data,
		llm_models_used: llmModelsUsed,
		llm_errors: llmErrors,
		stages: stages.map((s) => ({
			stage: s.stage,
			status: s.status,
			result_summary: s.result_summary,
			duration_ms: s.duration_ms,
		})),
	});
});

// GET /api/targets/:id/pipeline/:pipelineId/llm-log — LLM 호출 전체 로그
pipelineRouter.get("/:id/pipeline/:pipelineId/llm-log", async (c) => {
	const stageRepo = getStageRepo();
	const pipelineId = c.req.param("pipelineId");

	const stages = await stageRepo.findByPipelineId(pipelineId);
	const reportingStage = stages.find((s) => s.stage === "REPORTING" && s.result_full);
	if (!reportingStage?.result_full) {
		return c.json({ llm_call_log: [], message: "No LLM call log available (pipeline not completed or no LLM used)" });
	}

	try {
		const reportData = JSON.parse(reportingStage.result_full);
		return c.json({
			llm_call_log: reportData.llm_call_log ?? [],
			llm_models_used: reportData.llm_models_used ?? [],
			total_calls: (reportData.llm_call_log ?? []).length,
		});
	} catch {
		return c.json({ llm_call_log: [], message: "Failed to parse report data" });
	}
});

// ── Cycle Control Routes ──────────────────────────────────

// POST /api/targets/:id/cycle/stop — 수동 중단
pipelineRouter.post("/:id/cycle/stop", async (c) => {
	const repo = getRepo();
	const pipeline = await repo.findLatestByTargetId(c.req.param("id"));
	if (!pipeline) {
		return c.json({ error: "No active pipeline" }, 404);
	}
	if (pipeline.stage === "COMPLETED" || pipeline.stage === "FAILED") {
		return c.json({ error: "Pipeline already terminated" }, 400);
	}
	const updated = await repo.updateStage(pipeline.pipeline_id, "COMPLETED");
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

	// Extract LLM models from REPORTING stage
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

	return c.json({
		pipeline_id: pipeline.pipeline_id,
		stage: pipeline.stage,
		is_terminal: ["COMPLETED", "FAILED", "PARTIAL_FAILURE"].includes(pipeline.stage),
		retry_count: pipeline.retry_count,
		started_at: pipeline.started_at,
		updated_at: pipeline.updated_at,
		completed_at: pipeline.completed_at ?? null,
		current_prompt: latestStage?.prompt_summary ?? null,
		current_result: latestStage?.result_summary ?? null,
		stage_count: stages.length,
		llm_models_used: llmModels,
	});
});

export { pipelineRouter };
