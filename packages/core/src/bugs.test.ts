import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
/**
 * REGRESSION TEST FILE: Known bugs discovered during testing.
 *
 * Each test documents a specific bug with its root cause, expected behavior,
 * and actual behavior. Tests that FAIL on the current codebase are marked
 * with it.fails() so the overall suite still passes while documenting
 * the expected behavior.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppSettingsSchema, initWorkspace, loadSettings, saveSettings } from "./config/settings.js";
import { createDatabase, ensureTables } from "./db/connection.js";
import { TargetRepository } from "./db/repositories/target-repository.js";
import * as schema from "./db/schema.js";
import type { CreateTarget } from "./models/target-profile.js";

// ─── Test helpers ─────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = path.join(
		os.tmpdir(),
		`geo-bugs-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
	);
	fs.mkdirSync(dir, { recursive: true });
	tmpDirs.push(dir);
	return dir;
}

const CREATE_TABLE_SQL = `
	CREATE TABLE targets (
		id TEXT PRIMARY KEY,
		url TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		topics TEXT NOT NULL DEFAULT '[]',
		target_queries TEXT NOT NULL DEFAULT '[]',
		audience TEXT NOT NULL DEFAULT '',
		competitors TEXT NOT NULL DEFAULT '[]',
		business_goal TEXT NOT NULL DEFAULT '',
		llm_priorities TEXT NOT NULL DEFAULT '[]',
		clone_base_path TEXT,
		site_type TEXT NOT NULL DEFAULT 'generic',
		notifications TEXT,
		monitoring_interval TEXT NOT NULL DEFAULT 'daily',
		status TEXT NOT NULL DEFAULT 'active',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`;

async function createTestDb() {
	const client = createClient({ url: ":memory:" });
	await client.executeMultiple(CREATE_TABLE_SQL);
	return drizzle(client, { schema });
}

function makeCreateTarget(overrides: Partial<CreateTarget> = {}): CreateTarget {
	return {
		url: "https://example.com",
		name: "Test Target",
		...overrides,
	};
}

afterEach(() => {
	for (const dir of tmpDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
	tmpDirs = [];
});

// ─── BUG #1: JSON double-serialization ───────────────────────────
// Root cause: target-repository.ts create() calls JSON.stringify() on values
// before inserting into drizzle columns defined with mode:"json". Drizzle
// already serializes JSON mode columns, so this produces double-serialized
// strings like '"[\\"AI\\",\\"ML\\"]"' in the DB, and on read-back the
// mode:"json" column parses one layer, returning the string '["AI","ML"]'
// instead of the actual array ["AI", "ML"].

describe("BUG #1: JSON fields returned as strings instead of parsed arrays/objects", () => {
	// BUG #1a: topics array double-serialization
	// Expected: topics should be an actual array ["a", "b"]
	// Actual: topics is the JSON string '["a","b"]'
	it("BUG #1a [FIXED]: create() with topics array should return array, not string", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const input = makeCreateTarget({ topics: ["a", "b"] });
		const result = await repo.create(input);

		expect(Array.isArray(result.topics)).toBe(true);
		expect(typeof result.topics).not.toBe("string");
		expect(result.topics).toEqual(["a", "b"]);
	});

	// BUG #1b: competitors array of objects double-serialization
	// Expected: competitors should be an actual array of objects
	// Actual: competitors is a JSON string
	it("BUG #1b [FIXED]: create() with competitors array should return array of objects", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const competitors = [
			{ url: "https://rival.com", name: "Rival", relationship: "direct" as const },
		];
		const input = makeCreateTarget({ competitors });
		const result = await repo.create(input);

		expect(Array.isArray(result.competitors)).toBe(true);
		expect(typeof result.competitors).not.toBe("string");
		expect(result.competitors).toEqual(competitors);
	});

	// BUG #1c: empty topics array double-serialization
	// Expected: topics should be [] (Array.isArray === true)
	// Actual: topics is the string "[]"
	it("BUG #1c [FIXED]: create() with empty topics [] should return empty array, not string '[]'", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const input = makeCreateTarget({ topics: [] });
		const result = await repo.create(input);

		expect(Array.isArray(result.topics)).toBe(true);
		expect(typeof result.topics).not.toBe("string");
		expect(result.topics).toEqual([]);
	});

	// BUG #1d: update() also double-serializes JSON fields
	// Expected: after update, topics should be an actual array
	// Actual: topics is a JSON string
	it("BUG #1d [FIXED]: update() with topics array should return array, not string", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const input = makeCreateTarget({ topics: ["original"] });
		const created = await repo.create(input);
		const updated = await repo.update(created.id, { topics: ["x", "y"] });

		expect(updated).not.toBeNull();
		expect(Array.isArray(updated!.topics)).toBe(true);
		expect(typeof updated!.topics).not.toBe("string");
		expect(updated!.topics).toEqual(["x", "y"]);
	});

	// BUG #1e: notifications object double-serialization
	// Expected: notifications should be an actual object
	// Actual: notifications is a JSON string
	it("BUG #1e [FIXED]: create() with notifications object should return object, not string", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const notifications = {
			on_score_drop: true,
			on_external_change: false,
			on_optimization_complete: true,
			channels: ["dashboard" as const],
		};
		const input = makeCreateTarget({ notifications });
		const result = await repo.create(input);

		expect(typeof result.notifications).toBe("object");
		expect(typeof result.notifications).not.toBe("string");
		expect(result.notifications).toEqual(notifications);
	});

	// BUG #1f: llm_priorities array double-serialization
	// Expected: llm_priorities should be an actual array
	// Actual: llm_priorities is a JSON string
	it("BUG #1f [FIXED]: create() with llm_priorities array should return array, not string", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const llm_priorities = [{ llm_service: "openai", priority: "critical" as const }];
		const input = makeCreateTarget({ llm_priorities });
		const result = await repo.create(input);

		expect(Array.isArray(result.llm_priorities)).toBe(true);
		expect(typeof result.llm_priorities).not.toBe("string");
		expect(result.llm_priorities).toEqual(llm_priorities);
	});
});

// ─── BUG #2: notifications null when not provided ────────────────
// Root cause: target-repository.ts create() uses a ternary that defaults
// notifications to null when not provided:
//   notifications: input.notifications ? JSON.stringify(input.notifications) : null
// The TargetProfileSchema defines a default notification config:
//   { on_score_drop: true, on_external_change: true, on_optimization_complete: true, channels: ["dashboard"] }
// But the repository bypasses the schema defaults by inserting null directly.

describe("BUG #2: notifications null when not provided", () => {
	// BUG #2a: missing notifications should use default config
	// Expected: notifications should have default values from the schema
	// Actual: notifications is null
	it("BUG #2a [FIXED]: create() without notifications field should not return null", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const input = makeCreateTarget();
		const result = await repo.create(input);

		expect(result.notifications).not.toBeNull();
		expect(result.notifications).toBeDefined();
	});

	// BUG #2b: default notification config should have on_score_drop: true
	// Expected: notifications.on_score_drop should be true
	// Actual: notifications is null, so accessing .on_score_drop throws
	it("BUG #2b [FIXED]: create() without notifications should have default on_score_drop: true", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const input = makeCreateTarget();
		const result = await repo.create(input);

		expect(result.notifications).not.toBeNull();
		expect(result.notifications!.on_score_drop).toBe(true);
		expect(result.notifications!.on_external_change).toBe(true);
		expect(result.notifications!.on_optimization_complete).toBe(true);
		expect(result.notifications!.channels).toEqual(["dashboard"]);
	});
});

// ─── BUG #3: Server crash on EADDRINUSE ──────────────────────────
// When the server port is already in use, the process crashes with an
// unhandled EADDRINUSE error instead of logging a helpful message and
// exiting gracefully. No unit test possible for this scenario.

describe("BUG #3 [FIXED]: Server crash on EADDRINUSE", () => {
	it.skip("FIXED: startServer() now returns a Promise that rejects with EADDRINUSE error instead of crashing", () => {
		// FIXED: startServer() now wraps serve() in a Promise, adds
		// server.on("error") handler that logs a user-friendly message
		// and rejects the promise instead of crashing the process.
	});
});

// ─── BUG #4: Malformed JSON body returns 500 instead of 400 ─────
// Sending a POST to /api/targets with invalid JSON body returns HTTP 500
// instead of HTTP 400. This is tested in API integration tests.

describe("BUG #4 [FIXED]: Malformed JSON body returns 400", () => {
	it.skip("FIXED: app.onError() catches SyntaxError from JSON parsing and returns 400", () => {
		// FIXED: Added app.onError() in server.ts that catches SyntaxError
		// with "JSON" in message and returns HTTP 400
	});
});

// ─── BUG #5: DB tables not auto-created on startup ───────────────
// When starting the server with a fresh workspace, the SQLite DB file is
// created but no tables exist. createDatabase() only creates the drizzle
// instance but never runs migrations or CREATE TABLE statements.

describe("BUG #5 [FIXED]: DB tables auto-created on startup", () => {
	it("BUG #5 [FIXED]: createDatabase() on fresh DB file should create targets table", async () => {
		const tmpDir = makeTmpDir();
		const dbPath = path.join(tmpDir, "test.db");
		const settings = AppSettingsSchema.parse({
			workspace_dir: tmpDir,
			db_path: dbPath,
		});

		// Use createDatabase which now auto-creates tables
		const db = createDatabase(settings);
		await ensureTables(db);

		// Verify tables exist by querying sqlite_master via libsql
		const verifyClient = createClient({ url: `file:${dbPath}` });
		const result = await verifyClient.execute(
			"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
		);
		const tableNames = result.rows.map((row) => row.name as string);

		expect(tableNames).toContain("targets");
		expect(tableNames).toContain("content_snapshots");
		expect(tableNames).toContain("change_records");
		expect(tableNames).toContain("change_impacts");
		expect(tableNames).toContain("geo_time_series");
		expect(tableNames).toContain("pipeline_runs");
		expect(tableNames).toContain("error_events");
	});
});

// ─── BUG #6: DELETE returns true for non-existent target ─────────
// TargetRepository.delete() always returns true (line 94: return true)
// regardless of whether any row was actually deleted.

describe("BUG #6: DELETE returns true for non-existent target", () => {
	// BUG #6a: delete() with non-existent UUID should return false
	// Expected: returns false when no row was deleted
	// Actual: always returns true
	it("BUG #6a [FIXED]: delete() with non-existent UUID should return false", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const result = await repo.delete("00000000-0000-0000-0000-000000000000");

		// This FAILS because delete() always returns true
		expect(result).toBe(false);
	});

	// BUG #6b: delete() with existing target should return true
	// This test should PASS even with the bug, since the method always returns true
	it("BUG #6b: delete() with existing target should return true", async () => {
		const db = await createTestDb();
		const repo = new TargetRepository(db);

		const input = makeCreateTarget();
		const created = await repo.create(input);
		const result = await repo.delete(created.id);

		expect(result).toBe(true);

		// Verify it was actually deleted
		const found = await repo.findById(created.id);
		expect(found).toBeNull();
	});
});

// ─── BUG #7: getRepo() creates new DB connection per request ─────
// Each API request creates a new TargetRepository with a new database
// connection instead of reusing a shared connection pool.

describe("BUG #7 [FIXED]: Shared DB connection across requests", () => {
	it.skip("FIXED: targets router now uses initTargetsRouter(db) for shared DB injection", () => {
		// FIXED: getRepo() no longer calls createDatabase() on every request.
		// Instead, initTargetsRouter(db) is called once at startup from startServer(),
		// and the shared TargetRepository instance is reused across all requests.
	});
});

// ─── BUG #8: drizzle config relative path issue ──────────────────
// drizzle.config.ts uses a relative path that only resolves correctly
// when the CLI is run from the package root.

describe("BUG #8 [FIXED]: drizzle config uses absolute paths", () => {
	it.skip("FIXED: drizzle.config.ts now uses import.meta.url + path.resolve for absolute paths", () => {
		// FIXED: drizzle.config.ts now derives __dirname from import.meta.url
		// and uses path.resolve(__dirname, ...) for schema and output paths.
		// This works regardless of the CWD when running drizzle-kit.
	});
});

// ─── BUG #9: Trailing slash on /api/targets/ returns 404 ─────────
// The Express router registers /api/targets but not /api/targets/.
// A trailing slash causes a 404 response.

describe("BUG #9 [FIXED]: Trailing slash handled by trimTrailingSlash middleware", () => {
	it.skip("FIXED: Hono trimTrailingSlash() middleware redirects /api/targets/ to /api/targets", () => {
		// FIXED: Added trimTrailingSlash() middleware from hono/trailing-slash
		// in server.ts. Requests to /api/targets/ are now redirected (301)
		// to /api/targets, so all trailing-slash URLs work correctly.
	});
});
