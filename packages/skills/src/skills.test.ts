import { describe, expect, it } from "vitest";
import { createSkillRegistry, getBundledSkills } from "./index.js";
import type { SkillMetadata, SkillRegistry } from "./index.js";

// ─── createSkillRegistry ──────────────────────────────────────────

describe("createSkillRegistry", () => {
	it("returns an object with listSkills, getSkill, registerSkill, executeSkill methods", () => {
		const registry = createSkillRegistry();

		expect(typeof registry.listSkills).toBe("function");
		expect(typeof registry.getSkill).toBe("function");
		expect(typeof registry.registerSkill).toBe("function");
		expect(typeof registry.executeSkill).toBe("function");
	});

	it("listSkills() returns bundled skills by default", () => {
		const registry = createSkillRegistry();
		const skills = registry.listSkills();

		expect(Array.isArray(skills)).toBe(true);
		expect(skills.length).toBeGreaterThan(0);
		// All bundled skills should have tier "bundled"
		for (const skill of skills) {
			expect(skill.tier).toBe("bundled");
		}
	});

	it("includes expected bundled skill names", () => {
		const registry = createSkillRegistry();
		const names = registry.listSkills().map((s) => s.name);

		expect(names).toContain("dual-crawl");
		expect(names).toContain("schema-builder");
		expect(names).toContain("geo-scorer");
		expect(names).toContain("content-optimizer");
		expect(names).toContain("site-classifier");
		expect(names).toContain("diff-generator");
	});

	it("getSkill() returns bundled skill by name", () => {
		const registry = createSkillRegistry();
		const skill = registry.getSkill("dual-crawl");

		expect(skill).not.toBeNull();
		expect(skill!.name).toBe("dual-crawl");
		expect(skill!.tier).toBe("bundled");
		expect(skill!.version).toBe("1.0.0");
	});

	it("getSkill() returns null for a non-existent skill", () => {
		const registry = createSkillRegistry();
		const result = registry.getSkill("non-existent-skill");

		expect(result).toBeNull();
	});

	it("getSkill() with empty string returns null", () => {
		const registry = createSkillRegistry();
		const result = registry.getSkill("");

		expect(result).toBeNull();
	});

	it("multiple createSkillRegistry() calls return independent instances", () => {
		const registry1 = createSkillRegistry();
		const registry2 = createSkillRegistry();

		expect(registry1).not.toBe(registry2);

		// Both should have same bundled skills
		expect(registry1.listSkills().length).toBe(registry2.listSkills().length);

		// Their listSkills() return values should be separate array instances
		const list1 = registry1.listSkills();
		const list2 = registry2.listSkills();
		expect(list1).not.toBe(list2);
	});
});

// ─── registerSkill ──────────────────────────────────────────────

describe("registerSkill", () => {
	it("adds a new skill to the registry", () => {
		const registry = createSkillRegistry();
		const initialCount = registry.listSkills().length;

		registry.registerSkill({
			metadata: {
				name: "custom-skill",
				version: "1.0.0",
				description: "A custom skill",
				author: "test",
				tags: ["test"],
				tier: "workspace",
			},
			execute: async () => ({ success: true, duration_ms: 0 }),
		});

		expect(registry.listSkills().length).toBe(initialCount + 1);
		expect(registry.getSkill("custom-skill")).not.toBeNull();
		expect(registry.getSkill("custom-skill")!.tier).toBe("workspace");
	});
});

// ─── executeSkill ───────────────────────────────────────────────

describe("executeSkill", () => {
	it("returns error for non-existent skill", async () => {
		const registry = createSkillRegistry();
		const result = await registry.executeSkill("nonexistent", {
			target_id: "test",
			target_url: "https://example.com",
			workspace_dir: "/tmp",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});

	it("bundled skills return stub error (need agent integration)", async () => {
		const registry = createSkillRegistry();
		const result = await registry.executeSkill("dual-crawl", {
			target_id: "test",
			target_url: "https://example.com",
			workspace_dir: "/tmp",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("agent integration");
	});

	it("custom skill execution works", async () => {
		const registry = createSkillRegistry();
		registry.registerSkill({
			metadata: {
				name: "echo-skill",
				version: "1.0.0",
				description: "Echoes input",
				author: "test",
				tags: [],
				tier: "workspace",
			},
			execute: async (_ctx, params) => ({
				success: true,
				data: params,
				duration_ms: 0,
			}),
		});

		const result = await registry.executeSkill(
			"echo-skill",
			{
				target_id: "test",
				target_url: "https://example.com",
				workspace_dir: "/tmp",
			},
			{ message: "hello" },
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ message: "hello" });
	});
});

// ─── getBundledSkills ────────────────────────────────────────────

describe("getBundledSkills", () => {
	it("returns array of bundled skill metadata", () => {
		const skills = getBundledSkills();
		expect(Array.isArray(skills)).toBe(true);
		expect(skills.length).toBe(6);
	});

	it("each skill has required metadata fields", () => {
		const skills = getBundledSkills();
		for (const skill of skills) {
			expect(skill.name).toBeDefined();
			expect(skill.version).toBeDefined();
			expect(skill.description).toBeDefined();
			expect(skill.author).toBe("geo-agent");
			expect(Array.isArray(skill.tags)).toBe(true);
			expect(skill.tier).toBe("bundled");
		}
	});
});

// ─── SkillRegistry interface shape ────────────────────────────────

describe("SkillRegistry interface", () => {
	it("listSkills returns SkillMetadata[]", () => {
		const registry = createSkillRegistry();
		const skills: SkillMetadata[] = registry.listSkills();

		expect(Array.isArray(skills)).toBe(true);
	});

	it("getSkill returns SkillMetadata | null", () => {
		const registry = createSkillRegistry();
		const result: SkillMetadata | null = registry.getSkill("anything");

		expect(result).toBeNull();
	});

	it("registry satisfies the SkillRegistry interface", () => {
		const registry: SkillRegistry = createSkillRegistry();

		expect(registry).toBeDefined();
		expect(typeof registry.listSkills).toBe("function");
		expect(typeof registry.getSkill).toBe("function");
		expect(typeof registry.registerSkill).toBe("function");
		expect(typeof registry.executeSkill).toBe("function");
	});
});
