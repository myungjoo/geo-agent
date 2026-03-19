import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `geo-pipeline-route-test-${Date.now()}`);

// Set env before any imports that use loadSettings
process.env.GEO_WORKSPACE = testDir;

// Ensure workspace directories exist
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });

const dbPath = path.join(testDir, "data", "geo-agent.db");

// Import app and initialize routers with shared DB
const { app } = await import("../server.js");
const { initTargetsRouter } = await import("./targets.js");
const { initPipelineRouter } = await import("./pipeline.js");
const { createDatabase, loadSettings, ensureTables, StageExecutionRepository } = await import(
	"@geo-agent/core"
);

const settings = loadSettings();
const db = createDatabase(settings);
await ensureTables(db);
initTargetsRouter(db);
initPipelineRouter(db, settings);

// ── Helpers ────────────────────────────────────────────────────

async function clearAll(): Promise<void> {
	const client = createClient({ url: `file:${dbPath}` });
	await client.execute("DELETE FROM stage_executions");
	await client.execute("DELETE FROM pipeline_runs");
	await client.execute("DELETE FROM targets");
	client.close();
}

async function createTarget(body: Record<string, unknown> = {}): Promise<Response> {
	const payload = {
		url: "https://example.com",
		name: "Test Target",
		...body,
	};
	return app.request("/api/targets", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}

async function getTargetId(): Promise<string> {
	const res = await createTarget();
	const body = await res.json();
	return body.id;
}

async function createPipeline(targetId: string): Promise<Response> {
	return app.request(`/api/targets/${targetId}/pipeline`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
	});
}

// ── Lifecycle ─────────────────────────────────────────────────

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

beforeEach(async () => {
	await clearAll();
});

// ══════════════════════════════════════════════════════════════
// Regression: Pipeline router initialization
// ══════════════════════════════════════════════════════════════

describe("Pipeline router initialization", () => {
	it("does not return 503 'Server not ready' when pipeline endpoint is called", async () => {
		const targetId = await getTargetId();
		const res = await createPipeline(targetId);
		// Must NOT be 503 — that would mean initPipelineRouter(db) was not called
		expect(res.status).not.toBe(503);
		const body = await res.json();
		expect(body.error).not.toBe("Server not ready");
	});
});

// ══════════════════════════════════════════════════════════════
// POST /api/targets/:id/pipeline — create pipeline
// ══════════════════════════════════════════════════════════════

describe("POST /api/targets/:id/pipeline", () => {
	it("returns 201 with a new pipeline in INIT stage", async () => {
		const targetId = await getTargetId();
		const res = await createPipeline(targetId);
		expect(res.status).toBe(201);

		const body = await res.json();
		expect(body.pipeline_id).toBeDefined();
		expect(typeof body.pipeline_id).toBe("string");
		expect(body.target_id).toBe(targetId);
		expect(body.stage).toBe("INIT");
	});

	it("created pipeline has expected default fields", async () => {
		const targetId = await getTargetId();
		const res = await createPipeline(targetId);
		const body = await res.json();

		expect(body.retry_count).toBe(0);
		expect(body.started_at).toBeDefined();
		expect(body.updated_at).toBeDefined();
		expect(body.completed_at).toBeNull();
		expect(body.error_message).toBeNull();
		expect(body.resumable).toBe(false);
	});

	it("can create multiple pipelines for the same target", async () => {
		const targetId = await getTargetId();
		const res1 = await createPipeline(targetId);
		const res2 = await createPipeline(targetId);
		expect(res1.status).toBe(201);
		expect(res2.status).toBe(201);

		const body1 = await res1.json();
		const body2 = await res2.json();
		expect(body1.pipeline_id).not.toBe(body2.pipeline_id);
	});
});

// ══════════════════════════════════════════════════════════════
// GET /api/targets/:id/pipeline — list pipelines
// ══════════════════════════════════════════════════════════════

describe("GET /api/targets/:id/pipeline", () => {
	it("returns empty array when no pipelines exist", async () => {
		const targetId = await getTargetId();
		const res = await app.request(`/api/targets/${targetId}/pipeline`, { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toEqual([]);
	});

	it("returns all pipelines for a target", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);
		await createPipeline(targetId);
		await createPipeline(targetId);

		const res = await app.request(`/api/targets/${targetId}/pipeline`, { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toHaveLength(3);
		for (const p of body) {
			expect(p.target_id).toBe(targetId);
		}
	});

	it("does not return pipelines from other targets", async () => {
		const targetId1 = await getTargetId();
		const res2 = await createTarget({ name: "Other Target", url: "https://other.com" });
		const targetId2 = (await res2.json()).id;

		await createPipeline(targetId1);
		await createPipeline(targetId2);

		const res = await app.request(`/api/targets/${targetId1}/pipeline`, { method: "GET" });
		const body = await res.json();
		expect(body).toHaveLength(1);
		expect(body[0].target_id).toBe(targetId1);
	});
});

// ══════════════════════════════════════════════════════════════
// GET /api/targets/:id/pipeline/latest — latest pipeline
// ══════════════════════════════════════════════════════════════

describe("GET /api/targets/:id/pipeline/latest", () => {
	it("returns 404 when no pipelines exist", async () => {
		const targetId = await getTargetId();
		const res = await app.request(`/api/targets/${targetId}/pipeline/latest`, { method: "GET" });
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("No pipeline found for this target");
	});

	it("returns the most recently created pipeline", async () => {
		const targetId = await getTargetId();
		const firstRes = await createPipeline(targetId);
		const firstPipeline = await firstRes.json();
		const secondRes = await createPipeline(targetId);
		const secondPipeline = await secondRes.json();

		const res = await app.request(`/api/targets/${targetId}/pipeline/latest`, { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		// Same-millisecond creates may return either; verify it's one of them
		expect([firstPipeline.pipeline_id, secondPipeline.pipeline_id]).toContain(body.pipeline_id);
	});

	it("returns single pipeline object (not array)", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		const res = await app.request(`/api/targets/${targetId}/pipeline/latest`, { method: "GET" });
		const body = await res.json();

		expect(body.pipeline_id).toBeDefined();
		expect(body.stage).toBeDefined();
		expect(Array.isArray(body)).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════
// PUT /api/targets/:id/pipeline/:pipelineId/stage — update stage
// ══════════════════════════════════════════════════════════════

describe("PUT /api/targets/:id/pipeline/:pipelineId/stage", () => {
	it("updates stage from INIT to ANALYZING", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stage: "ANALYZING" }),
			},
		);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.stage).toBe("ANALYZING");
		expect(body.pipeline_id).toBe(pipeline.pipeline_id);
	});

	it("updates updated_at timestamp on stage change", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();
		const originalUpdatedAt = pipeline.updated_at;

		// Small delay to ensure timestamp difference
		await new Promise((r) => setTimeout(r, 10));

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stage: "ANALYZING" }),
			},
		);
		const body = await res.json();
		expect(body.updated_at).not.toBe(originalUpdatedAt);
	});

	it("returns 400 when stage is missing from body", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.error).toBe("stage is required");
	});

	it("returns 404 for non-existent pipeline ID", async () => {
		const targetId = await getTargetId();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/00000000-0000-0000-0000-000000000000/stage`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stage: "ANALYZING" }),
			},
		);
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("Pipeline not found");
	});

	it("sets completed_at when stage is COMPLETED", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();
		expect(pipeline.completed_at).toBeNull();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stage: "COMPLETED" }),
			},
		);
		const body = await res.json();
		expect(body.completed_at).not.toBeNull();
	});

	it("sets completed_at when stage is FAILED", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stage: "FAILED" }),
			},
		);
		const body = await res.json();
		expect(body.completed_at).not.toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════
// POST /api/targets/:id/cycle/stop — manual stop
// ══════════════════════════════════════════════════════════════

describe("POST /api/targets/:id/cycle/stop", () => {
	it("stops an active pipeline and returns stopped:true", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		const res = await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.stopped).toBe(true);
		expect(body.pipeline).toBeDefined();
		expect(body.pipeline.stage).toBe("COMPLETED");
	});

	it("returns 404 when no pipeline exists for the target", async () => {
		const targetId = await getTargetId();

		const res = await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("No active pipeline");
	});

	it("returns 400 when pipeline is already COMPLETED", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		// First, set to COMPLETED
		await app.request(`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "COMPLETED" }),
		});

		// Then try to stop again
		const res = await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.error).toBe("Pipeline already terminated");
	});

	it("returns 400 when pipeline is already FAILED", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		await app.request(`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "FAILED" }),
		});

		const res = await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.error).toBe("Pipeline already terminated");
	});

	it("stops pipeline in ANALYZING stage", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		await app.request(`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "ANALYZING" }),
		});

		const res = await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.stopped).toBe(true);
		expect(body.pipeline.stage).toBe("COMPLETED");
	});
});

// ══════════════════════════════════════════════════════════════
// GET /api/targets/:id/cycle/status — cycle status
// ══════════════════════════════════════════════════════════════

describe("GET /api/targets/:id/cycle/status", () => {
	it("returns 404 when no pipeline exists", async () => {
		const targetId = await getTargetId();

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("No active pipeline");
	});

	it("returns status with all expected fields", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.pipeline_id).toBeDefined();
		expect(body.stage).toBe("INIT");
		expect(body.is_terminal).toBe(false);
		expect(body.retry_count).toBe(0);
		expect(body.started_at).toBeDefined();
		expect(body.updated_at).toBeDefined();
	});

	it("is_terminal is false for INIT stage", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		const body = await res.json();
		expect(body.is_terminal).toBe(false);
	});

	it("is_terminal is false for ANALYZING stage", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		await app.request(`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "ANALYZING" }),
		});

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		const body = await res.json();
		expect(body.is_terminal).toBe(false);
		expect(body.stage).toBe("ANALYZING");
	});

	it("is_terminal is true for COMPLETED stage", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		await app.request(`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "COMPLETED" }),
		});

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		const body = await res.json();
		expect(body.is_terminal).toBe(true);
		expect(body.stage).toBe("COMPLETED");
	});

	it("is_terminal is true for FAILED stage", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		await app.request(`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "FAILED" }),
		});

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		const body = await res.json();
		expect(body.is_terminal).toBe(true);
		expect(body.stage).toBe("FAILED");
	});

	it("reflects latest pipeline status after stop", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});

		const res = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		const body = await res.json();
		expect(body.stage).toBe("COMPLETED");
		expect(body.is_terminal).toBe(true);
	});
});

// ══════════════════════════════════════════════════════════════
// Pipeline lifecycle — end-to-end flows
// ══════════════════════════════════════════════════════════════

describe("Pipeline lifecycle", () => {
	it("full stage progression: INIT -> ANALYZING -> COMPLETED", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();
		const pid = pipeline.pipeline_id;

		// INIT -> ANALYZING
		await app.request(`/api/targets/${targetId}/pipeline/${pid}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "ANALYZING" }),
		});

		// ANALYZING -> COMPLETED
		const res = await app.request(`/api/targets/${targetId}/pipeline/${pid}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "COMPLETED" }),
		});

		const body = await res.json();
		expect(body.stage).toBe("COMPLETED");
		expect(body.completed_at).not.toBeNull();
	});

	it("create pipeline -> stop -> status shows terminal", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		// Stop
		const stopRes = await app.request(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(stopRes.status).toBe(200);

		// Status
		const statusRes = await app.request(`/api/targets/${targetId}/cycle/status`, { method: "GET" });
		const status = await statusRes.json();
		expect(status.is_terminal).toBe(true);
		expect(status.stage).toBe("COMPLETED");
	});

	it("latest returns most recent after multiple creates", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		// Advance first pipeline to COMPLETED
		const listRes1 = await app.request(`/api/targets/${targetId}/pipeline`, { method: "GET" });
		const list1 = await listRes1.json();
		await app.request(`/api/targets/${targetId}/pipeline/${list1[0].pipeline_id}/stage`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ stage: "COMPLETED" }),
		});

		// Create second pipeline
		const secondRes = await createPipeline(targetId);
		const second = await secondRes.json();

		// Latest should be the second one (in INIT)
		const latestRes = await app.request(`/api/targets/${targetId}/pipeline/latest`, {
			method: "GET",
		});
		const latest = await latestRes.json();
		expect(latest.pipeline_id).toBe(second.pipeline_id);
		expect(latest.stage).toBe("INIT");
	});
});

// ══════════════════════════════════════════════════════════════
// GET /api/targets/:id/pipeline/:pipelineId/stages
// ══════════════════════════════════════════════════════════════

describe("GET /api/targets/:id/pipeline/:pipelineId/stages", () => {
	it("returns empty array for pipeline with no stage executions", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stages`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual([]);
	});

	it("returns stage executions after they are created directly via repo", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		// Create stage executions directly via the repository
		const stageRepo = new StageExecutionRepository(db);
		const exec1 = await stageRepo.create(pipeline.pipeline_id, "ANALYZING", 0, "Crawling site");
		await stageRepo.complete(exec1.id, "Score: 71/100");
		await stageRepo.create(pipeline.pipeline_id, "CLONING", 0, "Creating clone");

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stages`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.length).toBe(2);
		expect(body[0].stage).toBe("ANALYZING");
		expect(body[0].status).toBe("completed");
		expect(body[0].result_summary).toBe("Score: 71/100");
		expect(body[1].stage).toBe("CLONING");
		expect(body[1].status).toBe("running");
	});

	it("does not include result_full in list response", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		const stageRepo = new StageExecutionRepository(db);
		const exec = await stageRepo.create(pipeline.pipeline_id, "ANALYZING", 0, "Test");
		await stageRepo.complete(exec.id, "Done", { full: "data" });

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stages`,
		);
		const body = await res.json();
		expect(body[0].result_full).toBeUndefined();
	});
});

// ══════════════════════════════════════════════════════════════
// GET /api/targets/:id/pipeline/:pipelineId/stages/:stageId
// ══════════════════════════════════════════════════════════════

describe("GET /api/targets/:id/pipeline/:pipelineId/stages/:stageId", () => {
	it("returns single stage with result_full", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		const stageRepo = new StageExecutionRepository(db);
		const exec = await stageRepo.create(pipeline.pipeline_id, "ANALYZING", 0, "Crawl");
		await stageRepo.complete(exec.id, "Score: 71", { score: 71, grade: "Needs Improvement" });

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stages/${exec.id}`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe(exec.id);
		expect(body.result_full).not.toBeNull();
	});

	it("returns 404 for non-existent stage", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		const res = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/stages/non-existent`,
		);
		expect(res.status).toBe(404);
	});
});

// ══════════════════════════════════════════════════════════════
// GET /api/targets/:id/cycle/status — includes stage info
// ══════════════════════════════════════════════════════════════

describe("GET /api/targets/:id/cycle/status — stage info", () => {
	it("includes current_prompt and stage_count from stage executions", async () => {
		const targetId = await getTargetId();
		await createPipeline(targetId);

		const stageRepo = new StageExecutionRepository(db);
		const statusRes1 = await app.request(`/api/targets/${targetId}/cycle/status`);
		const status1 = await statusRes1.json();
		const pipelineId = status1.pipeline_id;

		await stageRepo.create(pipelineId, "ANALYZING", 0, "Crawling example.com");

		const statusRes2 = await app.request(`/api/targets/${targetId}/cycle/status`);
		const status2 = await statusRes2.json();

		expect(status2.current_prompt).toBe("Crawling example.com");
		expect(status2.stage_count).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════
// LLM Integration: chatLLM dependency injection
// ══════════════════════════════════════════════════════════════

describe("LLM integration in pipeline execution", () => {
	it("pipeline starts successfully without LLM API key (rule-based mode)", async () => {
		// Default config has no API key set — should still start pipeline
		const targetId = await getTargetId();
		const res = await app.request(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.pipeline_id).toBeDefined();
		expect(body.stage).toBe("INIT");
	});

	it("pipeline creates DB record even when LLM is not configured", async () => {
		const targetId = await getTargetId();
		await app.request(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		// Verify pipeline was created in DB
		const listRes = await app.request(`/api/targets/${targetId}/pipeline`);
		const pipelines = await listRes.json();
		expect(pipelines.length).toBeGreaterThanOrEqual(1);
	});

	it("cycle/status returns completed_at field", async () => {
		const targetId = await getTargetId();
		const createRes = await createPipeline(targetId);
		const pipeline = await createRes.json();

		// Manually complete the pipeline for testing
		const { PipelineRepository } = await import("@geo-agent/core");
		const pipelineRepo = new PipelineRepository(db);
		await pipelineRepo.updateStage(pipeline.pipeline_id, "COMPLETED");

		const statusRes = await app.request(`/api/targets/${targetId}/cycle/status`);
		const status = await statusRes.json();
		expect(status.completed_at).not.toBeNull();
		expect(status.is_terminal).toBe(true);
	});

	it("LLM provider config is accessible from workspace", async () => {
		// Verify ProviderConfigManager can load from test workspace
		const { ProviderConfigManager } = await import("@geo-agent/core");
		const configManager = new ProviderConfigManager(testDir);
		const providers = configManager.loadAll();
		expect(Array.isArray(providers)).toBe(true);
		expect(providers.length).toBeGreaterThan(0);

		// Default state: OpenAI enabled but no API key
		const openai = providers.find((p: { provider_id: string }) => p.provider_id === "openai");
		expect(openai).toBeDefined();
		expect(openai!.enabled).toBe(true);
		expect(openai!.api_key).toBeUndefined();
	});

	it("LLM provider with API key makes chatLLM available", async () => {
		// Configure a provider with a fake API key
		const { ProviderConfigManager, GeoLLMClient } = await import("@geo-agent/core");
		const configManager = new ProviderConfigManager(testDir);
		const openai = configManager.load("openai");
		configManager.save({ ...openai, enabled: true, api_key: "sk-test-fake-key-12345" });

		// Verify enabled providers now have an API key
		const enabled = configManager.getEnabled();
		const withKey = enabled.filter((p: { api_key?: string }) => p.api_key);
		expect(withKey.length).toBeGreaterThan(0);

		// GeoLLMClient should be constructable
		const client = new GeoLLMClient(testDir);
		expect(client).toBeDefined();

		// Clean up — reset provider
		configManager.save({ ...openai, enabled: true, api_key: undefined });
	});

	it("GeoLLMClient.chat() throws when API key is invalid (not silently succeed)", async () => {
		const { ProviderConfigManager, GeoLLMClient } = await import("@geo-agent/core");
		const configManager = new ProviderConfigManager(testDir);
		const openai = configManager.load("openai");
		configManager.save({ ...openai, enabled: true, api_key: "sk-invalid-key" });

		const client = new GeoLLMClient(testDir);

		// chat() should throw an error (authentication failure, network error, etc.)
		await expect(client.chat({ prompt: "test", json_mode: false })).rejects.toThrow();

		// Clean up
		configManager.save({ ...openai, enabled: true, api_key: undefined });
	});

	it("GeoLLMClient.selectProvider() throws when no providers enabled", async () => {
		const { ProviderConfigManager, GeoLLMClient } = await import("@geo-agent/core");
		const configManager = new ProviderConfigManager(testDir);

		// Disable all providers
		const all = configManager.loadAll();
		for (const p of all) {
			configManager.save({ ...p, enabled: false });
		}

		const client = new GeoLLMClient(testDir);
		expect(() => client.selectProvider()).toThrow(/No LLM providers enabled/);

		// Restore defaults
		configManager.resetAll();
	});
});

describe("Evaluation API — synthetic_probes", () => {
	it("returns synthetic_probes field in evaluation response", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		// Manually insert stage execution with synthetic_probes in result_full
		const stageRepo = new StageExecutionRepository(db);
		const exec = await stageRepo.create(pipeline.pipeline_id, "ANALYZING", 0, "test prompt");
		const probeData = {
			score: 65,
			grade: "Needs Improvement",
			site_type: "manufacturer",
			dimensions: [{ id: "S1", label: "Crawl", score: 70 }],
			synthetic_probes: {
				probes: [
					{
						probe_id: "P-01",
						probe_name: "제품 스펙",
						category: "accuracy",
						query: "제품 스펙 알려줘",
						response: "Galaxy S25는 example.com에서 구매 가능합니다.",
						cited: true,
						accuracy: 0.65,
						verdict: "PASS",
						latency_ms: 120,
						model: "gpt-4o",
						provider: "openai",
					},
				],
				summary: {
					total: 1,
					pass: 1,
					partial: 0,
					fail: 0,
					citation_rate: 1.0,
					average_accuracy: 0.65,
				},
			},
		};
		await stageRepo.complete(exec.id, "Score: 65", probeData);

		// Query evaluation endpoint
		const evalRes = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/evaluation`,
		);
		expect(evalRes.status).toBe(200);

		const evalBody = await evalRes.json();
		expect(evalBody.synthetic_probes).toBeDefined();
		expect(evalBody.synthetic_probes.summary.total).toBe(1);
		expect(evalBody.synthetic_probes.summary.citation_rate).toBe(1.0);
		expect(evalBody.synthetic_probes.probes[0].probe_id).toBe("P-01");
	});

	it("returns null synthetic_probes when not available", async () => {
		const targetId = await getTargetId();
		const pRes = await createPipeline(targetId);
		const pipeline = await pRes.json();

		// Insert stage execution WITHOUT synthetic_probes
		const stageRepo = new StageExecutionRepository(db);
		const exec = await stageRepo.create(pipeline.pipeline_id, "ANALYZING", 0, "test");
		await stageRepo.complete(exec.id, "Score: 50", {
			score: 50,
			grade: "Needs Improvement",
			site_type: "generic",
			dimensions: [],
		});

		const evalRes = await app.request(
			`/api/targets/${targetId}/pipeline/${pipeline.pipeline_id}/evaluation`,
		);
		expect(evalRes.status).toBe(200);
		const evalBody = await evalRes.json();
		expect(evalBody.synthetic_probes).toBeNull();
	});
});
