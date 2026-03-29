import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `geo-settings-test-${Date.now()}`);

// Set env before any imports that use loadSettings
process.env.GEO_WORKSPACE = testDir;

// Ensure workspace directories exist
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });

// Create DB using production createDatabase (auto-creates tables via libsql)
const { createDatabase, loadSettings, ensureTables } = await import("@geo-agent/core");
const settings = loadSettings();
const db = createDatabase(settings);
await ensureTables(db);

// Import the actual prompt constants for CL-1 verification
const {
	READABILITY_SYSTEM,
	CONTENT_QUALITY_SYSTEM,
	STRATEGY_SYSTEM,
	VALIDATION_SYSTEM,
	OPT_META_DESCRIPTION_SYSTEM,
} = await import("@geo-agent/core/prompts/runtime-prompts.js");

// Now import the app (loadSettings will read GEO_WORKSPACE)
const { app } = await import("../server.js");

// ── Constants ──────────────────────────────────────────────────

const EXPECTED_PROMPT_IDS = [
	"llm-analysis",
	"analysis-static",
	"strategy",
	"optimization",
	"validation",
] as const;

// ── Tests ──────────────────────────────────────────────────────

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

// ── GET /api/settings/agents/prompts ───────────────────────────

describe("GET /api/settings/agents/prompts", () => {
	it("returns 200 with array of 5 runtime prompts", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(5);
	});

	it("each prompt has RuntimePrompt schema fields", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		const body = await res.json();

		for (const prompt of body) {
			expect(typeof prompt.id).toBe("string");
			expect(typeof prompt.display_name).toBe("string");
			expect(typeof prompt.description).toBe("string");
			expect(["skill_md", "inline"]).toContain(prompt.source);
			expect(typeof prompt.source_file).toBe("string");
			expect(typeof prompt.system_instruction).toBe("string");
			expect(prompt.system_instruction.length).toBeGreaterThan(0);
			expect(prompt.readonly).toBe(true);
		}
	});

	it("returns all expected prompt IDs", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		const body = await res.json();
		const ids = body.map((p: { id: string }) => p.id);

		for (const expectedId of EXPECTED_PROMPT_IDS) {
			expect(ids).toContain(expectedId);
		}
	});
});

// ── CL-1: 실행 코드와 API 반환 데이터 일치 검증 ─────────────────

describe("CL-1: prompts API returns actual runtime prompts, not stubs", () => {
	it("llm-analysis prompt contains geo-analysis.skill.md content", async () => {
		const res = await app.request("/api/settings/agents/prompts/llm-analysis", {
			method: "GET",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.source).toBe("skill_md");
		// skill.md의 실제 내용 — 이 키워드는 geo-analysis.skill.md에만 존재
		expect(body.system_instruction).toContain("GEO");
		expect(body.system_instruction).toContain("10-tab");
		expect(body.system_instruction).toContain("crawl_page");
		expect(body.system_instruction.length).toBeGreaterThan(500);
	});

	it("analysis-static prompt matches exported READABILITY_SYSTEM constant", async () => {
		const res = await app.request("/api/settings/agents/prompts/analysis-static", {
			method: "GET",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.sub_prompts).toBeDefined();
		expect(body.sub_prompts.length).toBeGreaterThanOrEqual(2);

		// sub-prompt가 에이전트 파일의 export 상수와 동일해야 함
		expect(body.sub_prompts[0].system_instruction).toBe(READABILITY_SYSTEM);
		expect(body.sub_prompts[1].system_instruction).toBe(CONTENT_QUALITY_SYSTEM);
	});

	it("strategy prompt matches exported STRATEGY_SYSTEM constant", async () => {
		const res = await app.request("/api/settings/agents/prompts/strategy", {
			method: "GET",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.system_instruction).toBe(STRATEGY_SYSTEM);
	});

	it("optimization prompt sub_prompts include exported OPT constants", async () => {
		const res = await app.request("/api/settings/agents/prompts/optimization", {
			method: "GET",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.sub_prompts).toBeDefined();
		expect(body.sub_prompts.length).toBe(7);

		// 첫 번째 sub-prompt가 에이전트 파일의 export 상수와 동일해야 함
		expect(body.sub_prompts[0].system_instruction).toBe(OPT_META_DESCRIPTION_SYSTEM);
	});

	it("validation prompt matches exported VALIDATION_SYSTEM constant", async () => {
		const res = await app.request("/api/settings/agents/prompts/validation", {
			method: "GET",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.system_instruction).toBe(VALIDATION_SYSTEM);
	});
});

// ── CL-2: Placeholder / Dead Code 방지 ──────────────────────────

describe("CL-2: no placeholder or dead data", () => {
	it("no prompt contains placeholder text", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		const body = await res.json();

		for (const prompt of body) {
			const text = prompt.system_instruction.toLowerCase();
			expect(text).not.toContain("placeholder");
			expect(text).not.toContain("not implemented");
			// skill.md 로드 실패 메시지가 포함되면 안 됨
			expect(text).not.toContain("파일을 읽을 수 없습니다");
		}
	});
});

// ── CL-3: 읽기 전용 정합성 ───────────────────────────────────────

describe("CL-3: read-only consistency", () => {
	it("all prompts have readonly: true", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		const body = await res.json();

		for (const prompt of body) {
			expect(prompt.readonly).toBe(true);
		}
	});

	it("PUT endpoint no longer exists (removed edit capability)", async () => {
		const res = await app.request("/api/settings/agents/prompts/strategy", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ system_instruction: "should not work" }),
		});
		// Hono returns 404 for undefined routes
		expect(res.status).not.toBe(200);
	});

	it("POST reset endpoint no longer exists", async () => {
		const res = await app.request("/api/settings/agents/prompts/strategy/reset", {
			method: "POST",
		});
		expect(res.status).not.toBe(200);
	});
});

// ── GET /api/settings/agents/prompts/:agent_id ─────────────────

describe("GET /api/settings/agents/prompts/:agent_id", () => {
	it("returns 200 for valid runtime prompt ID", async () => {
		const res = await app.request("/api/settings/agents/prompts/llm-analysis", {
			method: "GET",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.id).toBe("llm-analysis");
		expect(body.display_name).toBeDefined();
	});

	it("returns 404 for unknown prompt ID", async () => {
		const res = await app.request("/api/settings/agents/prompts/nonexistent", {
			method: "GET",
		});
		expect(res.status).toBe(404);
	});

	it("returns 404 for old agent IDs (orchestrator, monitoring)", async () => {
		for (const oldId of ["orchestrator", "monitoring"]) {
			const res = await app.request(`/api/settings/agents/prompts/${oldId}`, {
				method: "GET",
			});
			expect(res.status).toBe(404);
		}
	});
});
