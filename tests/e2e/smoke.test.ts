/**
 * E2E Smoke Test — Server + API Endpoints
 *
 * Starts a real HTTP server with dynamic port allocation
 * and verifies all API endpoints via actual HTTP requests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestServerContext, startTestServer } from "./helpers/test-server.js";

let ctx: TestServerContext;

beforeAll(async () => {
	ctx = await startTestServer();
});

afterAll(async () => {
	await ctx.stop();
});

// ── Helper ──────────────────────────────────────────────────

async function api(path: string, options?: RequestInit): Promise<Response> {
	return fetch(`${ctx.baseUrl}${path}`, options);
}

async function jsonBody(res: Response): Promise<unknown> {
	return res.json();
}

function jsonHeaders(body?: unknown): RequestInit {
	return {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

// ── Server Basics ───────────────────────────────────────────

describe("Server basics", () => {
	it("GET / returns API info", async () => {
		const res = await api("/");
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.name).toBe("GEO Agent Dashboard");
		expect(data.version).toBeDefined();
		expect(data.endpoints).toBeInstanceOf(Array);
	});

	it("GET /health returns ok", async () => {
		const res = await api("/health");
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.status).toBe("ok");
		expect(data.timestamp).toBeDefined();
	});

	it("GET /dashboard returns HTML", async () => {
		const res = await api("/dashboard");
		expect(res.status).toBe(200);
		const ct = res.headers.get("content-type") ?? "";
		expect(ct).toContain("text/html");
	});
});

// ── Target CRUD ─────────────────────────────────────────────

describe("Target CRUD", () => {
	let targetId: string;

	it("POST /api/targets with valid body → 201", async () => {
		const res = await api(
			"/api/targets",
			jsonHeaders({ url: "https://example.com", name: "Smoke Test Target" }),
		);
		expect(res.status).toBe(201);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.id).toBeDefined();
		expect(data.url).toBe("https://example.com");
		expect(data.name).toBe("Smoke Test Target");
		targetId = data.id as string;
	});

	it("POST /api/targets with missing url → 400", async () => {
		const res = await api("/api/targets", jsonHeaders({ name: "No URL" }));
		expect(res.status).toBe(400);
	});

	it("POST /api/targets with invalid JSON → 400", async () => {
		const res = await api("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{invalid json!!!",
		});
		expect(res.status).toBe(400);
	});

	it("GET /api/targets → 200 + array", async () => {
		const res = await api("/api/targets");
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as unknown[];
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBeGreaterThanOrEqual(1);
	});

	it("GET /api/targets/:id → 200", async () => {
		const res = await api(`/api/targets/${targetId}`);
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.id).toBe(targetId);
	});

	it("GET /api/targets/:nonexistent → 404", async () => {
		const res = await api("/api/targets/nonexistent-id-12345");
		expect(res.status).toBe(404);
	});

	it("PUT /api/targets/:id → 200", async () => {
		const res = await api(`/api/targets/${targetId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated Name" }),
		});
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.name).toBe("Updated Name");
	});

	it("PUT /api/targets/:nonexistent → 404", async () => {
		const res = await api("/api/targets/nonexistent-id-12345", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Nope" }),
		});
		expect(res.status).toBe(404);
	});

	it("DELETE /api/targets/:id → 200", async () => {
		const res = await api(`/api/targets/${targetId}`, { method: "DELETE" });
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.deleted).toBe(true);
	});

	it("DELETE /api/targets/:nonexistent → 404", async () => {
		const res = await api("/api/targets/nonexistent-id-12345", { method: "DELETE" });
		expect(res.status).toBe(404);
	});
});

// ── Pipeline CRUD (no execution) ────────────────────────────

describe("Pipeline CRUD (no execution)", () => {
	let targetId: string;
	let pipelineId: string;

	beforeAll(async () => {
		const res = await api(
			"/api/targets",
			jsonHeaders({ url: "https://pipeline-test.com", name: "Pipeline Test" }),
		);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		targetId = data.id as string;
	});

	it("POST /api/targets/:id/pipeline → 201", async () => {
		const res = await api(`/api/targets/${targetId}/pipeline`, { method: "POST" });
		expect(res.status).toBe(201);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.pipeline_id).toBeDefined();
		pipelineId = data.pipeline_id as string;
	});

	it("GET /api/targets/:id/pipeline → 200 + array", async () => {
		const res = await api(`/api/targets/${targetId}/pipeline`);
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as unknown[];
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBeGreaterThanOrEqual(1);
	});

	it("GET /api/targets/:id/pipeline/latest → 200", async () => {
		const res = await api(`/api/targets/${targetId}/pipeline/latest`);
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>;
		expect(data.pipeline_id).toBe(pipelineId);
	});

	it("DELETE /api/targets/:id/pipeline/:pid → 200", async () => {
		const res = await api(`/api/targets/${targetId}/pipeline/${pipelineId}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
	});
});

// ── Settings API ────────────────────────────────────────────

describe("Settings API", () => {
	it("GET /api/settings/agents/prompts → 200 + 5 runtime prompts", async () => {
		const res = await api("/api/settings/agents/prompts");
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as Record<string, unknown>[];
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBe(5);
	});

	it("GET /api/settings/llm-providers → 200", async () => {
		const res = await api("/api/settings/llm-providers");
		expect(res.status).toBe(200);
		const data = (await jsonBody(res)) as unknown[];
		expect(Array.isArray(data)).toBe(true);
	});
});

// ── Trailing slash ──────────────────────────────────────────

describe("Middleware", () => {
	it("trailing slash is handled (redirect or direct response)", async () => {
		const res = await api("/api/targets/", { redirect: "manual" });
		// trimTrailingSlash sends 301 redirect
		expect([200, 301]).toContain(res.status);
	});
});
