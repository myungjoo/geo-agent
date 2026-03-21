import fs from "node:fs";
import path from "node:path";
/**
 * Regression test: all LLM calls with json_mode: true must include
 * the word "json" (case-insensitive) in the prompt text.
 *
 * OpenAI Responses API (v1/responses) requires this when using
 * text.format.type = "json_object". Without it, the API returns 400.
 */
import { describe, expect, it } from "vitest";

function findJsonModeCalls(dir: string): Array<{ file: string; line: number; prompt: string }> {
	const results: Array<{ file: string; line: number; prompt: string }> = [];
	const files = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of files) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findJsonModeCalls(fullPath));
			continue;
		}
		if (
			!entry.name.endsWith(".ts") ||
			entry.name.includes(".test.") ||
			entry.name.includes(".d.ts")
		)
			continue;

		const content = fs.readFileSync(fullPath, "utf-8");
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			if (/json_mode:\s*true/.test(lines[i])) {
				// Search backward for the prompt in this LLM call block (up to 40 lines)
				// Include the whole block context to catch variable-based prompts
				const blockStart = Math.max(0, i - 40);
				const blockText = lines.slice(blockStart, i + 1).join("\n");

				// Also check if prompt is a variable reference — find the variable's content
				const varMatch = blockText.match(/prompt:\s*(\w+),/);
				let fullPromptText = blockText;
				if (varMatch) {
					const varName = varMatch[1];
					// Search the whole file for the variable assignment
					const varPattern = new RegExp(
						`(?:const|let|var)\\s+${varName}\\b[\\s\\S]*?(?=\\n\\s*(?:const|let|var|\\}|$))`,
						"m",
					);
					const varContent = content.match(varPattern);
					if (varContent) fullPromptText += `\n${varContent[0]}`;
				}

				results.push({ file: fullPath, line: i + 1, prompt: fullPromptText });
			}
		}
	}
	return results;
}

describe("json_mode safety", () => {
	const agentsDir = path.resolve(__dirname, "..");

	it("every json_mode:true call must have 'json' in the prompt text", () => {
		const calls = findJsonModeCalls(agentsDir);
		expect(calls.length).toBeGreaterThan(0);

		const violations: string[] = [];
		for (const call of calls) {
			// Check if prompt text contains "json" (case-insensitive)
			if (!/json/i.test(call.prompt)) {
				violations.push(`${call.file}:${call.line} — prompt does not contain 'json'`);
			}
		}

		if (violations.length > 0) {
			throw new Error(
				`Found ${violations.length} json_mode:true call(s) without 'json' in prompt:\n${violations.join("\n")}`,
			);
		}
	});
});
