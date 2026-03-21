import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
const testDir = path.join(os.tmpdir(), `geo-stage-exec-test-${Date.now()}`);
process.env.GEO_WORKSPACE = testDir;
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
const { createDatabase, loadSettings, ensureTables } = await import("@geo-agent/core");
const { StageExecutionRepository } = await import("./stage-execution-repository.js");
const settings = loadSettings();
const db = createDatabase(settings);
await ensureTables(db);
const repo = new StageExecutionRepository(db);
const FAKE_PIPELINE_ID = "pipeline-test-001";
afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore Windows cleanup
	}
});
beforeEach(async () => {
	// Clean stage_executions table
	const { createClient } = await import("@libsql/client");
	const dbPath = path.join(testDir, "data", "geo-agent.db");
	const client = createClient({ url: `file:${dbPath}` });
	await client.execute("DELETE FROM stage_executions");
	client.close();
});
describe("StageExecutionRepository", () => {
	describe("create()", () => {
		it("creates a stage execution with status=running", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "Crawling site");
			expect(exec.id).toBeDefined();
			expect(exec.pipeline_id).toBe(FAKE_PIPELINE_ID);
			expect(exec.stage).toBe("ANALYZING");
			expect(exec.cycle).toBe(0);
			expect(exec.status).toBe("running");
			expect(exec.prompt_summary).toBe("Crawling site");
			expect(exec.result_summary).toBe("");
			expect(exec.started_at).toBeDefined();
			expect(exec.completed_at).toBeNull();
			expect(exec.duration_ms).toBeNull();
		});
		it("truncates prompt_summary to 500 chars", async () => {
			const longPrompt = "x".repeat(600);
			const exec = await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, longPrompt);
			expect(exec.prompt_summary.length).toBe(500);
		});
	});
	describe("complete()", () => {
		it("sets status=completed with result and duration", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "Test");
			const completed = await repo.complete(exec.id, "Score: 71/100", { score: 71 });
			expect(completed).not.toBeNull();
			expect(completed.status).toBe("completed");
			expect(completed.result_summary).toBe("Score: 71/100");
			expect(completed.result_full).not.toBeNull();
			expect(JSON.parse(completed.result_full)).toEqual({ score: 71 });
			expect(completed.completed_at).toBeDefined();
			expect(completed.duration_ms).toBeGreaterThanOrEqual(0);
		});
		it("returns null for non-existent id", async () => {
			const result = await repo.complete("non-existent", "test");
			expect(result).toBeNull();
		});
		it("truncates result_summary to 500 chars", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "Test");
			const longResult = "r".repeat(600);
			const completed = await repo.complete(exec.id, longResult);
			expect(completed.result_summary.length).toBe(500);
		});
	});
	describe("fail()", () => {
		it("sets status=failed with error message and duration", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "OPTIMIZING", 1, "Applying tasks");
			const failed = await repo.fail(exec.id, "Network timeout");
			expect(failed).not.toBeNull();
			expect(failed.status).toBe("failed");
			expect(failed.error_message).toBe("Network timeout");
			expect(failed.completed_at).toBeDefined();
			expect(failed.duration_ms).toBeGreaterThanOrEqual(0);
		});
		it("returns null for non-existent id", async () => {
			const result = await repo.fail("non-existent", "error");
			expect(result).toBeNull();
		});
	});
	describe("findById()", () => {
		it("returns stage execution by id", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "CLONING", 0, "Creating clone");
			const found = await repo.findById(exec.id);
			expect(found).not.toBeNull();
			expect(found.id).toBe(exec.id);
			expect(found.stage).toBe("CLONING");
		});
		it("returns null for non-existent id", async () => {
			expect(await repo.findById("non-existent")).toBeNull();
		});
	});
	describe("findByPipelineId()", () => {
		it("returns stages ordered by started_at ascending", async () => {
			await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "Step 1");
			await repo.create(FAKE_PIPELINE_ID, "CLONING", 0, "Step 2");
			await repo.create(FAKE_PIPELINE_ID, "STRATEGIZING", 0, "Step 3");
			const stages = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			expect(stages.length).toBe(3);
			expect(stages[0].stage).toBe("ANALYZING");
			expect(stages[1].stage).toBe("CLONING");
			expect(stages[2].stage).toBe("STRATEGIZING");
		});
		it("returns empty array for unknown pipeline", async () => {
			const stages = await repo.findByPipelineId("unknown-pipeline");
			expect(stages).toEqual([]);
		});
		it("only returns stages for the specified pipeline", async () => {
			await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "A");
			await repo.create("other-pipeline", "ANALYZING", 0, "B");
			const stages = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			expect(stages.length).toBe(1);
			expect(stages[0].pipeline_id).toBe(FAKE_PIPELINE_ID);
		});
	});
	describe("cycle tracking", () => {
		it("stores and retrieves cycle number", async () => {
			const exec0 = await repo.create(FAKE_PIPELINE_ID, "STRATEGIZING", 0, "Cycle 0");
			const exec1 = await repo.create(FAKE_PIPELINE_ID, "STRATEGIZING", 1, "Cycle 1");
			const exec2 = await repo.create(FAKE_PIPELINE_ID, "STRATEGIZING", 2, "Cycle 2");
			expect(exec0.cycle).toBe(0);
			expect(exec1.cycle).toBe(1);
			expect(exec2.cycle).toBe(2);
			const all = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			expect(all.map((s) => s.cycle)).toEqual([0, 1, 2]);
		});
	});
	describe("deleteByPipelineId", () => {
		it("deletes all stages for a pipeline and returns count", async () => {
			await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "A");
			await repo.create(FAKE_PIPELINE_ID, "CLONING", 0, "B");
			await repo.create(FAKE_PIPELINE_ID, "STRATEGIZING", 0, "C");
			const deleted = await repo.deleteByPipelineId(FAKE_PIPELINE_ID);
			expect(deleted).toBe(3);
			const remaining = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			expect(remaining).toEqual([]);
		});
		it("returns 0 for unknown pipeline", async () => {
			const deleted = await repo.deleteByPipelineId("nonexistent");
			expect(deleted).toBe(0);
		});
		it("does not affect other pipelines", async () => {
			await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "A");
			await repo.create("other-pipeline", "ANALYZING", 0, "B");
			await repo.deleteByPipelineId(FAKE_PIPELINE_ID);
			const mine = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			const other = await repo.findByPipelineId("other-pipeline");
			expect(mine).toEqual([]);
			expect(other.length).toBe(1);
		});
	});
	describe("full lifecycle", () => {
		it("create → complete → findByPipelineId shows completed", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "ANALYZING", 0, "Crawling");
			await repo.complete(exec.id, "Done: 71/100", { score: 71 });
			const stages = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			expect(stages.length).toBe(1);
			expect(stages[0].status).toBe("completed");
			expect(stages[0].result_summary).toBe("Done: 71/100");
		});
		it("create → fail → findByPipelineId shows failed", async () => {
			const exec = await repo.create(FAKE_PIPELINE_ID, "OPTIMIZING", 0, "Applying");
			await repo.fail(exec.id, "Crash");
			const stages = await repo.findByPipelineId(FAKE_PIPELINE_ID);
			expect(stages.length).toBe(1);
			expect(stages[0].status).toBe("failed");
			expect(stages[0].error_message).toBe("Crash");
		});
	});
});
//# sourceMappingURL=stage-execution-repository.test.js.map
