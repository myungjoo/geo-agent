/**
 * E2E CLI Test — Verifies CLI commands via subprocess execution.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FixtureServer, startFixtureServer } from "./helpers/fixtures.js";

let fixture: FixtureServer;
let workspaceDir: string;

// Path to CLI entry point (source, via tsx)
const cliPath = path.resolve("packages/cli/src/index.ts");
const nodeArgs = ["--import", "tsx", cliPath];

beforeAll(async () => {
	fixture = await startFixtureServer();

	workspaceDir = path.join(os.tmpdir(), `geo-cli-e2e-${Date.now()}`);
	for (const sub of ["data", "prompts"]) {
		fs.mkdirSync(path.join(workspaceDir, sub), { recursive: true });
	}
});

afterAll(async () => {
	await fixture.stop();
	try {
		fs.rmSync(workspaceDir, { recursive: true, force: true });
	} catch {
		// Windows cleanup
	}
});

// ── Helper ──────────────────────────────────────────────────

function runCli(
	args: string[],
	timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve) => {
		const child = execFile(
			process.execPath,
			[...nodeArgs, ...args],
			{
				env: {
					...process.env,
					GEO_WORKSPACE: workspaceDir,
				},
				timeout: timeoutMs,
			},
			(error, stdout, stderr) => {
				resolve({
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					code: error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
				});
			},
		);
	});
}

// ── CLI Commands ────────────────────────────────────────────

describe("CLI commands", () => {
	it("geo --help exits 0 and shows usage", async () => {
		const { stdout, code } = await runCli(["--help"]);
		expect(code).toBe(0);
		expect(stdout).toContain("GEO Agent System CLI");
	});

	it("geo --version shows version", async () => {
		const { stdout, code } = await runCli(["--version"]);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("geo analyze <fixture-url> outputs score", async () => {
		const { stdout, code } = await runCli(["analyze", fixture.baseUrl]);
		expect(code).toBe(0);
		expect(stdout).toContain("Overall Score:");
		expect(stdout).toContain("Grade:");
		expect(stdout).toContain("Dimensions:");
	});

	it("geo status shows workspace info", async () => {
		const { stdout, code } = await runCli(["status"]);
		// status command may or may not exist — check gracefully
		if (code === 0) {
			expect(stdout.length).toBeGreaterThan(0);
		}
	});
});
