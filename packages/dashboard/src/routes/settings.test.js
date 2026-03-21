import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
const testDir = path.join(os.tmpdir(), `geo-settings-test-${Date.now()}`);
// Set env before any imports that use loadSettings
process.env.GEO_WORKSPACE = testDir;
// Ensure workspace directories exist
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });
// Create DB using production createDatabase (auto-creates tables via libsql)
const { createDatabase, loadSettings, ensureTables } = await import("@geo-agent/core");
const settings = loadSettings();
const db = createDatabase(settings);
await ensureTables(db);
// Now import the app (loadSettings will read GEO_WORKSPACE)
const { app } = await import("../server.js");
// ── Constants ──────────────────────────────────────────────────
const VALID_AGENT_IDS = [
	"orchestrator",
	"analysis",
	"strategy",
	"optimization",
	"validation",
	"monitoring",
];
// ── Helpers ────────────────────────────────────────────────────
function clearCustomPrompts() {
	const promptDir = path.join(testDir, "prompts");
	if (fs.existsSync(promptDir)) {
		const files = fs.readdirSync(promptDir);
		for (const file of files) {
			if (file.endsWith(".json")) {
				fs.unlinkSync(path.join(promptDir, file));
			}
		}
	}
}
// ── Tests ──────────────────────────────────────────────────────
afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});
beforeEach(() => {
	clearCustomPrompts();
});
// ── GET /api/settings/agents/prompts ───────────────────────────
describe("GET /api/settings/agents/prompts", () => {
	it("returns 200 with array of 6 prompts", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(6);
	});
	it("each prompt has agent_id and system_instruction", async () => {
		const res = await app.request("/api/settings/agents/prompts", { method: "GET" });
		expect(res.status).toBe(200);
		const body = await res.json();
		for (const prompt of body) {
			expect(prompt.agent_id).toBeDefined();
			expect(typeof prompt.agent_id).toBe("string");
			expect(VALID_AGENT_IDS).toContain(prompt.agent_id);
			expect(prompt.system_instruction).toBeDefined();
			expect(typeof prompt.system_instruction).toBe("string");
			expect(prompt.system_instruction.length).toBeGreaterThan(0);
		}
	});
});
// ── GET /api/settings/agents/prompts/:agent_id ─────────────────
describe("GET /api/settings/agents/prompts/:agent_id", () => {
	it("returns 200 for valid agent ID: orchestrator", async () => {
		const res = await app.request("/api/settings/agents/prompts/orchestrator", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("orchestrator");
		expect(body.system_instruction).toBeDefined();
		expect(body.display_name).toBeDefined();
	});
	it("returns 200 for valid agent ID: analysis", async () => {
		const res = await app.request("/api/settings/agents/prompts/analysis", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("analysis");
	});
	it("returns 200 for valid agent ID: strategy", async () => {
		const res = await app.request("/api/settings/agents/prompts/strategy", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("strategy");
	});
	it("returns 200 for valid agent ID: optimization", async () => {
		const res = await app.request("/api/settings/agents/prompts/optimization", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("optimization");
	});
	it("returns 200 for valid agent ID: validation", async () => {
		const res = await app.request("/api/settings/agents/prompts/validation", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("validation");
	});
	it("returns 200 for valid agent ID: monitoring", async () => {
		const res = await app.request("/api/settings/agents/prompts/monitoring", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("monitoring");
	});
	it("returns 400 for invalid agent ID", async () => {
		const res = await app.request("/api/settings/agents/prompts/nonexistent", {
			method: "GET",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid agent ID");
	});
});
// ── PUT /api/settings/agents/prompts/:agent_id ─────────────────
describe("PUT /api/settings/agents/prompts/:agent_id", () => {
	it("returns 200 with updated prompt", async () => {
		const res = await app.request("/api/settings/agents/prompts/orchestrator", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: "You are a custom orchestrator prompt.",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("orchestrator");
		expect(body.system_instruction).toBe("You are a custom orchestrator prompt.");
	});
	it("sets is_customized to true", async () => {
		const res = await app.request("/api/settings/agents/prompts/analysis", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: "Custom analysis instruction.",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.is_customized).toBe(true);
	});
	it("preserves fields not included in body", async () => {
		// First, get the default prompt to know original values
		const defaultRes = await app.request("/api/settings/agents/prompts/strategy", {
			method: "GET",
		});
		const defaultPrompt = await defaultRes.json();
		// Update only the system_instruction
		const updateRes = await app.request("/api/settings/agents/prompts/strategy", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: "Updated strategy instruction.",
			}),
		});
		expect(updateRes.status).toBe(200);
		const updated = await updateRes.json();
		expect(updated.system_instruction).toBe("Updated strategy instruction.");
		expect(updated.display_name).toBe(defaultPrompt.display_name);
		expect(updated.temperature).toBe(defaultPrompt.temperature);
		expect(updated.context_slots).toEqual(defaultPrompt.context_slots);
	});
	it("returns 400 for invalid agent ID", async () => {
		const res = await app.request("/api/settings/agents/prompts/invalid-agent", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: "Does not matter.",
			}),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid agent ID");
	});
});
// ── POST /api/settings/agents/prompts/:agent_id/reset ──────────
describe("POST /api/settings/agents/prompts/:agent_id/reset", () => {
	it("returns 200 with default prompt", async () => {
		// First customize, then reset
		await app.request("/api/settings/agents/prompts/orchestrator", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: "Temporary custom prompt.",
			}),
		});
		const res = await app.request("/api/settings/agents/prompts/orchestrator/reset", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("orchestrator");
		expect(body.system_instruction).not.toBe("Temporary custom prompt.");
		expect(body.system_instruction.length).toBeGreaterThan(0);
	});
	it("reset prompt has is_customized: false", async () => {
		// Customize first
		await app.request("/api/settings/agents/prompts/analysis", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: "Custom analysis.",
			}),
		});
		// Verify customized
		const customRes = await app.request("/api/settings/agents/prompts/analysis", {
			method: "GET",
		});
		const customBody = await customRes.json();
		expect(customBody.is_customized).toBe(true);
		// Reset
		const resetRes = await app.request("/api/settings/agents/prompts/analysis/reset", {
			method: "POST",
		});
		expect(resetRes.status).toBe(200);
		const body = await resetRes.json();
		expect(body.is_customized).toBe(false);
	});
	it("returns 400 for invalid agent ID", async () => {
		const res = await app.request("/api/settings/agents/prompts/fake-agent/reset", {
			method: "POST",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid agent ID");
	});
});
// ── POST /api/settings/agents/prompts/reset-all ────────────────
describe("POST /api/settings/agents/prompts/reset-all", () => {
	it("returns 200 with array of 6 prompts", async () => {
		// Customize a few prompts first
		await app.request("/api/settings/agents/prompts/orchestrator", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ system_instruction: "Custom 1" }),
		});
		await app.request("/api/settings/agents/prompts/analysis", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ system_instruction: "Custom 2" }),
		});
		const res = await app.request("/api/settings/agents/prompts/reset-all", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(6);
	});
	it("all prompts have is_customized: false after reset-all", async () => {
		// Customize all prompts
		for (const agentId of VALID_AGENT_IDS) {
			await app.request(`/api/settings/agents/prompts/${agentId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ system_instruction: `Custom ${agentId}` }),
			});
		}
		// Reset all
		const res = await app.request("/api/settings/agents/prompts/reset-all", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		for (const prompt of body) {
			expect(prompt.is_customized).toBe(false);
		}
	});
});
// ── GET /api/settings/agents/prompts/:agent_id/default ─────────
describe("GET /api/settings/agents/prompts/:agent_id/default", () => {
	it("returns 200 with default prompt", async () => {
		const res = await app.request("/api/settings/agents/prompts/orchestrator/default", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.agent_id).toBe("orchestrator");
		expect(body.system_instruction).toBeDefined();
		expect(body.display_name).toBeDefined();
	});
	it("last_modified is 'default'", async () => {
		const res = await app.request("/api/settings/agents/prompts/analysis/default", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.last_modified).toBe("default");
	});
	it("returns 400 for invalid agent ID", async () => {
		const res = await app.request("/api/settings/agents/prompts/bogus/default", {
			method: "GET",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid agent ID");
	});
});
// ── Integration: update -> get -> reset -> get ─────────────────
describe("Integration: update -> get -> reset -> get default flow", () => {
	it("PUT update -> GET returns updated -> POST reset -> GET returns default", async () => {
		const agentId = "optimization";
		// Step 1: Get the default prompt for later comparison
		const defaultRes = await app.request(`/api/settings/agents/prompts/${agentId}/default`, {
			method: "GET",
		});
		expect(defaultRes.status).toBe(200);
		const defaultPrompt = await defaultRes.json();
		// Step 2: Update the prompt
		const customInstruction =
			"This is a completely custom optimization prompt for integration testing.";
		const updateRes = await app.request(`/api/settings/agents/prompts/${agentId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: customInstruction,
				temperature: 0.9,
			}),
		});
		expect(updateRes.status).toBe(200);
		const updated = await updateRes.json();
		expect(updated.system_instruction).toBe(customInstruction);
		expect(updated.temperature).toBe(0.9);
		expect(updated.is_customized).toBe(true);
		// Step 3: GET should return the updated version
		const getRes = await app.request(`/api/settings/agents/prompts/${agentId}`, {
			method: "GET",
		});
		expect(getRes.status).toBe(200);
		const fetched = await getRes.json();
		expect(fetched.system_instruction).toBe(customInstruction);
		expect(fetched.temperature).toBe(0.9);
		expect(fetched.is_customized).toBe(true);
		// Step 4: Reset the prompt
		const resetRes = await app.request(`/api/settings/agents/prompts/${agentId}/reset`, {
			method: "POST",
		});
		expect(resetRes.status).toBe(200);
		const reset = await resetRes.json();
		expect(reset.is_customized).toBe(false);
		expect(reset.system_instruction).toBe(defaultPrompt.system_instruction);
		// Step 5: GET should now return the default prompt
		const afterResetRes = await app.request(`/api/settings/agents/prompts/${agentId}`, {
			method: "GET",
		});
		expect(afterResetRes.status).toBe(200);
		const afterReset = await afterResetRes.json();
		expect(afterReset.is_customized).toBe(false);
		expect(afterReset.system_instruction).toBe(defaultPrompt.system_instruction);
		expect(afterReset.temperature).toBe(defaultPrompt.temperature);
	});
});
//# sourceMappingURL=settings.test.js.map
