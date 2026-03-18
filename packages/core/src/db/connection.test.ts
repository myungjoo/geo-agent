import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { createDatabase, ensureTables } from "./connection.js";
import { AppSettingsSchema, type AppSettings } from "../config/settings.js";

function makeTmpDir(): string {
	const dir = path.join(
		os.tmpdir(),
		`geo-db-test-${crypto.randomBytes(8).toString("hex")}`,
	);
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

		const expectedPath = path.join(
			settings.workspace_dir,
			settings.db_path,
		);
		expect(fs.existsSync(expectedPath)).toBe(true);
	});

	it("joins a relative db_path to workspace_dir", () => {
		const settings = makeSettings({ db_path: "subdir/test.db" });
		createDatabase(settings);

		const expectedPath = path.join(
			settings.workspace_dir,
			"subdir",
			"test.db",
		);
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
		const expectedDir = path.join(
			settings.workspace_dir,
			"deep",
			"nested",
			"dir",
		);

		createDatabase(settings);

		expect(fs.existsSync(expectedDir)).toBe(true);
		expect(fs.statSync(expectedDir).isDirectory()).toBe(true);
	});

	it("enables WAL journal mode", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(
			settings.workspace_dir,
			settings.db_path,
		);
		const sqlite = new Database(dbPath);
		const result = sqlite.pragma("journal_mode") as { journal_mode: string }[];
		sqlite.close();

		expect(result[0].journal_mode).toBe("wal");
	});

	it("enables foreign keys", () => {
		const settings = makeSettings();
		createDatabase(settings);

		const dbPath = path.join(
			settings.workspace_dir,
			settings.db_path,
		);
		const sqlite = new Database(dbPath);
		const result = sqlite.pragma("foreign_keys") as { foreign_keys: number }[];
		sqlite.close();

		expect(result[0].foreign_keys).toBe(1);
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
		const sqlite = new Database(dbPath);
		const tables = sqlite.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		).all() as { name: string }[];
		sqlite.close();

		const names = tables.map((t) => t.name);
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
		const sqlite = new Database(dbPath);
		const tables = sqlite.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='targets'",
		).all() as { name: string }[];
		sqlite.close();

		expect(tables).toHaveLength(1);
	});

	it("targets table has correct columns", async () => {
		const settings = makeSettings();
		const db = createDatabase(settings);
		await ensureTables(db);

		const dbPath = path.join(settings.workspace_dir, settings.db_path);
		const sqlite = new Database(dbPath);
		const columns = sqlite.prepare("PRAGMA table_info(targets)").all() as { name: string }[];
		sqlite.close();

		const colNames = columns.map((c) => c.name);
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
		const sqlite = new Database(dbPath);
		const columns = sqlite.prepare("PRAGMA table_info(pipeline_runs)").all() as { name: string }[];
		sqlite.close();

		const colNames = columns.map((c) => c.name);
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
