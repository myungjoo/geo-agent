import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema.js";
import type { AppSettings } from "../config/settings.js";

export type GeoDatabase = ReturnType<typeof createDatabase>;

/**
 * Creates and returns a drizzle database instance backed by SQLite.
 */
export function createDatabase(settings: AppSettings) {
	const dbPath = path.isAbsolute(settings.db_path)
		? settings.db_path
		: path.join(settings.workspace_dir, settings.db_path);

	// Ensure the directory exists
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");

	const db = drizzle(sqlite, { schema });
	return db;
}
