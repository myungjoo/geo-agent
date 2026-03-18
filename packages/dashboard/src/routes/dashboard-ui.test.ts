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

	it("GET /dashboard contains prompt editing elements", async () => {
		const res = await app.request("/dashboard");
		const html = await res.text();
		expect(html).toContain("promptModal");
		expect(html).toContain("editPrompt");
		expect(html).toContain("resetAllPrompts");
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
