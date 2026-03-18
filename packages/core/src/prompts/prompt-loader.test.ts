import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentId, AgentPromptConfig } from "../models/agent-prompt-config.js";
import { DEFAULT_PROMPTS } from "./defaults.js";
import {
	injectSlots,
	loadAllPrompts,
	loadPrompt,
	resetPrompt,
	savePrompt,
} from "./prompt-loader.js";

function makeTmpDir(): string {
	const dir = path.join(os.tmpdir(), `geo-prompt-test-${crypto.randomBytes(8).toString("hex")}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

let tmpDirs: string[] = [];

function trackTmpDir(): string {
	const dir = makeTmpDir();
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs = [];
});

function makeCustomConfig(overrides: Partial<AgentPromptConfig> = {}): AgentPromptConfig {
	return {
		agent_id: "orchestrator",
		display_name: "Custom Orchestrator",
		system_instruction: "Custom instruction",
		context_slots: [],
		model_preference: "gpt-4",
		temperature: 0.7,
		is_customized: true,
		last_modified: new Date().toISOString(),
		...overrides,
	};
}

describe("loadPrompt", () => {
	it("returns default prompt when no custom file exists", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "orchestrator");

		expect(result.agent_id).toBe("orchestrator");
		expect(result.display_name).toBe(DEFAULT_PROMPTS.orchestrator.display_name);
		expect(result.system_instruction).toBe(DEFAULT_PROMPTS.orchestrator.system_instruction);
	});

	it("returns prompt with is_customized: false for defaults", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "orchestrator");

		expect(result.is_customized).toBe(false);
	});

	it("returns prompt with last_modified as ISO string", () => {
		const workspace = trackTmpDir();
		const before = new Date().toISOString();
		const result = loadPrompt(workspace, "orchestrator");
		const after = new Date().toISOString();

		expect(result.last_modified).toBeDefined();
		expect(typeof result.last_modified).toBe("string");
		expect(result.last_modified >= before).toBe(true);
		expect(result.last_modified <= after).toBe(true);
	});

	it("default orchestrator has temperature 0.3", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "orchestrator");

		expect(result.temperature).toBe(0.3);
	});

	it("default analysis has temperature 0.3", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "analysis");

		expect(result.temperature).toBe(0.3);
	});

	it("default strategy has temperature 0.5", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "strategy");

		expect(result.temperature).toBe(0.5);
	});

	it("default validation has temperature 0.1", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "validation");

		expect(result.temperature).toBe(0.1);
	});

	it("default monitoring has temperature 0.2", () => {
		const workspace = trackTmpDir();
		const result = loadPrompt(workspace, "monitoring");

		expect(result.temperature).toBe(0.2);
	});

	it("loads custom prompt from file when exists", () => {
		const workspace = trackTmpDir();
		const custom = makeCustomConfig({
			agent_id: "orchestrator",
			display_name: "My Custom Orchestrator",
			system_instruction: "Do something custom",
			is_customized: true,
		});
		const promptDir = path.join(workspace, "prompts");
		fs.mkdirSync(promptDir, { recursive: true });
		fs.writeFileSync(path.join(promptDir, "orchestrator.json"), JSON.stringify(custom, null, 2));

		const result = loadPrompt(workspace, "orchestrator");

		expect(result.display_name).toBe("My Custom Orchestrator");
		expect(result.system_instruction).toBe("Do something custom");
		expect(result.is_customized).toBe(true);
	});

	it("custom prompt overrides default values", () => {
		const workspace = trackTmpDir();
		const custom = makeCustomConfig({
			agent_id: "analysis",
			display_name: "Overridden Analysis",
			temperature: 0.9,
			model_preference: "claude-3-opus",
			is_customized: true,
		});
		const promptDir = path.join(workspace, "prompts");
		fs.mkdirSync(promptDir, { recursive: true });
		fs.writeFileSync(path.join(promptDir, "analysis.json"), JSON.stringify(custom, null, 2));

		const result = loadPrompt(workspace, "analysis");

		expect(result.temperature).toBe(0.9);
		expect(result.model_preference).toBe("claude-3-opus");
		expect(result.display_name).toBe("Overridden Analysis");
	});

	it("falls back to default if custom file has invalid JSON", () => {
		const workspace = trackTmpDir();
		const promptDir = path.join(workspace, "prompts");
		fs.mkdirSync(promptDir, { recursive: true });
		fs.writeFileSync(path.join(promptDir, "orchestrator.json"), "{ this is not valid JSON !!!");

		const result = loadPrompt(workspace, "orchestrator");

		expect(result.agent_id).toBe("orchestrator");
		expect(result.is_customized).toBe(false);
		expect(result.display_name).toBe(DEFAULT_PROMPTS.orchestrator.display_name);
	});

	it("throws error for unknown agent ID", () => {
		const workspace = trackTmpDir();

		expect(() => loadPrompt(workspace, "nonexistent" as AgentId)).toThrow(
			"Unknown agent ID: nonexistent",
		);
	});
});

describe("savePrompt", () => {
	it("creates prompts directory if not exists", () => {
		const workspace = trackTmpDir();
		const promptDir = path.join(workspace, "prompts");

		expect(fs.existsSync(promptDir)).toBe(false);

		const config = makeCustomConfig();
		savePrompt(workspace, config);

		expect(fs.existsSync(promptDir)).toBe(true);
	});

	it("saves JSON file named {agent_id}.json", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({ agent_id: "strategy" });
		savePrompt(workspace, config);

		const filePath = path.join(workspace, "prompts", "strategy.json");
		expect(fs.existsSync(filePath)).toBe(true);
	});

	it("saved file contains valid JSON matching the config", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({
			agent_id: "analysis",
			display_name: "Saved Analysis",
			temperature: 0.42,
		});
		savePrompt(workspace, config);

		const filePath = path.join(workspace, "prompts", "analysis.json");
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);

		expect(parsed.agent_id).toBe("analysis");
		expect(parsed.display_name).toBe("Saved Analysis");
		expect(parsed.temperature).toBe(0.42);
		expect(parsed.is_customized).toBe(true);
	});

	it("overwrites existing file", () => {
		const workspace = trackTmpDir();
		const config1 = makeCustomConfig({
			agent_id: "monitoring",
			display_name: "First Version",
		});
		savePrompt(workspace, config1);

		const config2 = makeCustomConfig({
			agent_id: "monitoring",
			display_name: "Second Version",
		});
		savePrompt(workspace, config2);

		const filePath = path.join(workspace, "prompts", "monitoring.json");
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));

		expect(parsed.display_name).toBe("Second Version");
	});
});

describe("resetPrompt", () => {
	it("deletes custom file if exists", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({ agent_id: "orchestrator" });
		savePrompt(workspace, config);

		const filePath = path.join(workspace, "prompts", "orchestrator.json");
		expect(fs.existsSync(filePath)).toBe(true);

		resetPrompt(workspace, "orchestrator");

		expect(fs.existsSync(filePath)).toBe(false);
	});

	it("returns default prompt after reset", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({
			agent_id: "orchestrator",
			display_name: "Custom Name",
			temperature: 0.99,
		});
		savePrompt(workspace, config);

		const result = resetPrompt(workspace, "orchestrator");

		expect(result.display_name).toBe(DEFAULT_PROMPTS.orchestrator.display_name);
		expect(result.temperature).toBe(0.3);
		expect(result.is_customized).toBe(false);
	});

	it("works even if no custom file exists (no error)", () => {
		const workspace = trackTmpDir();

		expect(() => resetPrompt(workspace, "analysis")).not.toThrow();

		const result = resetPrompt(workspace, "analysis");
		expect(result.agent_id).toBe("analysis");
	});

	it("reset prompt has is_customized: false", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({
			agent_id: "validation",
			is_customized: true,
		});
		savePrompt(workspace, config);

		const result = resetPrompt(workspace, "validation");

		expect(result.is_customized).toBe(false);
	});
});

describe("loadAllPrompts", () => {
	it("returns exactly 6 prompts", () => {
		const workspace = trackTmpDir();
		const results = loadAllPrompts(workspace);

		expect(results).toHaveLength(6);
	});

	it("returns prompts in order: orchestrator, analysis, strategy, optimization, validation, monitoring", () => {
		const workspace = trackTmpDir();
		const results = loadAllPrompts(workspace);

		const expectedOrder: AgentId[] = [
			"orchestrator",
			"analysis",
			"strategy",
			"optimization",
			"validation",
			"monitoring",
		];

		expect(results.map((r) => r.agent_id)).toEqual(expectedOrder);
	});

	it("each prompt has correct agent_id", () => {
		const workspace = trackTmpDir();
		const results = loadAllPrompts(workspace);

		const agentIds = results.map((r) => r.agent_id);
		expect(agentIds).toContain("orchestrator");
		expect(agentIds).toContain("analysis");
		expect(agentIds).toContain("strategy");
		expect(agentIds).toContain("optimization");
		expect(agentIds).toContain("validation");
		expect(agentIds).toContain("monitoring");
	});

	it("all prompts have system_instruction containing Korean text", () => {
		const workspace = trackTmpDir();
		const results = loadAllPrompts(workspace);

		const koreanPattern = /[\uAC00-\uD7AF]/;
		for (const prompt of results) {
			expect(koreanPattern.test(prompt.system_instruction)).toBe(true);
		}
	});
});

describe("injectSlots", () => {
	it("replaces single slot", () => {
		const result = injectSlots("Hello {{NAME}}, welcome!", { "{{NAME}}": "World" });

		expect(result).toBe("Hello World, welcome!");
	});

	it("replaces multiple slots", () => {
		const result = injectSlots("{{GREETING}} {{NAME}}, you have {{COUNT}} messages.", {
			"{{GREETING}}": "Hi",
			"{{NAME}}": "Alice",
			"{{COUNT}}": "5",
		});

		expect(result).toBe("Hi Alice, you have 5 messages.");
	});

	it("replaces same slot appearing multiple times", () => {
		const result = injectSlots("{{X}} and {{X}} and {{X}}", { "{{X}}": "A" });

		expect(result).toBe("A and A and A");
	});

	it("returns unchanged string if no matching slots", () => {
		const original = "No slots here at all.";
		const result = injectSlots(original, { "{{MISSING}}": "value" });

		expect(result).toBe(original);
	});

	it("handles empty slotValues", () => {
		const original = "Hello {{NAME}}!";
		const result = injectSlots(original, {});

		expect(result).toBe(original);
	});

	it("handles slot value containing special regex characters", () => {
		const result = injectSlots("Pattern: {{PATTERN}}", { "{{PATTERN}}": "price is $100.00 (USD)" });

		expect(result).toBe("Pattern: price is $100.00 (USD)");
	});
});

describe("Integration", () => {
	it("save then load roundtrip preserves all fields", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({
			agent_id: "strategy",
			display_name: "Roundtrip Strategy",
			system_instruction: "Test instruction for roundtrip",
			context_slots: [
				{ slot_name: "{{TEST}}", description: "test slot", source: "TestSource", required: true },
			],
			model_preference: "claude-3-opus",
			temperature: 0.65,
			is_customized: true,
			last_modified: "2025-01-15T10:30:00.000Z",
		});

		savePrompt(workspace, config);
		const loaded = loadPrompt(workspace, "strategy");

		expect(loaded.agent_id).toBe(config.agent_id);
		expect(loaded.display_name).toBe(config.display_name);
		expect(loaded.system_instruction).toBe(config.system_instruction);
		expect(loaded.context_slots).toEqual(config.context_slots);
		expect(loaded.model_preference).toBe(config.model_preference);
		expect(loaded.temperature).toBe(config.temperature);
		expect(loaded.is_customized).toBe(config.is_customized);
		expect(loaded.last_modified).toBe(config.last_modified);
	});

	it("save then reset then load returns default", () => {
		const workspace = trackTmpDir();
		const config = makeCustomConfig({
			agent_id: "analysis",
			display_name: "Custom Analysis",
			temperature: 0.8,
			is_customized: true,
		});

		savePrompt(workspace, config);
		resetPrompt(workspace, "analysis");
		const loaded = loadPrompt(workspace, "analysis");

		expect(loaded.display_name).toBe(DEFAULT_PROMPTS.analysis.display_name);
		expect(loaded.temperature).toBe(0.3);
		expect(loaded.is_customized).toBe(false);
	});

	it("save multiple then loadAll returns mix of custom and default", () => {
		const workspace = trackTmpDir();

		const customOrchestrator = makeCustomConfig({
			agent_id: "orchestrator",
			display_name: "Custom Orchestrator",
			is_customized: true,
		});
		const customValidation = makeCustomConfig({
			agent_id: "validation",
			display_name: "Custom Validation",
			is_customized: true,
		});

		savePrompt(workspace, customOrchestrator);
		savePrompt(workspace, customValidation);

		const all = loadAllPrompts(workspace);

		const orchestrator = all.find((p) => p.agent_id === "orchestrator")!;
		expect(orchestrator.display_name).toBe("Custom Orchestrator");
		expect(orchestrator.is_customized).toBe(true);

		const validation = all.find((p) => p.agent_id === "validation")!;
		expect(validation.display_name).toBe("Custom Validation");
		expect(validation.is_customized).toBe(true);

		const analysis = all.find((p) => p.agent_id === "analysis")!;
		expect(analysis.display_name).toBe(DEFAULT_PROMPTS.analysis.display_name);
		expect(analysis.is_customized).toBe(false);

		const strategy = all.find((p) => p.agent_id === "strategy")!;
		expect(strategy.is_customized).toBe(false);

		const optimization = all.find((p) => p.agent_id === "optimization")!;
		expect(optimization.is_customized).toBe(false);

		const monitoring = all.find((p) => p.agent_id === "monitoring")!;
		expect(monitoring.is_customized).toBe(false);
	});
});
