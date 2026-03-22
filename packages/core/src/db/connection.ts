import fs from "node:fs";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { AppSettings } from "../config/settings.js";
import * as schema from "./schema.js";

export type GeoDatabase = ReturnType<typeof drizzle<typeof schema>>;

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS targets (
	id TEXT PRIMARY KEY,
	url TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	brand TEXT NOT NULL DEFAULT '',
	topics TEXT NOT NULL DEFAULT '[]',
	target_queries TEXT NOT NULL DEFAULT '[]',
	audience TEXT NOT NULL DEFAULT '',
	competitors TEXT NOT NULL DEFAULT '[]',
	business_goal TEXT NOT NULL DEFAULT '',
	target_score REAL,
	llm_priorities TEXT NOT NULL DEFAULT '[]',
	clone_base_path TEXT,
	site_type TEXT NOT NULL DEFAULT 'generic',
	notifications TEXT,
	monitoring_interval TEXT NOT NULL DEFAULT 'daily',
	status TEXT NOT NULL DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_snapshots (
	snapshot_id TEXT PRIMARY KEY,
	url TEXT NOT NULL,
	captured_at TEXT NOT NULL,
	html_hash TEXT NOT NULL,
	content_text TEXT NOT NULL,
	structured_data TEXT NOT NULL DEFAULT '{}',
	geo_score TEXT,
	llm_responses TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS change_records (
	change_id TEXT PRIMARY KEY,
	experiment_id TEXT NOT NULL,
	url TEXT NOT NULL,
	target_id TEXT,
	changed_at TEXT NOT NULL,
	change_type TEXT NOT NULL,
	change_summary TEXT NOT NULL,
	diff TEXT NOT NULL,
	snapshot_before TEXT NOT NULL,
	snapshot_after TEXT,
	triggered_by TEXT NOT NULL DEFAULT 'auto',
	strategy_ref TEXT
);

CREATE TABLE IF NOT EXISTS change_impacts (
	change_id TEXT PRIMARY KEY,
	measured_at TEXT NOT NULL,
	score_before REAL NOT NULL,
	score_after REAL NOT NULL,
	delta REAL NOT NULL,
	delta_pct REAL NOT NULL,
	per_llm_impact TEXT NOT NULL DEFAULT '{}',
	confidence REAL NOT NULL,
	confounders TEXT NOT NULL DEFAULT '[]',
	verdict TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geo_time_series (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	url TEXT NOT NULL,
	llm_service TEXT NOT NULL,
	measured_at TEXT NOT NULL,
	geo_score REAL NOT NULL,
	citation_rate REAL NOT NULL,
	citation_rank INTEGER,
	change_id TEXT,
	delta_score REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
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

CREATE TABLE IF NOT EXISTS stage_executions (
	id TEXT PRIMARY KEY,
	pipeline_id TEXT NOT NULL,
	stage TEXT NOT NULL,
	cycle INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'pending',
	prompt_summary TEXT NOT NULL DEFAULT '',
	result_summary TEXT NOT NULL DEFAULT '',
	result_full TEXT,
	error_message TEXT,
	started_at TEXT NOT NULL,
	completed_at TEXT,
	duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS error_events (
	error_id TEXT PRIMARY KEY,
	timestamp TEXT NOT NULL,
	agent_id TEXT NOT NULL,
	target_id TEXT NOT NULL,
	error_type TEXT NOT NULL,
	severity TEXT NOT NULL,
	message TEXT NOT NULL,
	context TEXT NOT NULL DEFAULT '{}',
	resolved INTEGER NOT NULL DEFAULT 0
);
`;

/**
 * Creates and returns a drizzle database instance backed by libSQL (SQLite-compatible).
 * Auto-creates all required tables if they don't exist.
 * Note: Table creation is async — call ensureReady() if you need tables immediately.
 */
export function createDatabase(settings: AppSettings): GeoDatabase {
	const dbPath = path.isAbsolute(settings.db_path)
		? settings.db_path
		: path.join(settings.workspace_dir, settings.db_path);

	// Ensure the directory exists
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	const client = createClient({
		url: `file:${dbPath}`,
	});

	// Enable WAL mode, foreign keys, and auto-create tables (Bug #5 fix)
	// These are fire-and-forget — for immediate use, call ensureTables()
	const initPromise = client
		.executeMultiple("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
		.then(() => client.executeMultiple(CREATE_TABLES_SQL));

	const db = drizzle(client, { schema }) as GeoDatabase & { _initPromise?: Promise<void> };
	db._initPromise = initPromise;

	return db;
}

/**
 * Wait for database initialization (table creation) to complete.
 * Call this before first DB operation if you need guaranteed table existence.
 */
export async function ensureTables(db: GeoDatabase): Promise<void> {
	const dbWithInit = db as GeoDatabase & { _initPromise?: Promise<void> };
	if (dbWithInit._initPromise) {
		await dbWithInit._initPromise;
	}
}
