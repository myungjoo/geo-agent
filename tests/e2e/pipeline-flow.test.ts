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
	const terminalStages = new Set(["COMPLETED", "FAILED", "PARTIAL_FAILURE", "STOPPED"]);

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

/** Check if pipeline failure is due to missing LLM API key */
function isApiKeyError(pipeline: Record<string, unknown>): boolean {
	const msg = String(pipeline.error_message ?? "").toLowerCase();
	return (
		msg.includes("api key") ||
		msg.includes("api_key") ||
		msg.includes("no llm") ||
		msg.includes("설정되지") ||
		msg.includes("not configured")
	);
}

// ── Pipeline Execution ──────────────────────────────────────

describe("Pipeline execution (rule-based mode)", () => {
	let targetId: string;
	let pipelineId: string;
	let pipelineResult: Record<string, unknown>;

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

	it("pipeline reaches terminal state", async (testCtx) => {
		pipelineResult = await waitForPipeline(targetId);
		const stage = pipelineResult.stage as string;
		expect(["COMPLETED", "FAILED", "PARTIAL_FAILURE", "STOPPED"]).toContain(stage);

		if (stage === "FAILED" && isApiKeyError(pipelineResult)) {
			console.warn(
				`[E2E] Pipeline FAILED due to missing LLM API Key — skipping execution tests. Error: ${pipelineResult.error_message}`,
			);
			testCtx.skip();
			return;
		}

		if (stage === "FAILED") {
			// Non-API-key failure is a real bug — fail the test
			throw new Error(`Pipeline FAILED with unexpected error: ${pipelineResult.error_message}`);
		}
	});

	it("pipeline/latest shows final state", async (testCtx) => {
		if (pipelineResult?.stage === "FAILED" && isApiKeyError(pipelineResult)) {
			console.warn("[E2E] Skipped — no LLM API Key");
			testCtx.skip();
			return;
		}
		const res = await api(`/api/targets/${targetId}/pipeline/latest`);
		expect(res.status).toBe(200);
		const data = await jsonBody(res);
		expect(data.pipeline_id).toBe(pipelineId);
	});

	it("stages list has recorded executions", async (testCtx) => {
		if (pipelineResult?.stage === "FAILED" && isApiKeyError(pipelineResult)) {
			console.warn("[E2E] Skipped — no LLM API Key");
			testCtx.skip();
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

	it("rejects second pipeline start while first is running → 409", async (testCtx) => {
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
			testCtx.skip();
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
