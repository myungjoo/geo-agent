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
		try {
			const configManager = new ProviderConfigManager(workspaceDir);
			const enabledProviders = configManager.getEnabled();
			const providersWithKey = enabledProviders.filter((p) => p.api_key);
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

	// Extract LLM models from REPORTING stage, then scan all stages
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
			} catch {
				/* ignore */
			}
		}
		llmModelsUsed = Array.from(modelSet);
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
		rich_report: initial.rich_report ?? null,
		analysis_report: initial,
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
