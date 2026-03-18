import { Hono } from "hono";
import {
	loadSettings,
	type AgentId,
	AgentIdSchema,
	ProviderConfigManager,
	LLMProviderIdSchema,
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

// ── LLM Providers ─────────────────────────────────────────

// GET /api/settings/llm-providers — List all provider settings
settingsRouter.get("/llm-providers", (c) => {
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const providers = manager.loadAll();
	// API 키는 마스킹하여 반환
	const masked = providers.map((p) => ({
		...p,
		api_key: p.api_key ? `${p.api_key.slice(0, 4)}${"*".repeat(Math.max(0, (p.api_key?.length ?? 0) - 4))}` : undefined,
	}));
	return c.json(masked);
});

// GET /api/settings/llm-providers/:provider_id — Get specific provider
settingsRouter.get("/llm-providers/:provider_id", (c) => {
	const providerId = c.req.param("provider_id");
	const parsed = LLMProviderIdSchema.safeParse(providerId);
	if (!parsed.success) {
		return c.json({ error: "Invalid provider ID" }, 400);
	}
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const provider = manager.load(parsed.data);
	// API 키 마스킹
	if (provider.api_key) {
		provider.api_key = `${provider.api_key.slice(0, 4)}${"*".repeat(Math.max(0, provider.api_key.length - 4))}`;
	}
	return c.json(provider);
});

// PUT /api/settings/llm-providers/:provider_id — Update provider
settingsRouter.put("/llm-providers/:provider_id", async (c) => {
	const providerId = c.req.param("provider_id");
	const parsed = LLMProviderIdSchema.safeParse(providerId);
	if (!parsed.success) {
		return c.json({ error: "Invalid provider ID" }, 400);
	}

	const body = await c.req.json();
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const existing = manager.load(parsed.data);
	const updated = { ...existing, ...body, provider_id: parsed.data };
	manager.save(updated);
	return c.json({ ...updated, api_key: updated.api_key ? "***" : undefined });
});

// POST /api/settings/llm-providers/:provider_id/enable — Enable provider
settingsRouter.post("/llm-providers/:provider_id/enable", (c) => {
	const providerId = c.req.param("provider_id");
	const parsed = LLMProviderIdSchema.safeParse(providerId);
	if (!parsed.success) {
		return c.json({ error: "Invalid provider ID" }, 400);
	}
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const result = manager.setEnabled(parsed.data, true);
	return c.json(result);
});

// POST /api/settings/llm-providers/:provider_id/disable — Disable provider
settingsRouter.post("/llm-providers/:provider_id/disable", (c) => {
	const providerId = c.req.param("provider_id");
	const parsed = LLMProviderIdSchema.safeParse(providerId);
	if (!parsed.success) {
		return c.json({ error: "Invalid provider ID" }, 400);
	}
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const result = manager.setEnabled(parsed.data, false);
	return c.json(result);
});

// POST /api/settings/llm-providers/:provider_id/reset — Reset to default
settingsRouter.post("/llm-providers/:provider_id/reset", (c) => {
	const providerId = c.req.param("provider_id");
	const parsed = LLMProviderIdSchema.safeParse(providerId);
	if (!parsed.success) {
		return c.json({ error: "Invalid provider ID" }, 400);
	}
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const result = manager.reset(parsed.data);
	return c.json(result);
});

// POST /api/settings/llm-providers/reset-all — Reset all providers
settingsRouter.post("/llm-providers/reset-all", (c) => {
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const results = manager.resetAll();
	return c.json(results);
});

export { settingsRouter };
