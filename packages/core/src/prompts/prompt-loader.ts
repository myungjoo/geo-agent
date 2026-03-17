import fs from "node:fs";
import path from "node:path";
import type { AgentPromptConfig, AgentId } from "../models/agent-prompt-config.js";
import { DEFAULT_PROMPTS } from "./defaults.js";

/**
 * Loads a prompt config for a given agent.
 * Priority: workspace custom > default.
 */
export function loadPrompt(
	workspaceDir: string,
	agentId: AgentId,
): AgentPromptConfig {
	const customPath = path.join(
		workspaceDir,
		"prompts",
		`${agentId}.json`,
	);

	if (fs.existsSync(customPath)) {
		try {
			const raw = JSON.parse(fs.readFileSync(customPath, "utf-8"));
			return raw as AgentPromptConfig;
		} catch {
			// Fall through to default
		}
	}

	const defaults = DEFAULT_PROMPTS[agentId];
	if (!defaults) {
		throw new Error(`Unknown agent ID: ${agentId}`);
	}

	return {
		...defaults,
		last_modified: new Date().toISOString(),
	};
}

/**
 * Saves a custom prompt config to workspace.
 */
export function savePrompt(
	workspaceDir: string,
	config: AgentPromptConfig,
): void {
	const promptDir = path.join(workspaceDir, "prompts");
	fs.mkdirSync(promptDir, { recursive: true });

	const filePath = path.join(promptDir, `${config.agent_id}.json`);
	fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

/**
 * Resets a prompt to default by deleting the custom file.
 */
export function resetPrompt(
	workspaceDir: string,
	agentId: AgentId,
): AgentPromptConfig {
	const customPath = path.join(
		workspaceDir,
		"prompts",
		`${agentId}.json`,
	);

	if (fs.existsSync(customPath)) {
		fs.unlinkSync(customPath);
	}

	return loadPrompt(workspaceDir, agentId);
}

/**
 * Loads all agent prompt configs.
 */
export function loadAllPrompts(
	workspaceDir: string,
): AgentPromptConfig[] {
	const agentIds: AgentId[] = [
		"orchestrator",
		"analysis",
		"strategy",
		"optimization",
		"validation",
		"monitoring",
	];

	return agentIds.map((id) => loadPrompt(workspaceDir, id));
}

/**
 * Injects context slot values into a system instruction.
 */
export function injectSlots(
	instruction: string,
	slotValues: Record<string, string>,
): string {
	let result = instruction;
	for (const [slot, value] of Object.entries(slotValues)) {
		result = result.replaceAll(slot, value);
	}
	return result;
}
