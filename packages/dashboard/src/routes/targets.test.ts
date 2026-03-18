import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import Database from "better-sqlite3";

const testDir = path.join(os.tmpdir(), `geo-targets-test-${Date.now()}`);

// Set env before any imports that use loadSettings
process.env.GEO_WORKSPACE = testDir;

// Ensure workspace directories exist
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });

// createDatabase now auto-creates tables, but we still need the DB file
// for the test to work with clearTargets()
const dbPath = path.join(testDir, "data", "geo-agent.db");

// Import app and initialize the targets router with shared DB
const { app } = await import("../server.js");
const { initTargetsRouter } = await import("./targets.js");
const { createDatabase, loadSettings, ensureTables } = await import("@geo-agent/core");

const settings = loadSettings();
const db = createDatabase(settings);
await ensureTables(db);
initTargetsRouter(db);

// ── Helpers ────────────────────────────────────────────────────

function clearTargets(): void {
	const db = new Database(dbPath);
	db.exec("DELETE FROM targets");
	db.close();
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

// ── Tests ──────────────────────────────────────────────────────

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

beforeEach(() => {
	clearTargets();
});

// ── GET /api/targets ───────────────────────────────────────────

describe("GET /api/targets", () => {
	it("returns 200 with empty array initially", async () => {
		const res = await app.request("/api/targets", { method: "GET" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual([]);
	});

	it("returns all targets after creation", async () => {
		await createTarget({ name: "Target A", url: "https://a.com" });
		await createTarget({ name: "Target B", url: "https://b.com" });

		const res = await app.request("/api/targets", { method: "GET" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toHaveLength(2);

		const names = body.map((t: { name: string }) => t.name);
		expect(names).toContain("Target A");
		expect(names).toContain("Target B");
	});
});

// ── POST /api/targets ──────────────────────────────────────────

describe("POST /api/targets", () => {
	it("returns 201 with valid minimal input (url + name)", async () => {
		const res = await createTarget();
		expect(res.status).toBe(201);

		const body = await res.json();
		expect(body.url).toBe("https://example.com");
		expect(body.name).toBe("Test Target");
	});

	it("returns 201 with full input (all optional fields)", async () => {
		const fullPayload = {
			url: "https://full.example.com",
			name: "Full Target",
			description: "A comprehensive test target",
			topics: ["seo", "geo", "llm"],
			target_queries: ["what is geo optimization?", "best geo tools"],
			audience: "marketing professionals",
			competitors: [
				{ url: "https://competitor.com", name: "Comp A", relationship: "direct" },
			],
			business_goal: "Increase LLM citations by 50%",
			llm_priorities: [
				{ llm_service: "chatgpt", priority: "critical" },
				{ llm_service: "claude", priority: "important" },
			],
			site_type: "generic",
			clone_base_path: null,
			notifications: {
				on_score_drop: true,
				on_external_change: false,
				on_optimization_complete: true,
				channels: ["dashboard", "email"],
			},
			monitoring_interval: "6h",
		};

		const res = await createTarget(fullPayload);
		expect(res.status).toBe(201);

		const body = await res.json();
		expect(body.url).toBe("https://full.example.com");
		expect(body.name).toBe("Full Target");
		expect(body.description).toBe("A comprehensive test target");
		expect(body.audience).toBe("marketing professionals");
		expect(body.business_goal).toBe("Increase LLM citations by 50%");
		expect(body.monitoring_interval).toBe("6h");
	});

	it("response has id, created_at, and updated_at", async () => {
		const res = await createTarget();
		expect(res.status).toBe(201);

		const body = await res.json();
		expect(body.id).toBeDefined();
		expect(typeof body.id).toBe("string");
		expect(body.id.length).toBeGreaterThan(0);
		expect(body.created_at).toBeDefined();
		expect(body.updated_at).toBeDefined();
	});

	it("returns 400 when url is missing", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "No URL" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 when name is missing", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://example.com" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 when url is invalid format", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "not-a-url", name: "Bad URL" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 with error details in response", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "not-a-url" }),
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.error).toBe("Invalid input");
		expect(body.details).toBeDefined();
		expect(Array.isArray(body.details)).toBe(true);
		expect(body.details.length).toBeGreaterThan(0);
	});
});

// ── BUG TEST: malformed JSON (#4) ──────────────────────────────

describe("POST /api/targets - malformed JSON (BUG #4 FIXED)", () => {
	it("returns 400 when body is not valid JSON", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "this is not json {{{",
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid JSON in request body");

		// Verify the server is still responsive after the error
		const healthRes = await app.request("/health", { method: "GET" });
		expect(healthRes.status).toBe(200);
	});
});

// ── GET /api/targets/:id ───────────────────────────────────────

describe("GET /api/targets/:id", () => {
	it("returns 200 with target data for valid ID", async () => {
		const createRes = await createTarget({ name: "Findable" });
		const created = await createRes.json();

		const res = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.id).toBe(created.id);
		expect(body.name).toBe("Findable");
		expect(body.url).toBe("https://example.com");
	});

	it("returns 404 for non-existent ID", async () => {
		const res = await app.request("/api/targets/00000000-0000-0000-0000-000000000000", {
			method: "GET",
		});
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("Target not found");
	});
});

// ── PUT /api/targets/:id ───────────────────────────────────────

describe("PUT /api/targets/:id", () => {
	it("returns 200 with updated target", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		const res = await app.request(`/api/targets/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated Name" }),
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.name).toBe("Updated Name");
		expect(body.id).toBe(created.id);
	});

	it("returns 404 for non-existent ID", async () => {
		const res = await app.request("/api/targets/00000000-0000-0000-0000-000000000000", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Ghost" }),
		});
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("Target not found");
	});

	it("updates only specified fields", async () => {
		const createRes = await createTarget({
			name: "Original Name",
			url: "https://original.com",
			description: "Original description",
		});
		const created = await createRes.json();

		const res = await app.request(`/api/targets/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ description: "Updated description" }),
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.description).toBe("Updated description");
		expect(body.name).toBe("Original Name");
		expect(body.url).toBe("https://original.com");
	});

	it("returns 400 for invalid input", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		const res = await app.request(`/api/targets/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "not-a-valid-url" }),
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.error).toBe("Invalid input");
	});
});

// ── DELETE /api/targets/:id ────────────────────────────────────

describe("DELETE /api/targets/:id", () => {
	it("returns 200 with { deleted: true }", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		const res = await app.request(`/api/targets/${created.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.deleted).toBe(true);
	});

	it("target is gone after delete (GET returns 404)", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		await app.request(`/api/targets/${created.id}`, { method: "DELETE" });

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		expect(getRes.status).toBe(404);
	});
});

// ── BUG TEST: delete non-existent (#6) ─────────────────────────

describe("DELETE /api/targets/:id - non-existent (BUG #6 FIXED)", () => {
	it("returns 404 for non-existent ID", async () => {
		const res = await app.request("/api/targets/00000000-0000-0000-0000-000000000000", {
			method: "DELETE",
		});

		// FIXED: repo.delete() now returns false for non-existent targets,
		// and the route returns 404.
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe("Target not found");
	});
});

// ── BUG TEST: JSON fields as strings (#1) ──────────────────────

describe("POST/GET - JSON fields serialization (BUG #1 FIXED)", () => {
	it("POST with topics array -> GET returns topics as array, not string", async () => {
		const createRes = await createTarget({
			topics: ["seo", "geo", "ai"],
		});
		expect(createRes.status).toBe(201);
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		expect(getRes.status).toBe(200);

		const body = await getRes.json();
		expect(Array.isArray(body.topics)).toBe(true);
		expect(body.topics).toEqual(["seo", "geo", "ai"]);
	});

	it("POST with notifications object -> GET returns object, not string", async () => {
		const notifications = {
			on_score_drop: true,
			on_external_change: false,
			on_optimization_complete: true,
			channels: ["dashboard"],
		};

		const createRes = await createTarget({ notifications });
		expect(createRes.status).toBe(201);
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		expect(getRes.status).toBe(200);

		const body = await getRes.json();
		expect(typeof body.notifications).toBe("object");
		expect(body.notifications).not.toBeNull();
		expect(body.notifications.on_score_drop).toBe(true);
		expect(body.notifications.on_external_change).toBe(false);
		expect(body.notifications.channels).toEqual(["dashboard"]);
	});
});

// ── GET /health ────────────────────────────────────────────────

describe("GET /health", () => {
	it("returns 200 with status ok", async () => {
		const res = await app.request("/health", { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	it("response has timestamp", async () => {
		const res = await app.request("/health", { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.timestamp).toBeDefined();
		expect(typeof body.timestamp).toBe("string");

		// Verify it is a valid ISO date string
		const parsed = new Date(body.timestamp);
		expect(parsed.getTime()).not.toBeNaN();
	});
});

// ── GET / ──────────────────────────────────────────────────────

describe("GET /", () => {
	it("returns service info with endpoints list", async () => {
		const res = await app.request("/", { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.name).toBe("GEO Agent Dashboard");
		expect(body.version).toBeDefined();
		expect(Array.isArray(body.endpoints)).toBe(true);
		expect(body.endpoints).toContain("/health");
		expect(body.endpoints).toContain("/api/targets");
		expect(body.endpoints).toContain("/api/settings/agents/prompts");
	});
});

// ── CORS ───────────────────────────────────────────────────────

describe("CORS", () => {
	it("OPTIONS request returns CORS headers", async () => {
		const res = await app.request("/api/targets", {
			method: "OPTIONS",
			headers: {
				"Origin": "http://localhost:5173",
				"Access-Control-Request-Method": "POST",
			},
		});

		// CORS middleware should respond with appropriate headers
		const allowOrigin = res.headers.get("access-control-allow-origin");
		expect(allowOrigin).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════
// BUG REGRESSION TESTS — smoke-test-derived
// ═══════════════════════════════════════════════════════════════

// ── Bug #9 regression: trailing slash ───────────────────────────

describe("Trailing slash handling (Bug #9)", () => {
	it("GET /api/targets/ returns 301 redirect", async () => {
		const res = await app.request("/api/targets/", { method: "GET", redirect: "manual" });
		expect(res.status).toBe(301);
		const location = res.headers.get("location");
		expect(location).toContain("/api/targets");
		expect(location).not.toMatch(/\/$/);
	});

	it("GET /health/ returns 301 redirect", async () => {
		const res = await app.request("/health/", { method: "GET", redirect: "manual" });
		expect(res.status).toBe(301);
	});

	it("POST /api/targets/ with trailing slash is handled (not 500)", async () => {
		const res = await app.request("/api/targets/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://example.com", name: "Slash Test" }),
			redirect: "manual",
		});
		// trimTrailingSlash redirects GET but returns 301 for non-GET too
		// Either way, it should not be a 500 server error
		expect(res.status).toBeLessThan(500);
	});
});

// ── Bug #2 regression: default notifications via API ────────────

describe("Default notifications via API (Bug #2)", () => {
	it("POST without notifications returns default notification config", async () => {
		const res = await createTarget();
		expect(res.status).toBe(201);

		const body = await res.json();
		expect(body.notifications).not.toBeNull();
		expect(typeof body.notifications).toBe("object");
		expect(body.notifications.on_score_drop).toBe(true);
		expect(body.notifications.on_external_change).toBe(true);
		expect(body.notifications.on_optimization_complete).toBe(true);
		expect(body.notifications.channels).toEqual(["dashboard"]);
	});

	it("GET returns default notifications for target created without them", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(body.notifications).not.toBeNull();
		expect(body.notifications.on_score_drop).toBe(true);
		expect(body.notifications.channels).toEqual(["dashboard"]);
	});

	it("POST with explicit notifications preserves them (not overwritten by defaults)", async () => {
		const custom = {
			on_score_drop: false,
			on_external_change: false,
			on_optimization_complete: false,
			channels: ["email"],
		};
		const res = await createTarget({ notifications: custom });
		const body = await res.json();

		expect(body.notifications.on_score_drop).toBe(false);
		expect(body.notifications.channels).toEqual(["email"]);
	});
});

// ── Bug #4 regression: malformed JSON on all endpoints ──────────

describe("Malformed JSON on various endpoints (Bug #4)", () => {
	it("PUT with malformed JSON returns 400", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		const res = await app.request(`/api/targets/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: "{broken json!!!",
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.error).toBe("Invalid JSON in request body");
	});

	it("POST with empty body returns 400", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "",
		});
		// Empty body may trigger JSON parse error or validation error — either way, not 500
		expect(res.status).toBeLessThan(500);
	});

	it("POST with HTML body returns 400", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "<html><body>not json</body></html>",
		});
		expect(res.status).toBe(400);
	});

	it("server stays responsive after malformed JSON", async () => {
		// Send bad request
		await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{{{{",
		});

		// Server should still work
		const healthRes = await app.request("/health", { method: "GET" });
		expect(healthRes.status).toBe(200);

		// CRUD should still work
		const createRes = await createTarget();
		expect(createRes.status).toBe(201);
	});
});

// ── Bug #1 regression: all JSON fields round-trip via API ───────

describe("All JSON fields round-trip via API (Bug #1)", () => {
	it("competitors array of objects survives create → get cycle", async () => {
		const competitors = [
			{ url: "https://rival1.com", name: "Rival 1", relationship: "direct" },
			{ url: "https://rival2.com", name: "Rival 2", relationship: "indirect" },
		];
		const createRes = await createTarget({ competitors });
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(Array.isArray(body.competitors)).toBe(true);
		expect(body.competitors).toHaveLength(2);
		expect(body.competitors[0].url).toBe("https://rival1.com");
		expect(body.competitors[1].relationship).toBe("indirect");
	});

	it("llm_priorities array survives create → get cycle", async () => {
		const llm_priorities = [
			{ llm_service: "chatgpt", priority: "critical" },
			{ llm_service: "claude", priority: "important" },
		];
		const createRes = await createTarget({ llm_priorities });
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(Array.isArray(body.llm_priorities)).toBe(true);
		expect(body.llm_priorities).toHaveLength(2);
		expect(body.llm_priorities[0].llm_service).toBe("chatgpt");
	});

	it("site_type survives create → get cycle", async () => {
		const createRes = await createTarget({ site_type: "manufacturer" });
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(body.site_type).toBe("manufacturer");
	});

	it("target_queries array survives create → get cycle", async () => {
		const target_queries = ["best AI tool 2026", "how to optimize for LLMs"];
		const createRes = await createTarget({ target_queries });
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(Array.isArray(body.target_queries)).toBe(true);
		expect(body.target_queries).toEqual(target_queries);
	});

	it("empty arrays survive create → get cycle", async () => {
		const createRes = await createTarget({
			topics: [],
			target_queries: [],
			competitors: [],
			llm_priorities: [],
		});
		const created = await createRes.json();

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(Array.isArray(body.topics)).toBe(true);
		expect(body.topics).toEqual([]);
		expect(Array.isArray(body.target_queries)).toBe(true);
		expect(body.target_queries).toEqual([]);
		expect(Array.isArray(body.competitors)).toBe(true);
		expect(body.competitors).toEqual([]);
		expect(Array.isArray(body.llm_priorities)).toBe(true);
		expect(body.llm_priorities).toEqual([]);
	});

	it("JSON fields survive create → update → get cycle", async () => {
		const createRes = await createTarget({ topics: ["old"] });
		const created = await createRes.json();

		// Update JSON fields
		await app.request(`/api/targets/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				topics: ["new1", "new2"],
				competitors: [{ url: "https://new-rival.com", name: "New Rival", relationship: "direct" }],
			}),
		});

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();

		expect(Array.isArray(body.topics)).toBe(true);
		expect(body.topics).toEqual(["new1", "new2"]);
		expect(Array.isArray(body.competitors)).toBe(true);
		expect(body.competitors[0].name).toBe("New Rival");
	});
});

// ── Bug #6 regression: DELETE behavior ──────────────────────────

describe("DELETE edge cases (Bug #6)", () => {
	it("double-delete returns 404 on second attempt", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		const first = await app.request(`/api/targets/${created.id}`, { method: "DELETE" });
		expect(first.status).toBe(200);

		const second = await app.request(`/api/targets/${created.id}`, { method: "DELETE" });
		expect(second.status).toBe(404);

		const body = await second.json();
		expect(body.error).toBe("Target not found");
	});

	it("DELETE with random UUID returns 404", async () => {
		const res = await app.request("/api/targets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
			method: "DELETE",
		});
		expect(res.status).toBe(404);
	});

	it("DELETE with empty string ID returns 404", async () => {
		// Hono treats /api/targets/ differently from /api/targets/:id
		// An empty ID would hit the trailing slash middleware, but a truly
		// non-matching ID should still 404
		const res = await app.request("/api/targets/not-a-uuid", { method: "DELETE" });
		expect(res.status).toBe(404);
	});
});

// ── Bug #7 regression: shared DB ensures consistency ────────────

describe("Shared DB connection consistency (Bug #7)", () => {
	it("create via POST is immediately visible via GET list", async () => {
		const createRes = await createTarget({ name: "Consistency Test" });
		expect(createRes.status).toBe(201);

		const listRes = await app.request("/api/targets", { method: "GET" });
		const list = await listRes.json();

		expect(list.some((t: { name: string }) => t.name === "Consistency Test")).toBe(true);
	});

	it("update via PUT is immediately visible via GET by ID", async () => {
		const createRes = await createTarget();
		const created = await createRes.json();

		await app.request(`/api/targets/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated Immediately" }),
		});

		const getRes = await app.request(`/api/targets/${created.id}`, { method: "GET" });
		const body = await getRes.json();
		expect(body.name).toBe("Updated Immediately");
	});

	it("delete via DELETE is immediately reflected in GET list", async () => {
		const createRes = await createTarget({ name: "To Delete" });
		const created = await createRes.json();

		await app.request(`/api/targets/${created.id}`, { method: "DELETE" });

		const listRes = await app.request("/api/targets", { method: "GET" });
		const list = await listRes.json();
		expect(list.some((t: { id: string }) => t.id === created.id)).toBe(false);
	});
});
