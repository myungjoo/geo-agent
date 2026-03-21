import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsSchema, initWorkspace, loadSettings, saveSettings } from "./settings.js";
function makeTmpDir() {
	const dir = path.join(os.tmpdir(), `geo-settings-test-${crypto.randomBytes(8).toString("hex")}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}
let tmpDirs = [];
function trackTmpDir() {
	const dir = makeTmpDir();
	tmpDirs.push(dir);
	return dir;
}
afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of tmpDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
	tmpDirs = [];
});
// ─── AppSettingsSchema ───────────────────────────────────────────
describe("AppSettingsSchema", () => {
	it("applies all default values when given an empty object", () => {
		const result = AppSettingsSchema.parse({});
		expect(result.workspace_dir).toBe(path.join(os.homedir(), ".geo-agent"));
		expect(result.db_path).toBe("data/geo-agent.db");
		expect(result.port).toBe(3000);
		expect(result.default_model).toBe("gpt-4o");
		expect(result.log_level).toBe("info");
	});
	it("accepts custom values that satisfy the schema", () => {
		const custom = {
			workspace_dir: "/custom/workspace",
			db_path: "mydata/custom.db",
			port: 8080,
			default_model: "claude-3-opus",
			log_level: "debug",
		};
		const result = AppSettingsSchema.parse(custom);
		expect(result.workspace_dir).toBe("/custom/workspace");
		expect(result.db_path).toBe("mydata/custom.db");
		expect(result.port).toBe(8080);
		expect(result.default_model).toBe("claude-3-opus");
		expect(result.log_level).toBe("debug");
	});
	it("rejects a negative port number", () => {
		expect(() => AppSettingsSchema.parse({ port: -1 })).toThrow();
	});
	it("rejects port 0", () => {
		expect(() => AppSettingsSchema.parse({ port: 0 })).toThrow();
	});
	it("rejects a float port number", () => {
		expect(() => AppSettingsSchema.parse({ port: 3000.5 })).toThrow();
	});
	it("rejects an invalid log_level", () => {
		expect(() => AppSettingsSchema.parse({ log_level: "verbose" })).toThrow();
	});
});
// ─── loadSettings ────────────────────────────────────────────────
describe("loadSettings", () => {
	it("returns defaults when no config file exists", () => {
		const dir = trackTmpDir();
		const settings = loadSettings(dir);
		expect(settings.workspace_dir).toBe(dir);
		expect(settings.db_path).toBe("data/geo-agent.db");
		expect(settings.port).toBe(3000);
		expect(settings.default_model).toBe("gpt-4o");
		expect(settings.log_level).toBe("info");
	});
	it("reads config.json from the specified directory", () => {
		const dir = trackTmpDir();
		const config = { port: 9999, default_model: "claude-3-sonnet" };
		fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
		const settings = loadSettings(dir);
		expect(settings.port).toBe(9999);
		expect(settings.default_model).toBe("claude-3-sonnet");
		// Defaults still applied for unset fields
		expect(settings.db_path).toBe("data/geo-agent.db");
		expect(settings.log_level).toBe("info");
	});
	it("reads GEO_WORKSPACE env var when no argument is passed", () => {
		const dir = trackTmpDir();
		const config = { port: 7777 };
		fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
		vi.stubEnv("GEO_WORKSPACE", dir);
		const settings = loadSettings();
		expect(settings.workspace_dir).toBe(dir);
		expect(settings.port).toBe(7777);
	});
	it("explicit argument takes priority over GEO_WORKSPACE", () => {
		const envDir = trackTmpDir();
		const argDir = trackTmpDir();
		fs.writeFileSync(path.join(envDir, "config.json"), JSON.stringify({ port: 1111 }));
		fs.writeFileSync(path.join(argDir, "config.json"), JSON.stringify({ port: 2222 }));
		vi.stubEnv("GEO_WORKSPACE", envDir);
		const settings = loadSettings(argDir);
		expect(settings.workspace_dir).toBe(argDir);
		expect(settings.port).toBe(2222);
	});
	it("handles malformed JSON in config.json by falling back to defaults", () => {
		const dir = trackTmpDir();
		fs.writeFileSync(path.join(dir, "config.json"), "{ not valid json !!");
		const settings = loadSettings(dir);
		expect(settings.workspace_dir).toBe(dir);
		expect(settings.port).toBe(3000);
		expect(settings.default_model).toBe("gpt-4o");
	});
	it("handles a non-existent directory gracefully", () => {
		const dir = path.join(os.tmpdir(), `geo-nonexistent-${crypto.randomBytes(8).toString("hex")}`);
		// Ensure it does NOT exist
		expect(fs.existsSync(dir)).toBe(false);
		const settings = loadSettings(dir);
		expect(settings.workspace_dir).toBe(dir);
		expect(settings.port).toBe(3000);
	});
});
// ─── saveSettings ────────────────────────────────────────────────
describe("saveSettings", () => {
	it("creates the directory if needed and writes valid JSON", () => {
		const dir = path.join(trackTmpDir(), "nested", "workspace");
		const settings = AppSettingsSchema.parse({ workspace_dir: dir });
		saveSettings(settings);
		const configPath = path.join(dir, "config.json");
		expect(fs.existsSync(configPath)).toBe(true);
		const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(written.port).toBe(3000);
		expect(written.default_model).toBe("gpt-4o");
		expect(written.workspace_dir).toBe(dir);
	});
	it("roundtrips correctly with loadSettings", () => {
		const dir = trackTmpDir();
		const original = AppSettingsSchema.parse({
			workspace_dir: dir,
			port: 4567,
			default_model: "gpt-4-turbo",
			log_level: "debug",
		});
		saveSettings(original);
		const loaded = loadSettings(dir);
		expect(loaded).toEqual(original);
	});
});
// ─── initWorkspace ───────────────────────────────────────────────
describe("initWorkspace", () => {
	it("creates data/, prompts/, snapshots/, and patches/ directories", () => {
		const dir = trackTmpDir();
		const settings = AppSettingsSchema.parse({ workspace_dir: dir });
		initWorkspace(settings);
		const expectedDirs = ["data", "prompts", "snapshots", "patches"];
		for (const sub of expectedDirs) {
			const full = path.join(dir, sub);
			expect(fs.existsSync(full)).toBe(true);
			expect(fs.statSync(full).isDirectory()).toBe(true);
		}
	});
});
//# sourceMappingURL=settings.test.js.map
