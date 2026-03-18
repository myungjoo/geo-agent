/**
 * Pipeline & Cycle Control Routes
 *
 * /api/targets/:id/pipeline — 파이프라인 관리
 * /api/targets/:id/cycle    — 사이클 제어
 */
import { Hono } from "hono";
import {
	type GeoDatabase,
	PipelineRepository,
} from "@geo-agent/core";

let sharedPipelineRepo: PipelineRepository | null = null;

export function initPipelineRouter(db: GeoDatabase): void {
	sharedPipelineRepo = new PipelineRepository(db);
}

function getRepo(): PipelineRepository {
	if (!sharedPipelineRepo) {
		throw new Error("Pipeline router not initialized. Call initPipelineRouter(db) at startup.");
	}
	return sharedPipelineRepo;
}

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

// POST /api/targets/:id/pipeline — 새 파이프라인 실행 시작
pipelineRouter.post("/:id/pipeline", async (c) => {
	const repo = getRepo();
	const targetId = c.req.param("id");
	const pipeline = await repo.create(targetId);
	return c.json(pipeline, 201);
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
	const pipeline = await repo.findLatestByTargetId(c.req.param("id"));
	if (!pipeline) {
		return c.json({ error: "No active pipeline" }, 404);
	}
	return c.json({
		pipeline_id: pipeline.pipeline_id,
		stage: pipeline.stage,
		is_terminal: ["COMPLETED", "FAILED", "PARTIAL_FAILURE"].includes(pipeline.stage),
		retry_count: pipeline.retry_count,
		started_at: pipeline.started_at,
		updated_at: pipeline.updated_at,
	});
});

export { pipelineRouter };
