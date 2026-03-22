import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS } from "./defaults.js";

const EXPECTED_AGENT_IDS = [
	"orchestrator",
	"analysis",
	"strategy",
	"optimization",
	"validation",
	"monitoring",
] as const;

describe("DEFAULT_PROMPTS", () => {
	it("has all 6 agent prompts", () => {
		const keys = Object.keys(DEFAULT_PROMPTS);
		expect(keys).toHaveLength(6);
		for (const id of EXPECTED_AGENT_IDS) {
			expect(DEFAULT_PROMPTS[id]).toBeDefined();
		}
	});

	it("each prompt has required fields", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			const prompt = DEFAULT_PROMPTS[id];
			expect(prompt.agent_id).toBe(id);
			expect(prompt.display_name).toBeTruthy();
			expect(prompt.system_instruction).toBeTruthy();
			expect(prompt.context_slots).toBeInstanceOf(Array);
			expect(prompt.context_slots.length).toBeGreaterThanOrEqual(1);
			expect(prompt.is_customized).toBe(false);
			expect(typeof prompt.temperature).toBe("number");
		}
	});

	it("each prompt has non-empty system_instruction", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			const instruction = DEFAULT_PROMPTS[id].system_instruction;
			expect(instruction.length).toBeGreaterThan(50);
		}
	});

	it("system_instruction contains most required context_slot placeholders", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			const prompt = DEFAULT_PROMPTS[id];
			// Count how many required slots appear in the instruction
			const requiredSlots = prompt.context_slots.filter((s) => s.required);
			const foundSlots = requiredSlots.filter((s) =>
				prompt.system_instruction.includes(s.slot_name),
			);
			// At least half of the required slots should be in the instruction text
			// (some slots like AVAILABLE_TOOLS are injected externally for certain agents)
			expect(foundSlots.length).toBeGreaterThanOrEqual(Math.ceil(requiredSlots.length / 2));
		}
	});

	it("all context_slots have valid structure", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			for (const slot of DEFAULT_PROMPTS[id].context_slots) {
				expect(slot.slot_name).toMatch(/^\{\{[A-Z_]+\}\}$/);
				expect(slot.description).toBeTruthy();
				expect(slot.source).toBeTruthy();
				expect(typeof slot.required).toBe("boolean");
			}
		}
	});

	it("orchestrator has TARGET_PROFILE and PIPELINE_STATE slots", () => {
		const slots = DEFAULT_PROMPTS.orchestrator.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{TARGET_PROFILE}}");
		expect(slots).toContain("{{PIPELINE_STATE}}");
	});

	it("analysis has TARGET_PROFILE and AVAILABLE_TOOLS slots", () => {
		const slots = DEFAULT_PROMPTS.analysis.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{TARGET_PROFILE}}");
		expect(slots).toContain("{{AVAILABLE_TOOLS}}");
	});

	it("strategy has ANALYSIS_REPORT slot", () => {
		const slots = DEFAULT_PROMPTS.strategy.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{ANALYSIS_REPORT}}");
	});

	it("optimization has OPTIMIZATION_PLAN and CURRENT_SNAPSHOT slots", () => {
		const slots = DEFAULT_PROMPTS.optimization.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{OPTIMIZATION_PLAN}}");
		expect(slots).toContain("{{CURRENT_SNAPSHOT}}");
	});

	it("validation has CHANGE_RECORDS and SCORE_BEFORE slots", () => {
		const slots = DEFAULT_PROMPTS.validation.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{CHANGE_RECORDS}}");
		expect(slots).toContain("{{SCORE_BEFORE}}");
	});

	it("monitoring has ACTIVE_TARGETS slot", () => {
		const slots = DEFAULT_PROMPTS.monitoring.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{ACTIVE_TARGETS}}");
	});

	it("temperature is within valid range for all agents", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			const temp = DEFAULT_PROMPTS[id].temperature;
			expect(temp).toBeGreaterThanOrEqual(0);
			expect(temp).toBeLessThanOrEqual(2);
		}
	});

	it("model_preference defaults to null for all agents", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			expect(DEFAULT_PROMPTS[id].model_preference).toBeNull();
		}
	});

	it("display_name includes Korean description", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			const name = DEFAULT_PROMPTS[id].display_name;
			// Each display name has format "English (Korean)"
			expect(name).toMatch(/\(.+\)/);
		}
	});

	it("no duplicate slot_names within a single agent", () => {
		for (const id of EXPECTED_AGENT_IDS) {
			const slotNames = DEFAULT_PROMPTS[id].context_slots.map((s) => s.slot_name);
			const unique = new Set(slotNames);
			expect(unique.size).toBe(slotNames.length);
		}
	});

	it("all agents except monitoring have AVAILABLE_TOOLS slot", () => {
		const agentsWithTools = [
			"orchestrator",
			"analysis",
			"strategy",
			"optimization",
			"validation",
		] as const;
		for (const id of agentsWithTools) {
			const slots = DEFAULT_PROMPTS[id].context_slots.map((s) => s.slot_name);
			expect(slots).toContain("{{AVAILABLE_TOOLS}}");
		}
	});

	it("monitoring has AVAILABLE_TOOLS slot too", () => {
		const slots = DEFAULT_PROMPTS.monitoring.context_slots.map((s) => s.slot_name);
		expect(slots).toContain("{{AVAILABLE_TOOLS}}");
	});

	it("analysis prompt does not claim Playwright capability", () => {
		const instruction = DEFAULT_PROMPTS.analysis.system_instruction;
		expect(instruction).not.toContain("Playwright");
		expect(instruction).toContain("이중 크롤링");
	});
});
