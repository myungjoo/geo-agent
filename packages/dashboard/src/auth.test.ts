/**
 * auth.ts — KI-012 Phase 1 authentication tests
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	authEnabled,
	checkCredentials,
	createSession,
	invalidateSession,
	validateSession,
} from "./auth.js";

const testDir = path.join(os.tmpdir(), `geo-auth-test-${Date.now()}`);

beforeAll(() => {
	process.env.GEO_WORKSPACE = testDir;
	fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
	fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });
});

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

afterEach(() => {
	// Clean up auth env vars after each test
	process.env.GEO_AUTH_USERNAME = "";
	process.env.GEO_AUTH_PASSWORD = "";
});

// ── authEnabled() ─────────────────────────────────────────

describe("authEnabled()", () => {
	it("returns false when no env vars set", () => {
		expect(authEnabled()).toBe(false);
	});

	it("returns false when only username is set", () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		expect(authEnabled()).toBe(false);
	});

	it("returns false when only password is set", () => {
		process.env.GEO_AUTH_PASSWORD = "secret";
		expect(authEnabled()).toBe(false);
	});

	it("returns true when both username and password are set", () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "secret";
		expect(authEnabled()).toBe(true);
	});
});

// ── checkCredentials() ────────────────────────────────────

describe("checkCredentials()", () => {
	beforeEach(() => {
		process.env.GEO_AUTH_USERNAME = "testuser";
		process.env.GEO_AUTH_PASSWORD = "testpass";
	});

	it("returns true for correct credentials", () => {
		expect(checkCredentials("testuser", "testpass")).toBe(true);
	});

	it("returns false for wrong username", () => {
		expect(checkCredentials("wronguser", "testpass")).toBe(false);
	});

	it("returns false for wrong password", () => {
		expect(checkCredentials("testuser", "wrongpass")).toBe(false);
	});

	it("returns false for empty credentials", () => {
		expect(checkCredentials("", "")).toBe(false);
	});
});

// ── Session management ────────────────────────────────────

describe("Session management", () => {
	it("createSession() returns a non-empty string token", () => {
		const token = createSession();
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);
	});

	it("validateSession() returns true for a valid token", () => {
		const token = createSession();
		expect(validateSession(token)).toBe(true);
	});

	it("validateSession() returns false for an unknown token", () => {
		expect(validateSession("not-a-real-token")).toBe(false);
	});

	it("invalidateSession() removes the token", () => {
		const token = createSession();
		expect(validateSession(token)).toBe(true);
		invalidateSession(token);
		expect(validateSession(token)).toBe(false);
	});

	it("each createSession() call returns a unique token", () => {
		const t1 = createSession();
		const t2 = createSession();
		expect(t1).not.toBe(t2);
		// Cleanup
		invalidateSession(t1);
		invalidateSession(t2);
	});
});

// ── HTTP integration via app ──────────────────────────────

describe("Auth middleware (HTTP integration)", () => {
	// We need a fresh app import for each auth configuration.
	// Since modules are cached, we use separate describe blocks
	// and manipulate env vars before import.
	//
	// For the open (no-auth) case, server-app.test.ts already covers all routes.
	// Here we test the auth-enabled behavior.

	it("GET /health is accessible without auth when auth is enabled", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		// We import the app after setting env vars. Module is cached from server-app.test.ts
		// so authMiddleware() is called fresh each request (it reads env at call time).
		const { app } = await import("./server.js");
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});

	it("GET /login returns HTML login page when auth is enabled", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		const { app } = await import("./server.js");
		const res = await app.request("/login");
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("<form");
		expect(body).toContain("/api/auth/login");
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});

	it("POST /api/auth/login returns 401 for wrong credentials", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		const { app } = await import("./server.js");
		const res = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "wrong" }),
		});
		expect(res.status).toBe(401);
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});

	it("POST /api/auth/login returns 200 and sets cookie for correct credentials", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		const { app } = await import("./server.js");
		const res = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "s3cr3t" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		const setCookieHeader = res.headers.get("Set-Cookie");
		expect(setCookieHeader).toBeTruthy();
		expect(setCookieHeader).toContain("geo_session=");
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});

	it("GET /api/targets returns 401 without session when auth is enabled (non-localhost)", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		const { app } = await import("./server.js");
		// app.request() has no real socket, so getConnInfo throws → non-localhost
		const res = await app.request("/api/targets");
		// 401 (no valid session, non-localhost)
		expect(res.status).toBe(401);
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});

	it("GET /api/targets accessible with valid session cookie", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		const { app } = await import("./server.js");

		// Login first
		const loginRes = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "s3cr3t" }),
		});
		const cookieHeader = loginRes.headers.get("Set-Cookie") ?? "";
		const token = cookieHeader.match(/geo_session=([^;]+)/)?.[1] ?? "";
		expect(token).toBeTruthy();

		// Use session cookie to access API
		const apiRes = await app.request("/api/targets", {
			headers: { Cookie: `geo_session=${token}` },
		});
		// Not 401 (auth passed), could be 200 or 503 depending on DB init state
		expect(apiRes.status).not.toBe(401);
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});

	it("POST /api/auth/logout invalidates session", async () => {
		process.env.GEO_AUTH_USERNAME = "admin";
		process.env.GEO_AUTH_PASSWORD = "s3cr3t";
		const { app } = await import("./server.js");

		// Login
		const loginRes = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "s3cr3t" }),
		});
		const cookieHeader = loginRes.headers.get("Set-Cookie") ?? "";
		const token = cookieHeader.match(/geo_session=([^;]+)/)?.[1] ?? "";

		// Logout
		const logoutRes = await app.request("/api/auth/logout", {
			method: "POST",
			headers: { Cookie: `geo_session=${token}` },
		});
		expect(logoutRes.status).toBe(200);

		// Session should now be invalid
		const apiRes = await app.request("/api/targets", {
			headers: { Cookie: `geo_session=${token}` },
		});
		expect(apiRes.status).toBe(401);
		process.env.GEO_AUTH_USERNAME = "";
		process.env.GEO_AUTH_PASSWORD = "";
	});
});
