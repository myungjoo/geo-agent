import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { type AppSettings, AppSettingsSchema } from "../config/settings.js";
import { createDatabase, ensureTables } from "./connection.js";

function makeTmpDir(): string {
	const dir = path.join(os.tmpdir(), `geo-db-test-${crypto.randomBytes(8).toString("hex")}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

let tmpDirs: string[] = [];

function trackTmpDir(): string {
	const dir = makeTmpDir();
	tmpDirs.push(dir);
	return dir;
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
	const dir = trackTmpDir();
	return AppSettingsSchema.parse({
		workspace_dir: dir,
		...overrides,
	});
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

// ─── createDatabase ──────────────────────────────────────────────

describe("createDatabase", () => {
	it("creates the DB file at the correct path", () => {
		const settings = makeSettings();
		createDatabase(settings);

		const expectedPath = path.join(settings.workspace_dir, settings.db_path);
		expect(fs.existsSync(expectedPath)).toBe(true);
	});

	it("joins a relative db_path to workspace_dir", () => {
		const settings = makeSettings({ db_path: "subdir/test.db" });
		createDatabase(settings);

		const expectedPath = path.join(settings.workspace_dir, "subdir", "test.db");
		expect(fs.existsSync(expectedPath)).toBe(true);
	});

	it("uses an absolute db_path directly", () => {
		const dir = trackTmpDir();
		const absoluteDbPath = path.join(dir, "absolute", "my.db");
		const settings = makeSettings({ db_path: absoluteDbPath });

		createDatabase(settings);

		expect(fs.existsSync(absoluteDbPath)).toBe(true);
	});

	it("creates parent directories if they don't exist", () => {
		const settings = makeSettings({
			db_path: "deep/nested/dir/test.db",
		});
		const expectedDir = path.join(settings.workspace_dir, "deep", "nested", "dir");

		createDatabase(settings);

		expect(fs.existsSync(expectedDir)).toBe(true);
		expect(fs.statSync(expectedDir).isDirectory()).toBe(true);
	});

	it("enables WAL journal mode", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute("PRAGMA journal_mode");
		client.close();

		expect(result.rows[0].journal_mode).toBe("wal");
	});

	it("enables foreign keys", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute("PRAGMA foreign_keys");
		client.close();

		expect(Number(result.rows[0].foreign_keys)).toBe(1);
	});

	it("returns a drizzle instance with select and insert methods", () => {
		const settings = makeSettings();
		const db = createDatabase(settings);

		expect(typeof db.select).toBe("function");
		expect(typeof db.insert).toBe("function");
	});

	it("handles multiple calls on the same file without locking issues", () => {
		const settings = makeSettings();

		const db1 = createDatabase(settings);
		const db2 = createDatabase(settings);

		expect(typeof db1.select).toBe("function");
		expect(typeof db2.select).toBe("function");
	});
});

// ─── Bug #5 regression: auto-table creation ───────────────────────

describe("createDatabase — auto-table creation (Bug #5)", () => {
	it("creates all 7 required tables on a fresh DB", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		);
		client.close();

		const names = result.rows.map((r) => r.name as string);
		expect(names).toContain("targets");
		expect(names).toContain("content_snapshots");
		expect(names).toContain("change_records");
		expect(names).toContain("change_impacts");
		expect(names).toContain("geo_time_series");
		expect(names).toContain("pipeline_runs");
		expect(names).toContain("error_events");
	});

	it("is idempotent — calling twice does not error or duplicate tables", async () => {
		const settings = makeSettings();
		const db1 = createDatabase(settings);
		await ensureTables(db1);
		const db2 = createDatabase(settings);
		await ensureTables(db2);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='targets'",
		);
		client.close();

		expect(result.rows).toHaveLength(1);
	});

	it("targets table has correct columns", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute("PRAGMA table_info(targets)");
		client.close();

		const colNames = result.rows.map((r) => r.name as string);
		expect(colNames).toContain("id");
		expect(colNames).toContain("url");
		expect(colNames).toContain("name");
		expect(colNames).toContain("topics");
		expect(colNames).toContain("competitors");
		expect(colNames).toContain("notifications");
		expect(colNames).toContain("status");
		expect(colNames).toContain("created_at");
		expect(colNames).toContain("updated_at");
	});

	it("pipeline_runs table has correct columns", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute("PRAGMA table_info(pipeline_runs)");
		client.close();

		const colNames = result.rows.map((r) => r.name as string);
		expect(colNames).toContain("pipeline_id");
		expect(colNames).toContain("target_id");
		expect(colNames).toContain("stage");
		expect(colNames).toContain("retry_count");
		expect(colNames).toContain("resumable");
	});

	it("fresh DB with tables allows immediate insert and query", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		const { TargetRepository } = await import("./repositories/target-repository.js");

		const repo = new TargetRepository(db);
		const created = await repo.create({ url: "https://test.com", name: "Auto-table test" });

		expect(created.id).toBeDefined();
		expect(created.name).toBe("Auto-table test");

		const fetched = await repo.findById(created.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.name).toBe("Auto-table test");
	});
});

// ─── DB migration (applyMigrations) ────────────────────────────────

describe("DB migration (applyMigrations)", () => {
	it("applies migrations to a DB created without brand column", async () => {
		const settings = makeSettings();
		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });

		// Create a DB with an old schema missing brand, site_type, status columns
		const rawClient = createClient({ url: `file:${dbPath}` });
		await rawClient.execute(`
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
				target_score REAL,
				llm_priorities TEXT NOT NULL DEFAULT '[]',
				clone_base_path TEXT,
				notifications TEXT,
				monitoring_interval TEXT NOT NULL DEFAULT 'daily',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		rawClient.close();

		// Now run createDatabase + ensureTables which should apply migrations
		const db = createDatabase(settings);
		await ensureTables(db);

		// Verify the missing columns now exist
		const checkClient = createClient({ url: `file:${dbPath}` });
		const result = await checkClient.execute("PRAGMA table_info(targets)");
		checkClient.close();

		const colNames = result.rows.map((r) => r.name as string);
		expect(colNames).toContain("brand");
		expect(colNames).toContain("site_type");
		expect(colNames).toContain("status");
	});

	it("migrations are idempotent — running on a fresh DB is a no-op", async () => {
		const settings = makeSettings();
		const db1 = createDatabase(settings);
		await ensureTables(db1);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client1 = createClient({ url: `file:${dbPath}` });
		const before = await client1.execute("PRAGMA table_info(targets)");
		client1.close();
		const colsBefore = before.rows.map((r) => r.name as string);
		expect(colsBefore).toContain("brand");

		// Run createDatabase + ensureTables again on the same DB
		const db2 = createDatabase(settings);
		await ensureTables(db2);

		const client2 = createClient({ url: `file:${dbPath}` });
		const after = await client2.execute("PRAGMA table_info(targets)");
		client2.close();
		const colsAfter = after.rows.map((r) => r.name as string);

		// Columns should be identical (no duplicates)
		expect(colsAfter).toEqual(colsBefore);
	});

	it("PRAGMA user_version is set after migrations", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const client = createClient({ url: `file:${dbPath}` });
		const result = await client.execute("PRAGMA user_version");
		client.close();

		const userVersion =
			(result.rows[0]?.user_version as number) ??
			(result.rows[0]?.[0] as number) ??
			0;
		expect(userVersion).toBeGreaterThanOrEqual(3);
	});
});
