import {
	type AppSettings,
	type GeoDatabase,
	PipelineRepository,
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

let sharedPipelineRepo: PipelineRepository | null = null;
let sharedStageRepo: StageExecutionRepository | null = null;
let sharedTargetRepo: TargetRepository | null = null;
let sharedSettings: AppSettings | null = null;

export function initPipelineRouter(
	db: GeoDatabase,
	settings?: AppSettings,
): void {
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
				const exec = await stageRepo.create(
					pipeline.pipeline_id,
					stage,
					cycle,
					promptSummary,
				);
				return exec.id;
			},
			onStageComplete: async (executionId, resultSummary, resultFull) => {
				await stageRepo.complete(executionId, resultSummary, resultFull);
			},
			onStageFail: async (executionId, error) => {
				await stageRepo.fail(executionId, error);
			},
		};

		const deps: PipelineDeps = {
			crawlTarget,
			scoreTarget,
			classifySite,
			crawlMultiplePages,
		};

		const config: PipelineConfig = {
			target_id: targetId,
			target_url: target.url,
			workspace_dir: sharedSettings?.workspace_dir ?? "./run",
			stageCallbacks,
		};

		// Fire-and-forget: execute pipeline in background
		runningPipelines.add(targetId);
		executePipelineAsync(pipeline.pipeline_id, targetId, config, deps, repo).finally(
			() => {
				runningPipelines.delete(targetId);
			},
		);

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
		console.log(`⏳ Pipeline started for target ${targetId} (${config.target_url})`);
		const result = await runPipeline(config, deps);

		if (result.success) {
			await repo.updateStage(pipelineId, "COMPLETED");
			console.log(
				`✅ Pipeline completed for ${targetId}: ${result.initial_score} → ${result.final_score} (+${result.delta})`,
			);
		} else {
			await repo.setError(pipelineId, result.error ?? "Unknown error");
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
	const latestValidating = validatingStages.length > 0
		? validatingStages[validatingStages.length - 1]
		: null;

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
		? (final_data.after as number) ?? (final_data.delta as number ?? 0) + initialScore
		: initialScore;

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
		validation: final_data,
		stages: stages.map((s) => ({
			stage: s.stage,
			status: s.status,
			result_summary: s.result_summary,
			duration_ms: s.duration_ms,
		})),
	});
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

	return c.json({
		pipeline_id: pipeline.pipeline_id,
		stage: pipeline.stage,
		is_terminal: ["COMPLETED", "FAILED", "PARTIAL_FAILURE"].includes(pipeline.stage),
		retry_count: pipeline.retry_count,
		started_at: pipeline.started_at,
		updated_at: pipeline.updated_at,
		current_prompt: latestStage?.prompt_summary ?? null,
		current_result: latestStage?.result_summary ?? null,
		stage_count: stages.length,
	});
});

export { pipelineRouter };
