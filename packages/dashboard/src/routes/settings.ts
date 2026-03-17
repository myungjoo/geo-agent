import { Hono } from "hono";
import {
	loadSettings,
	type AgentId,
	AgentIdSchema,
} from "@geo-agent/core";
import {
	loadPrompt,
	savePrompt,
	resetPrompt,
	loadAllPrompts,
} from "@geo-agent/core/prompts/prompt-loader.js";
import { DEFAULT_PROMPTS } from "@geo-agent/core/prompts/defaults.js";

const settingsRouter = new Hono();

function getWorkspaceDir() {
	return loadSettings().workspace_dir;
}

// ── Agent Prompts ─────────────────────────────────────────

// GET /api/settings/agents/prompts — List all prompts
settingsRouter.get("/agents/prompts", (c) => {
	const prompts = loadAllPrompts(getWorkspaceDir());
	return c.json(prompts);
});

// GET /api/settings/agents/prompts/:agent_id — Get specific prompt
settingsRouter.get("/agents/prompts/:agent_id", (c) => {
	const agentId = c.req.param("agent_id");
	const parsed = AgentIdSchema.safeParse(agentId);
	if (!parsed.success) {
		return c.json({ error: "Invalid agent ID" }, 400);
	}
	const prompt = loadPrompt(getWorkspaceDir(), parsed.data);
	return c.json(prompt);
});

// PUT /api/settings/agents/prompts/:agent_id — Update prompt
settingsRouter.put("/agents/prompts/:agent_id", async (c) => {
	const agentId = c.req.param("agent_id");
	const parsed = AgentIdSchema.safeParse(agentId);
	if (!parsed.success) {
		return c.json({ error: "Invalid agent ID" }, 400);
	}

	const body = await c.req.json();
	const config = {
		...loadPrompt(getWorkspaceDir(), parsed.data),
		...body,
		agent_id: parsed.data,
		is_customized: true,
		last_modified: new Date().toISOString(),
	};

	savePrompt(getWorkspaceDir(), config);
	return c.json(config);
});

// POST /api/settings/agents/prompts/:agent_id/reset — Reset to default
settingsRouter.post("/agents/prompts/:agent_id/reset", (c) => {
	const agentId = c.req.param("agent_id");
	const parsed = AgentIdSchema.safeParse(agentId);
	if (!parsed.success) {
		return c.json({ error: "Invalid agent ID" }, 400);
	}

	const prompt = resetPrompt(getWorkspaceDir(), parsed.data);
	return c.json(prompt);
});

// POST /api/settings/agents/prompts/reset-all — Reset all to default
settingsRouter.post("/agents/prompts/reset-all", (c) => {
	const agentIds: AgentId[] = [
		"orchestrator", "analysis", "strategy",
		"optimization", "validation", "monitoring",
	];
	const results = agentIds.map((id) => resetPrompt(getWorkspaceDir(), id));
	return c.json(results);
});

// GET /api/settings/agents/prompts/:agent_id/default — Get default prompt (read-only)
settingsRouter.get("/agents/prompts/:agent_id/default", (c) => {
	const agentId = c.req.param("agent_id");
	const defaults = DEFAULT_PROMPTS[agentId];
	if (!defaults) {
		return c.json({ error: "Invalid agent ID" }, 400);
	}
	return c.json({ ...defaults, last_modified: "default" });
});

export { settingsRouter };
