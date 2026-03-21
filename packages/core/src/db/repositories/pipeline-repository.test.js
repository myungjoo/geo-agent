import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema.js";
import { PipelineRepository } from "./pipeline-repository.js";
const CREATE_TABLE_SQL = `
CREATE TABLE pipeline_runs (
	pipeline_id TEXT PRIMARY KEY,
	target_id TEXT NOT NULL,
	stage TEXT NOT NULL,
	started_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	analysis_report_ref TEXT,
	optimization_plan_ref TEXT,
	validation_report_ref TEXT,
	retry_count INTEGER NOT NULL DEFAULT 0,
	error_message TEXT,
	resumable INTEGER NOT NULL DEFAULT 0,
	resume_from_stage TEXT
);
`;
const FAKE_TARGET_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FAKE_TARGET_ID_2 = "11111111-2222-3333-4444-555555555555";
const NON_EXISTENT_ID = "00000000-0000-0000-0000-000000000000";
describe("PipelineRepository", () => {
	let repo;
	beforeEach(async () => {
		const client = createClient({ url: ":memory:" });
		await client.executeMultiple(CREATE_TABLE_SQL);
		const db = drizzle(client, { schema });
		repo = new PipelineRepository(db);
	});
	// ─── create ───────────────────────────────────────────────
	describe("create()", () => {
		it("1. creates a pipeline with INIT stage", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			expect(pipeline).toBeDefined();
			expect(pipeline.stage).toBe("INIT");
			expect(pipeline.target_id).toBe(FAKE_TARGET_ID);
		});
		it("2. generates a valid UUID for pipeline_id", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			expect(pipeline.pipeline_id).toBeDefined();
			expect(typeof pipeline.pipeline_id).toBe("string");
			expect(pipeline.pipeline_id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
			);
		});
		it("3. sets started_at and updated_at timestamps", async () => {
			const before = new Date().toISOString();
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const after = new Date().toISOString();
			expect(pipeline.started_at).toBeDefined();
			expect(pipeline.updated_at).toBeDefined();
			expect(pipeline.started_at).toBe(pipeline.updated_at);
			expect(pipeline.started_at >= before).toBe(true);
			expect(pipeline.started_at <= after).toBe(true);
		});
		it("4. initializes with null refs and zero retry_count", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			expect(pipeline.completed_at).toBeNull();
			expect(pipeline.analysis_report_ref).toBeNull();
			expect(pipeline.optimization_plan_ref).toBeNull();
			expect(pipeline.validation_report_ref).toBeNull();
			expect(pipeline.retry_count).toBe(0);
			expect(pipeline.error_message).toBeNull();
			expect(pipeline.resumable).toBe(false);
			expect(pipeline.resume_from_stage).toBeNull();
		});
		it("5. creates multiple pipelines for the same target", async () => {
			const p1 = await repo.create(FAKE_TARGET_ID);
			const p2 = await repo.create(FAKE_TARGET_ID);
			expect(p1.pipeline_id).not.toBe(p2.pipeline_id);
			expect(p1.target_id).toBe(p2.target_id);
		});
	});
	// ─── findById ─────────────────────────────────────────────
	describe("findById()", () => {
		it("6. returns pipeline when found", async () => {
			const created = await repo.create(FAKE_TARGET_ID);
			const found = await repo.findById(created.pipeline_id);
			expect(found).not.toBeNull();
			expect(found.pipeline_id).toBe(created.pipeline_id);
			expect(found.target_id).toBe(FAKE_TARGET_ID);
			expect(found.stage).toBe("INIT");
		});
		it("7. returns null for non-existent pipeline_id", async () => {
			const result = await repo.findById(NON_EXISTENT_ID);
			expect(result).toBeNull();
		});
		it("8. returns null for empty string ID", async () => {
			const result = await repo.findById("");
			expect(result).toBeNull();
		});
	});
	// ─── findByTargetId ──────────────────────────────────────
	describe("findByTargetId()", () => {
		it("9. returns empty array when no pipelines exist for target", async () => {
			const result = await repo.findByTargetId(NON_EXISTENT_ID);
			expect(result).toEqual([]);
		});
		it("10. returns all pipelines for a target", async () => {
			await repo.create(FAKE_TARGET_ID);
			await repo.create(FAKE_TARGET_ID);
			await repo.create(FAKE_TARGET_ID);
			const result = await repo.findByTargetId(FAKE_TARGET_ID);
			expect(result).toHaveLength(3);
			for (const p of result) {
				expect(p.target_id).toBe(FAKE_TARGET_ID);
			}
		});
		it("11. returns only pipelines for the specified target", async () => {
			await repo.create(FAKE_TARGET_ID);
			await repo.create(FAKE_TARGET_ID_2);
			await repo.create(FAKE_TARGET_ID);
			const result = await repo.findByTargetId(FAKE_TARGET_ID);
			expect(result).toHaveLength(2);
			for (const p of result) {
				expect(p.target_id).toBe(FAKE_TARGET_ID);
			}
		});
		it("12. returns pipelines ordered by started_at descending (newest first)", async () => {
			const p1 = await repo.create(FAKE_TARGET_ID);
			await new Promise((resolve) => setTimeout(resolve, 15));
			const p2 = await repo.create(FAKE_TARGET_ID);
			await new Promise((resolve) => setTimeout(resolve, 15));
			const p3 = await repo.create(FAKE_TARGET_ID);
			const result = await repo.findByTargetId(FAKE_TARGET_ID);
			expect(result).toHaveLength(3);
			// newest first
			expect(result[0].pipeline_id).toBe(p3.pipeline_id);
			expect(result[1].pipeline_id).toBe(p2.pipeline_id);
			expect(result[2].pipeline_id).toBe(p1.pipeline_id);
		});
	});
	// ─── findLatestByTargetId ────────────────────────────────
	describe("findLatestByTargetId()", () => {
		it("13. returns null when no pipelines exist for target", async () => {
			const result = await repo.findLatestByTargetId(NON_EXISTENT_ID);
			expect(result).toBeNull();
		});
		it("14. returns the latest (most recent) pipeline", async () => {
			await repo.create(FAKE_TARGET_ID);
			await new Promise((r) => setTimeout(r, 10)); // ensure different started_at (KI-002)
			await repo.create(FAKE_TARGET_ID);
			await new Promise((r) => setTimeout(r, 10));
			const latest = await repo.create(FAKE_TARGET_ID);
			const result = await repo.findLatestByTargetId(FAKE_TARGET_ID);
			expect(result).not.toBeNull();
			expect(result.pipeline_id).toBe(latest.pipeline_id);
		});
		it("15. does not return pipelines from other targets", async () => {
			await repo.create(FAKE_TARGET_ID_2);
			const result = await repo.findLatestByTargetId(FAKE_TARGET_ID);
			expect(result).toBeNull();
		});
	});
	// ─── updateStage ─────────────────────────────────────────
	describe("updateStage()", () => {
		it("16. updates stage from INIT to ANALYZING", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const updated = await repo.updateStage(pipeline.pipeline_id, "ANALYZING");
			expect(updated).not.toBeNull();
			expect(updated.stage).toBe("ANALYZING");
		});
		it("17. updates updated_at on stage change", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const updated = await repo.updateStage(pipeline.pipeline_id, "CLONING");
			expect(updated.updated_at).not.toBe(pipeline.updated_at);
			expect(updated.updated_at > pipeline.updated_at).toBe(true);
		});
		it("18. does NOT set completed_at for non-terminal stages", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const stages = [
				"ANALYZING",
				"CLONING",
				"STRATEGIZING",
				"OPTIMIZING",
				"VALIDATING",
				"REPORTING",
			];
			for (const stage of stages) {
				const updated = await repo.updateStage(pipeline.pipeline_id, stage);
				expect(updated.completed_at).toBeNull();
			}
		});
		it("19. sets completed_at when stage is COMPLETED", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const updated = await repo.updateStage(pipeline.pipeline_id, "COMPLETED");
			expect(updated.completed_at).not.toBeNull();
			expect(typeof updated.completed_at).toBe("string");
		});
		it("20. sets completed_at when stage is FAILED", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const updated = await repo.updateStage(pipeline.pipeline_id, "FAILED");
			expect(updated.completed_at).not.toBeNull();
			expect(updated.stage).toBe("FAILED");
		});
		it("21. sets completed_at when stage is PARTIAL_FAILURE", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const updated = await repo.updateStage(pipeline.pipeline_id, "PARTIAL_FAILURE");
			expect(updated.completed_at).not.toBeNull();
			expect(updated.stage).toBe("PARTIAL_FAILURE");
		});
		it("22. returns null for non-existent pipeline", async () => {
			const result = await repo.updateStage(NON_EXISTENT_ID, "ANALYZING");
			expect(result).toBeNull();
		});
		it("23. supports transition through full pipeline lifecycle", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const stages = [
				"ANALYZING",
				"CLONING",
				"STRATEGIZING",
				"OPTIMIZING",
				"VALIDATING",
				"REPORTING",
				"COMPLETED",
			];
			let current = pipeline;
			for (const stage of stages) {
				const updated = await repo.updateStage(current.pipeline_id, stage);
				expect(updated.stage).toBe(stage);
				current = updated;
			}
			expect(current.completed_at).not.toBeNull();
		});
	});
	// ─── updateRefs ──────────────────────────────────────────
	describe("updateRefs()", () => {
		it("24. updates analysis_report_ref", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const refId = "ref-analysis-001";
			const updated = await repo.updateRefs(pipeline.pipeline_id, {
				analysis_report_ref: refId,
			});
			expect(updated).not.toBeNull();
			expect(updated.analysis_report_ref).toBe(refId);
			expect(updated.optimization_plan_ref).toBeNull();
			expect(updated.validation_report_ref).toBeNull();
		});
		it("25. updates optimization_plan_ref", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const refId = "ref-optplan-002";
			const updated = await repo.updateRefs(pipeline.pipeline_id, {
				optimization_plan_ref: refId,
			});
			expect(updated.optimization_plan_ref).toBe(refId);
		});
		it("26. updates validation_report_ref", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const refId = "ref-validation-003";
			const updated = await repo.updateRefs(pipeline.pipeline_id, {
				validation_report_ref: refId,
			});
			expect(updated.validation_report_ref).toBe(refId);
		});
		it("27. updates all three refs at once", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const updated = await repo.updateRefs(pipeline.pipeline_id, {
				analysis_report_ref: "a-ref",
				optimization_plan_ref: "o-ref",
				validation_report_ref: "v-ref",
			});
			expect(updated.analysis_report_ref).toBe("a-ref");
			expect(updated.optimization_plan_ref).toBe("o-ref");
			expect(updated.validation_report_ref).toBe("v-ref");
		});
		it("28. partial ref update does not overwrite other refs", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await repo.updateRefs(pipeline.pipeline_id, {
				analysis_report_ref: "first-ref",
			});
			const updated = await repo.updateRefs(pipeline.pipeline_id, {
				optimization_plan_ref: "second-ref",
			});
			expect(updated.analysis_report_ref).toBe("first-ref");
			expect(updated.optimization_plan_ref).toBe("second-ref");
		});
		it("29. updates updated_at on ref change", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const updated = await repo.updateRefs(pipeline.pipeline_id, {
				analysis_report_ref: "some-ref",
			});
			expect(updated.updated_at > pipeline.updated_at).toBe(true);
		});
		it("30. returns null for non-existent pipeline", async () => {
			const result = await repo.updateRefs(NON_EXISTENT_ID, {
				analysis_report_ref: "ref",
			});
			expect(result).toBeNull();
		});
	});
	// ─── setError ────────────────────────────────────────────
	describe("setError()", () => {
		it("31. sets error message and marks as FAILED", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await repo.updateStage(pipeline.pipeline_id, "OPTIMIZING");
			const errored = await repo.setError(pipeline.pipeline_id, "Something went wrong");
			expect(errored).not.toBeNull();
			expect(errored.stage).toBe("FAILED");
			expect(errored.error_message).toBe("Something went wrong");
			expect(errored.completed_at).not.toBeNull();
		});
		it("32. defaults resumable to false", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const errored = await repo.setError(pipeline.pipeline_id, "Non-resumable error");
			expect(errored.resumable).toBe(false);
			expect(errored.resume_from_stage).toBeNull();
		});
		it("33. sets resumable=true and saves resume_from_stage", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await repo.updateStage(pipeline.pipeline_id, "VALIDATING");
			const errored = await repo.setError(pipeline.pipeline_id, "Recoverable error", true);
			expect(errored.resumable).toBe(true);
			expect(errored.resume_from_stage).toBe("VALIDATING");
			expect(errored.stage).toBe("FAILED");
		});
		it("34. resume_from_stage reflects the stage before error", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await repo.updateStage(pipeline.pipeline_id, "STRATEGIZING");
			const errored = await repo.setError(pipeline.pipeline_id, "Error at strategizing", true);
			expect(errored.resume_from_stage).toBe("STRATEGIZING");
		});
		it("35. returns null for non-existent pipeline", async () => {
			const result = await repo.setError(NON_EXISTENT_ID, "error");
			expect(result).toBeNull();
		});
		it("36. sets completed_at timestamp", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const errored = await repo.setError(pipeline.pipeline_id, "fail");
			expect(errored.completed_at).not.toBeNull();
			expect(typeof errored.completed_at).toBe("string");
		});
	});
	// ─── incrementRetry ──────────────────────────────────────
	describe("incrementRetry()", () => {
		it("37. returns 1 after first increment", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const count = await repo.incrementRetry(pipeline.pipeline_id);
			expect(count).toBe(1);
		});
		it("38. increments sequentially on multiple calls", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			expect(await repo.incrementRetry(pipeline.pipeline_id)).toBe(1);
			expect(await repo.incrementRetry(pipeline.pipeline_id)).toBe(2);
			expect(await repo.incrementRetry(pipeline.pipeline_id)).toBe(3);
		});
		it("39. returns -1 for non-existent pipeline", async () => {
			const count = await repo.incrementRetry(NON_EXISTENT_ID);
			expect(count).toBe(-1);
		});
		it("40. persists incremented count in DB", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await repo.incrementRetry(pipeline.pipeline_id);
			await repo.incrementRetry(pipeline.pipeline_id);
			const found = await repo.findById(pipeline.pipeline_id);
			expect(found.retry_count).toBe(2);
		});
		it("41. updates updated_at on increment", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await new Promise((resolve) => setTimeout(resolve, 10));
			await repo.incrementRetry(pipeline.pipeline_id);
			const found = await repo.findById(pipeline.pipeline_id);
			expect(found.updated_at > pipeline.updated_at).toBe(true);
		});
	});
	describe("deleteById()", () => {
		it("deletes existing pipeline and returns true", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			const result = await repo.deleteById(pipeline.pipeline_id);
			expect(result).toBe(true);
			const found = await repo.findById(pipeline.pipeline_id);
			expect(found).toBeNull();
		});
		it("returns false for nonexistent pipeline", async () => {
			const result = await repo.deleteById("nonexistent-id");
			expect(result).toBe(false);
		});
		it("does not affect other pipelines", async () => {
			const p1 = await repo.create(FAKE_TARGET_ID);
			const p2 = await repo.create(FAKE_TARGET_ID);
			await repo.deleteById(p1.pipeline_id);
			expect(await repo.findById(p1.pipeline_id)).toBeNull();
			expect(await repo.findById(p2.pipeline_id)).not.toBeNull();
		});
	});
	// ─── Integration / Edge Cases ────────────────────────────
	describe("Integration", () => {
		it("42. full pipeline lifecycle: create -> stages -> refs -> complete", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			expect(pipeline.stage).toBe("INIT");
			await repo.updateStage(pipeline.pipeline_id, "ANALYZING");
			await repo.updateRefs(pipeline.pipeline_id, { analysis_report_ref: "report-1" });
			await repo.updateStage(pipeline.pipeline_id, "CLONING");
			await repo.updateStage(pipeline.pipeline_id, "STRATEGIZING");
			await repo.updateRefs(pipeline.pipeline_id, { optimization_plan_ref: "plan-1" });
			await repo.updateStage(pipeline.pipeline_id, "OPTIMIZING");
			await repo.updateStage(pipeline.pipeline_id, "VALIDATING");
			await repo.updateRefs(pipeline.pipeline_id, { validation_report_ref: "val-1" });
			await repo.updateStage(pipeline.pipeline_id, "REPORTING");
			const completed = await repo.updateStage(pipeline.pipeline_id, "COMPLETED");
			expect(completed.stage).toBe("COMPLETED");
			expect(completed.completed_at).not.toBeNull();
			expect(completed.analysis_report_ref).toBe("report-1");
			expect(completed.optimization_plan_ref).toBe("plan-1");
			expect(completed.validation_report_ref).toBe("val-1");
		});
		it("43. error recovery lifecycle: create -> error -> retry", async () => {
			const pipeline = await repo.create(FAKE_TARGET_ID);
			await repo.updateStage(pipeline.pipeline_id, "OPTIMIZING");
			await repo.setError(pipeline.pipeline_id, "Transient failure", true);
			const errored = await repo.findById(pipeline.pipeline_id);
			expect(errored.stage).toBe("FAILED");
			expect(errored.resumable).toBe(true);
			expect(errored.resume_from_stage).toBe("OPTIMIZING");
			const retryCount = await repo.incrementRetry(pipeline.pipeline_id);
			expect(retryCount).toBe(1);
		});
		it("44. multiple pipelines for same target are independent", async () => {
			const p1 = await repo.create(FAKE_TARGET_ID);
			const p2 = await repo.create(FAKE_TARGET_ID);
			await repo.updateStage(p1.pipeline_id, "COMPLETED");
			await repo.setError(p2.pipeline_id, "Failed");
			const found1 = await repo.findById(p1.pipeline_id);
			const found2 = await repo.findById(p2.pipeline_id);
			expect(found1.stage).toBe("COMPLETED");
			expect(found2.stage).toBe("FAILED");
		});
		it("45. findLatestByTargetId returns the correct one after multiple creates", async () => {
			const p1 = await repo.create(FAKE_TARGET_ID);
			await repo.updateStage(p1.pipeline_id, "COMPLETED");
			await new Promise((resolve) => setTimeout(resolve, 15));
			const p2 = await repo.create(FAKE_TARGET_ID);
			const latest = await repo.findLatestByTargetId(FAKE_TARGET_ID);
			expect(latest.pipeline_id).toBe(p2.pipeline_id);
			expect(latest.stage).toBe("INIT");
		});
	});
});
//# sourceMappingURL=pipeline-repository.test.js.map
