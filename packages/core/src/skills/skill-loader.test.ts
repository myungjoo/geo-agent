import { describe, it, expect } from "vitest";
import { parseSkillMd, loadBuiltinSkill } from "./skill-loader.js";

describe("skill-loader", () => {
	describe("parseSkillMd", () => {
		it("should parse valid SKILL.md with all fields", () => {
			const content = `---
name: test-skill
description: A test skill
version: 1.0.0
tools:
  - tool1
  - tool2
  - tool3
output_format: json
---

# Test Skill

You are a test agent.`;

			const skill = parseSkillMd(content);
			expect(skill.name).toBe("test-skill");
			expect(skill.description).toBe("A test skill");
			expect(skill.version).toBe("1.0.0");
			expect(skill.tools).toEqual(["tool1", "tool2", "tool3"]);
			expect(skill.outputFormat).toBe("json");
			expect(skill.systemPrompt).toContain("# Test Skill");
			expect(skill.systemPrompt).toContain("You are a test agent.");
		});

		it("should parse inline list format", () => {
			const content = `---
name: inline-test
description: Inline list test
tools: [a, b, c]
---

Body text.`;

			const skill = parseSkillMd(content);
			expect(skill.tools).toEqual(["a", "b", "c"]);
		});

		it("should handle missing optional fields", () => {
			const content = `---
name: minimal
---

Minimal skill.`;

			const skill = parseSkillMd(content);
			expect(skill.name).toBe("minimal");
			expect(skill.description).toBe("");
			expect(skill.version).toBe("0.0.0");
			expect(skill.tools).toEqual([]);
			expect(skill.outputFormat).toBe("text");
		});

		it("should throw on missing frontmatter", () => {
			expect(() => parseSkillMd("no frontmatter here")).toThrow("missing frontmatter");
		});

		it("should handle empty tools list", () => {
			const content = `---
name: no-tools
tools:
---

No tools.`;

			const skill = parseSkillMd(content);
			// An empty `tools:` key with nothing following it
			expect(skill.tools).toEqual([]);
		});

		it("should preserve multiline body with markdown", () => {
			const content = `---
name: markdown-body
---

# Title

## Section 1

Paragraph text.

## Section 2

- Item 1
- Item 2

\`\`\`json
{ "key": "value" }
\`\`\``;

			const skill = parseSkillMd(content);
			expect(skill.systemPrompt).toContain("# Title");
			expect(skill.systemPrompt).toContain("## Section 1");
			expect(skill.systemPrompt).toContain("- Item 1");
			expect(skill.systemPrompt).toContain('"key": "value"');
		});
	});

	describe("loadBuiltinSkill", () => {
		it("should load the geo-analysis skill", () => {
			const skill = loadBuiltinSkill("geo-analysis");
			expect(skill.name).toBe("geo-analysis");
			expect(skill.tools).toContain("crawl_page");
			expect(skill.tools).toContain("score_geo");
			expect(skill.tools).toContain("classify_site");
			expect(skill.tools).toContain("extract_evaluation_data");
			expect(skill.tools).toContain("run_synthetic_probes");
			expect(skill.outputFormat).toBe("json");
			expect(skill.systemPrompt.length).toBeGreaterThan(100);
		});

		it("should throw for non-existent skill", () => {
			expect(() => loadBuiltinSkill("non-existent")).toThrow("not found");
		});
	});
});
