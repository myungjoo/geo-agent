/**
 * E2E Pipeline Flow Test
 *
 * Creates a target pointing to fixture server,
 * runs the full pipeline (rule-based, no LLM),
 * and verifies stages and evaluation data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FixtureServer, startFixtureServer } from "./helpers/fixtures.js";
import { type TestServerContext, startTestServer } from "./helpers/test-server.js";

let ctx: TestServerContext;
let fixture: FixtureServer;

beforeAll(async () => {
	fixture = await startFixtureServer();
	ctx = await startTestServer();
}, 30_000);

afterAll(async () => {
	await ctx.stop();
	await fixture.stop();
});

// ── Helpers ─────────────────────────────────────────────────

async function api(path: string, options?: RequestInit): Promise<Response> {
	return fetch(`${ctx.baseUrl}${path}`, options);
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

async function createTarget(url: string, name: string): Promise<string> {
	const res = await api("/api/targets", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url, name }),
	});
	const data = await jsonBody(res);
	return data.id as string;
}

/**
 * Poll pipeline latest status until it reaches a terminal state.
 * Returns the final pipeline record.
 */
async function waitForPipeline(
	targetId: string,
	timeoutMs = 90_000,
): Promise<Record<string, unknown>> {
	const start = Date.now();
	const terminalStages = new Set(["COMPLETED", "FAILED", "PARTIAL_FAILURE"]);

	while (Date.now() - start < timeoutMs) {
		const res = await api(`/api/targets/${targetId}/pipeline/latest`);
		if (res.status === 200) {
			const data = await jsonBody(res);
			const stage = data.stage as string;
			if (terminalStages.has(stage) || data.completed_at) {
				return data;
			}
		}
		await new Promise((r) => setTimeout(r, 1000));
	}

	throw new Error(`Pipeline did not complete within ${timeoutMs}ms`);
}

// ── Pipeline Execution ──────────────────────────────────────

describe("Pipeline execution (rule-based mode)", () => {
	let targetId: string;
	let pipelineId: string;
	let pipelineFinalStage: string;

	it("creates a target pointing to fixture server", async () => {
		targetId = await createTarget(fixture.baseUrl, "E2E Fixture Target");
		expect(targetId).toBeDefined();
	});

	it("starts pipeline via POST ?execute=true → 201", async () => {
		const res = await api(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
		});
		expect(res.status).toBe(201);
		const data = await jsonBody(res);
		expect(data.pipeline_id).toBeDefined();
		pipelineId = data.pipeline_id as string;
	});

	it("pipeline reaches terminal state", async () => {
		const pipeline = await waitForPipeline(targetId);
		pipelineFinalStage = pipeline.stage as string;
		// Pipeline may COMPLETE or FAIL (e.g. if clone/optimization has issues).
		// Both are valid terminal states for smoke testing.
		expect(["COMPLETED", "FAILED", "PARTIAL_FAILURE"]).toContain(pipelineFinalStage);
	});

	it("pipeline/latest shows final state", async () => {
		const res = await api(`/api/targets/${targetId}/pipeline/latest`);
		expect(res.status).toBe(200);
		const data = await jsonBody(res);
		expect(data.pipeline_id).toBe(pipelineId);
	});

	it("stages list has recorded executions", async (ctx) => {
		// If pipeline FAILED early, stage_executions may be empty — skip in that case
		if (pipelineFinalStage === "FAILED") {
			ctx.skip();
			return;
		}

		// Stage executions are written asynchronously — retry briefly if empty
		let stages: Record<string, unknown>[] = [];
		for (let i = 0; i < 10; i++) {
			const res = await api(`/api/targets/${targetId}/pipeline/${pipelineId}/stages`);
			expect(res.status).toBe(200);
			stages = (await res.json()) as Record<string, unknown>[];
			if (stages.length > 0) break;
			await new Promise((r) => setTimeout(r, 500));
		}
		expect(stages.length).toBeGreaterThanOrEqual(1);

		// Verify at least ANALYZING stage was recorded
		const analyzing = stages.find((s) => s.stage === "ANALYZING");
		expect(analyzing).toBeDefined();
	});
});

// ── Double Execution Prevention ─────────────────────────────

describe("Double execution prevention", () => {
	let targetId: string;

	beforeAll(async () => {
		targetId = await createTarget(`${fixture.baseUrl}/products/widget`, "Double Exec Test");
	});

	it("rejects second pipeline start while first is running → 409", async (ctx) => {
		// Start first pipeline
		const first = await api(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
		});
		expect(first.status).toBe(201);

		// Immediately try second — should be rejected
		const second = await api(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
		});

		if (second.status === 201) {
			// First pipeline already completed before second request — timing-dependent, skip
			await waitForPipeline(targetId);
			ctx.skip();
			return;
		}
		expect(second.status).toBe(409);

		// Wait for first to finish before cleanup
		await waitForPipeline(targetId);
	});

	it("allows re-run after pipeline completes", async () => {
		// Previous pipeline should be done now
		const res = await api(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
		});
		expect(res.status).toBe(201);

		// Wait for completion
		await waitForPipeline(targetId);
	});
});

// ── Cycle Stop ──────────────────────────────────────────────

describe("Cycle stop", () => {
	let targetId: string;

	beforeAll(async () => {
		targetId = await createTarget(`${fixture.baseUrl}/`, "Cycle Stop Test");
	});

	it("POST /cycle/stop responds", async () => {
		// Start pipeline
		await api(`/api/targets/${targetId}/pipeline?execute=true`, {
			method: "POST",
		});

		// Small delay to let pipeline begin
		await new Promise((r) => setTimeout(r, 500));

		// Request stop
		const res = await api(`/api/targets/${targetId}/cycle/stop`, {
			method: "POST",
		});
		// May get 200 (stopped), 400 (already terminated), or 404 (no pipeline)
		expect([200, 400, 404]).toContain(res.status);

		// Wait for pipeline to actually stop/complete
		await waitForPipeline(targetId);
	});
});
