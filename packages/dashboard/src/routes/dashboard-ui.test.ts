import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `geo-dashboard-ui-test-${Date.now()}`);
process.env.GEO_WORKSPACE = testDir;

fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });

const { app } = await import("../server.js");

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

describe("Dashboard UI routes", () => {
	it("GET /dashboard returns HTML with correct content-type", async () => {
		const res = await app.request("/dashboard");
		expect(res.status).toBe(200);
		const contentType = res.headers.get("content-type");
		expect(contentType).toContain("text/html");
	});

	it("GET /dashboard contains GEO Agent Dashboard title", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("GEO Agent Dashboard");
	});

	it("GET /dashboard contains navigation tabs", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain('data-tab="targets"');
		expect(html).toContain('data-tab="pipelines"');
		expect(html).toContain('data-tab="prompts"');
		expect(html).toContain('data-tab="llm"');
	});

	it("GET /dashboard contains API interaction script", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("/api/targets");
		expect(html).toContain("/api/settings/agents/prompts");
		expect(html).toContain("/api/settings/llm-providers");
	});

	it("GET /dashboard contains target management elements", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("targetsBody");
		expect(html).toContain("targetModal");
		expect(html).toContain("showCreateTarget");
	});

	it("GET /dashboard contains pipeline management elements", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("pipelinesContent");
		expect(html).toContain("startPipeline");
		expect(html).toContain("stopPipeline");
	});

	it("GET /dashboard contains LLM provider elements", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("llmContent");
		expect(html).toContain("toggleProvider");
		expect(html).toContain("llmModal");
	});

	it("GET /dashboard contains read-only prompt display elements", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("promptsContent");
		expect(html).toContain("renderPrompts");
		expect(html).toContain("읽기 전용");
		// 레거시 에이전트 프롬프트 편집 모달이 제거되었음을 확인
		expect(html).not.toContain("promptModal");
		expect(html).not.toContain("resetAllPrompts");
	});

	it("GET /dashboard is dark themed", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("--bg: #0A0E1A");
		expect(html).toContain("--surface: #111827");
	});

	it("GET /dashboard contains health check script", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("checkHealth");
		expect(html).toContain("connectionStatus");
	});
});

describe("Root endpoint", () => {
	it("GET / includes dashboard link", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.dashboard).toBe("/dashboard");
		expect(json.version).toBe("0.3.0");
		expect(json.endpoints).toContain("/dashboard");
	});
});

describe("Dashboard — Multi-Provider Probe UI elements", () => {
	it("contains renderMultiProviderSummary function", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("function renderMultiProviderSummary(data)");
	});

	it("contains renderProbeEmptyState function", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("function renderProbeEmptyState(data)");
	});

	it("contains Single/Multi probe mode buttons", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("probe-mode-group");
		expect(html).toContain("startPipeline(");
		expect(html).toContain("'single'");
		expect(html).toContain("'multi'");
	});

	it("startPipeline function accepts probeMode parameter", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("function startPipeline(targetId, probeMode)");
		expect(html).toContain("probeMode || 'single'");
		expect(html).toContain("probe_mode=");
	});

	it("contains multi_provider_probes rendering in raw data tab", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("data.multi_provider_probes");
		expect(html).toContain("Multi-Provider Probes (A-0)");
	});

	it("contains provider_errors display section", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("mp.provider_errors");
		expect(html).toContain("Provider Errors");
	});

	it("renderProbeEmptyState shows LLM error details when available", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("Synthetic Probes 실행 실패");
		expect(html).toContain("LLM 호출 오류로 인해 프로브가 실행되지 않았습니다");
	});

	it("renderProbeEmptyState shows generic message when no errors", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("Synthetic Probe 결과 없음");
	});

	it("probe table supports error field display", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		// Individual probe error row
		expect(html).toContain("p.error");
		expect(html).toContain('colspan="8"');
	});
});

describe("Dashboard HTML resilience", () => {
	it("GET /dashboard returns valid HTML even when loaded from dist or src", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		// Must start with DOCTYPE or html tag
		expect(html).toMatch(/<!DOCTYPE html>|<html/i);
		// Must end properly
		expect(html).toContain("</html>");
	});

	it("GET /dashboard returns consistent content on repeated requests", async () => {
		const res1 = await app.request("/dashboard");
		const res2 = await app.request("/dashboard");
		const html1 = await res1.text();
		const html2 = await res2.text();
		expect(html1).toBe(html2);
	});
});
