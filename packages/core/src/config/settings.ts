import { z } from "zod";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export const AppSettingsSchema = z.object({
	/** Workspace root directory */
	workspace_dir: z.string().default(
		path.join(os.homedir(), ".geo-agent"),
	),
	/** SQLite database file path (relative to workspace) */
	db_path: z.string().default("data/geo-agent.db"),
	/** Dashboard server port */
	port: z.number().int().positive().default(3000),
	/** Default orchestration model */
	default_model: z.string().default("gpt-4o"),
	/** Log level */
	log_level: z
		.enum(["trace", "debug", "info", "warn", "error", "fatal"])
		.default("info"),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

const CONFIG_FILE = "config.json";

/**
 * Loads settings from workspace config file, falling back to defaults.
 */
export function loadSettings(workspaceDir?: string): AppSettings {
	const baseDir =
		workspaceDir ?? process.env.GEO_WORKSPACE ?? path.join(os.homedir(), ".geo-agent");
	const configPath = path.join(baseDir, CONFIG_FILE);

	let raw: Record<string, unknown> = {};
	if (fs.existsSync(configPath)) {
		try {
			raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		} catch {
			// Ignore parse errors, use defaults
		}
	}

	return AppSettingsSchema.parse({ workspace_dir: baseDir, ...raw });
}

/**
 * Saves settings to workspace config file.
 */
export function saveSettings(settings: AppSettings): void {
	const configPath = path.join(settings.workspace_dir, CONFIG_FILE);
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
}

/**
 * Ensures workspace directory structure exists.
 */
export function initWorkspace(settings: AppSettings): void {
	const dirs = [
		settings.workspace_dir,
		path.join(settings.workspace_dir, "data"),
		path.join(settings.workspace_dir, "prompts"),
		path.join(settings.workspace_dir, "snapshots"),
		path.join(settings.workspace_dir, "patches"),
		path.join(settings.workspace_dir, "clones"),
		path.join(settings.workspace_dir, "reports"),
	];
	for (const dir of dirs) {
		fs.mkdirSync(dir, { recursive: true });
	}
}
