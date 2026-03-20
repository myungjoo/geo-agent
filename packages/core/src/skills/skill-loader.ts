/**
 * Skill Loader — Parses SKILL.md files (openclaw pattern)
 *
 * SKILL.md format:
 *   ---
 *   name: skill-name
 *   description: ...
 *   version: ...
 *   tools: [tool1, tool2]
 *   output_format: json
 *   ---
 *   # Prompt body (markdown)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillDefinition {
	name: string;
	description: string;
	version: string;
	tools: string[];
	outputFormat: string;
	systemPrompt: string;
}

/**
 * Parse a SKILL.md file into a SkillDefinition.
 */
export function parseSkillMd(content: string): SkillDefinition {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!frontmatterMatch) {
		throw new Error("Invalid SKILL.md: missing frontmatter delimiters (---)");
	}

	const [, frontmatterStr, body] = frontmatterMatch;
	const frontmatter = parseSimpleYaml(frontmatterStr);

	return {
		name: frontmatter.name ?? "unnamed",
		description: frontmatter.description ?? "",
		version: frontmatter.version ?? "0.0.0",
		tools: frontmatter.tools ?? [],
		outputFormat: frontmatter.output_format ?? "text",
		systemPrompt: body.trim(),
	};
}

/**
 * Minimal YAML parser for frontmatter (handles strings, lists, numbers).
 * Not a full YAML parser — just enough for SKILL.md frontmatter.
 */
function parseSimpleYaml(yaml: string): Record<string, any> {
	const result: Record<string, any> = {};
	let currentKey: string | null = null;
	let currentList: string[] | null = null;

	for (const line of yaml.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		// List item
		if (trimmed.startsWith("- ") && currentKey) {
			if (!currentList) currentList = [];
			currentList.push(trimmed.slice(2).trim());
			continue;
		}

		// Flush previous list
		if (currentList && currentKey) {
			result[currentKey] = currentList;
			currentList = null;
		}

		// Key: value
		const kvMatch = trimmed.match(/^(\w[\w_]*):\s*(.*)$/);
		if (kvMatch) {
			const [, key, value] = kvMatch;
			currentKey = key;
			if (value === "") {
				// Might be followed by list items
				continue;
			}
			// Inline list: [a, b, c]
			const inlineList = value.match(/^\[(.*)\]$/);
			if (inlineList) {
				result[key] = inlineList[1].split(",").map((s) => s.trim()).filter(Boolean);
			} else {
				result[key] = value;
			}
		}
	}

	// Flush final list
	if (currentList && currentKey) {
		result[currentKey] = currentList;
	}

	return result;
}

/**
 * Load a built-in skill by name from the skills directory.
 */
export function loadBuiltinSkill(skillName: string): SkillDefinition {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const skillPath = path.join(__dirname, `${skillName}.skill.md`);

	if (!fs.existsSync(skillPath)) {
		throw new Error(`Built-in skill "${skillName}" not found at ${skillPath}`);
	}

	return parseSkillMd(fs.readFileSync(skillPath, "utf-8"));
}

/**
 * Load a skill from an arbitrary file path.
 */
export function loadSkillFromFile(filePath: string): SkillDefinition {
	if (!fs.existsSync(filePath)) {
		throw new Error(`Skill file not found: ${filePath}`);
	}
	return parseSkillMd(fs.readFileSync(filePath, "utf-8"));
}
