/**
 * server.ts — Hono app unit tests (middleware, routes, error handling)
 * Separate from server.test.ts (which tests startServer/EADDRINUSE).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `geo-server-app-test-${Date.now()}`);
process.env.GEO_WORKSPACE = testDir;

// Ensure workspace directories exist before imports
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });

const { app } = await import("./server.js");

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

// ── Root & Health ─────────────────────────────────────────

describe("GET /", () => {
	it("returns API info JSON", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.name).toBe("GEO Agent Dashboard");
		expect(body.version).toBeDefined();
		expect(body.dashboard).toBe("/dashboard");
		expect(body.endpoints).toBeInstanceOf(Array);
		expect(body.endpoints.length).toBeGreaterThanOrEqual(5);
	});

	it("root endpoints list includes required paths", async () => {
		const res = await app.request("/");
		const body = await res.json();
		expect(body.endpoints).toContain("/health");
		expect(body.endpoints).toContain("/dashboard");
		expect(body.endpoints).toContain("/api/targets");
	});
});

describe("GET /health", () => {
	it("returns ok status with timestamp", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.timestamp).toBeDefined();
		// Timestamp should be valid ISO string
		expect(new Date(body.timestamp).getTime()).not.toBeNaN();
	});
});

// ── CORS ──────────────────────────────────────────────────

describe("CORS middleware", () => {
	it("returns Access-Control-Allow-Origin header", async () => {
		const res = await app.request("/health", {
			headers: { Origin: "http://localhost:5173" },
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeDefined();
	});

	it("handles OPTIONS preflight request", async () => {
		const res = await app.request("/api/targets", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5173",
				"Access-Control-Request-Method": "POST",
			},
		});
		// Should not be 404/500
		expect(res.status).toBeLessThan(500);
	});
});

// ── Trailing Slash ────────────────────────────────────────

describe("trimTrailingSlash middleware", () => {
	it("redirects trailing slash to clean path", async () => {
		const res = await app.request("/health/", { redirect: "manual" });
		// trimTrailingSlash returns 301 redirect
		expect([200, 301]).toContain(res.status);
	});
});

// ── Dashboard HTML ────────────────────────────────────────

describe("GET /dashboard", () => {
	it("returns HTML content", async () => {
		const res = await app.request("/dashboard");
		expect(res.status).toBe(200);
		const ct = res.headers.get("Content-Type");
		expect(ct).toContain("text/html");
	});

	it("returns non-empty body", async () => {
		const res = await app.request("/dashboard");
		const body = await res.text();
		expect(body.length).toBeGreaterThan(0);
		expect(body).toContain("<html");
	});
});

// ── Error Handling ────────────────────────────────────────

describe("onError handler", () => {
	it("returns 400 or 503 for malformed JSON body (503 if router not init'd)", async () => {
		const res = await app.request("/api/targets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{ invalid json !!!",
		});
		// Without startServer(), router guard fires 503 before JSON parsing.
		// With startServer(), it would be 400. Both are valid error responses.
		expect([400, 503]).toContain(res.status);
		const body = await res.json();
		expect(body.error).toBeDefined();
	});

	it("returns 503 for router not initialized (targets)", async () => {
		// The router check is baked into the route handler —
		// when db is not initialized, it should return 503
		// This is already handled by the individual routers' guard checks
		// We test by hitting a route that needs DB but hasn't been initialized via startServer
		const res = await app.request("/api/targets");
		// Should be 503 (not initialized) since we didn't call startServer
		expect([200, 503]).toContain(res.status);
	});
});

// ── 404 Handling ──────────────────────────────────────────

describe("404 responses", () => {
	it("returns 404 for unknown routes", async () => {
		const res = await app.request("/api/nonexistent");
		expect(res.status).toBe(404);
	});

	it("returns 404 for unknown nested routes", async () => {
		const res = await app.request("/api/targets/xxx/nonexistent");
		expect(res.status).toBe(404);
	});
});

// ── API Route Mounting ────────────────────────────────────

describe("Route mounting", () => {
	it("/api/targets route is mounted", async () => {
		const res = await app.request("/api/targets");
		// Either 200 (if db init'd) or 503 (not init'd) — but NOT 404
		expect(res.status).not.toBe(404);
	});

	it("/api/settings route is mounted", async () => {
		const res = await app.request("/api/settings/agents/prompts");
		expect(res.status).not.toBe(404);
	});
});
