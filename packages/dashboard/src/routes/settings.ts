import {
	type AgentId,
	AgentIdSchema,
	type GeoDatabase,
	LLMProviderIdSchema,
	ModelCostOverrideRepository,
	PromptCategorySchema,
	PromptConfigManager,
	ProviderConfigManager,
	loadSettings,
} from "@geo-agent/core";
import { DEFAULT_PROMPTS } from "@geo-agent/core/prompts/defaults.js";
import {
	loadAllPrompts,
	loadPrompt,
	resetPrompt,
	savePrompt,
} from "@geo-agent/core/prompts/prompt-loader.js";
import { Hono } from "hono";

const settingsRouter = new Hono();

let sharedDb: GeoDatabase | null = null;

export function initSettingsRouter(db: GeoDatabase): void {
	sharedDb = db;
}

function getCostOverrideRepo(): ModelCostOverrideRepository {
	if (!sharedDb) throw new Error("Settings router not initialized");
	return new ModelCostOverrideRepository(sharedDb);
}

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
		"orchestrator",
		"analysis",
		"strategy",
		"optimization",
		"validation",
		"monitoring",
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

// ── Unified Prompt Configs (All Categories) ──────────────

// GET /api/settings/prompt-configs — All configs grouped by category
settingsRouter.get("/prompt-configs", (c) => {
	const manager = new PromptConfigManager(getWorkspaceDir());
	return c.json(manager.loadGrouped());
});

// GET /api/settings/prompt-configs/:id — Single config
settingsRouter.get("/prompt-configs/:id{.+}", (c) => {
	const id = c.req.param("id");
	try {
		const manager = new PromptConfigManager(getWorkspaceDir());
		return c.json(manager.load(id));
	} catch {
		return c.json({ error: `Unknown prompt config ID: ${id}` }, 400);
	}
});

// PUT /api/settings/prompt-configs/:id — Update prompt config
settingsRouter.put("/prompt-configs/:id{.+}", async (c) => {
	const id = c.req.param("id");
	try {
		const body = await c.req.json();
		const manager = new PromptConfigManager(getWorkspaceDir());
		const updated = manager.save({ ...body, id });
		return c.json(updated);
	} catch (err) {
		return c.json({ error: (err as Error).message }, 400);
	}
});

// POST /api/settings/prompt-configs/:id/reset — Reset single
settingsRouter.post("/prompt-configs/:id{.+}/reset", (c) => {
	const id = c.req.param("id");
	try {
		const manager = new PromptConfigManager(getWorkspaceDir());
		return c.json(manager.reset(id));
	} catch {
		return c.json({ error: `Unknown prompt config ID: ${id}` }, 400);
	}
});

// POST /api/settings/prompt-configs-reset-category/:category — Reset category
settingsRouter.post("/prompt-configs-reset-category/:category", (c) => {
	const category = c.req.param("category");
	const parsed = PromptCategorySchema.safeParse(category);
	if (!parsed.success) {
		return c.json({ error: "Invalid category" }, 400);
	}
	const manager = new PromptConfigManager(getWorkspaceDir());
	return c.json(manager.resetCategory(parsed.data));
});

// POST /api/settings/prompt-configs-reset-all — Reset all
settingsRouter.post("/prompt-configs-reset-all", (c) => {
	const manager = new PromptConfigManager(getWorkspaceDir());
	return c.json(manager.resetAll());
});

// ── LLM Providers ─────────────────────────────────────────

// GET /api/settings/llm-providers — List all provider settings
settingsRouter.get("/llm-providers", (c) => {
	const manager = new ProviderConfigManager(getWorkspaceDir());
	const providers = manager.loadAll();
	// API 키는 마스킹하여 반환
	const masked = providers.map((p) => ({
		...p,
		api_key: p.api_key
			? `${p.api_key.slice(0, 4)}${"*".repeat(Math.max(0, (p.api_key?.length ?? 0) - 4))}`
			: undefined,
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

// ── Model Cost Overrides ────────────────────────────────────

// GET /api/settings/cost-overrides — List all cost overrides
settingsRouter.get("/cost-overrides", async (c) => {
	const repo = getCostOverrideRepo();
	const overrides = await repo.findAll();
	return c.json(overrides);
});

// POST /api/settings/cost-overrides — Create or update an override (upsert by provider_id+model_id)
settingsRouter.post("/cost-overrides", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body.provider_id !== "string" || typeof body.model_id !== "string") {
		return c.json({ error: "provider_id and model_id are required" }, 400);
	}
	const inputPerM = Number(body.input_per_1m);
	const outputPerM = Number(body.output_per_1m);
	if (Number.isNaN(inputPerM) || Number.isNaN(outputPerM)) {
		return c.json({ error: "input_per_1m and output_per_1m must be numbers" }, 400);
	}
	const repo = getCostOverrideRepo();
	const result = await repo.upsert({
		provider_id: body.provider_id,
		model_id: body.model_id,
		input_per_1m: inputPerM,
		output_per_1m: outputPerM,
		cache_read_per_1m: Number(body.cache_read_per_1m) || 0,
		cache_write_per_1m: Number(body.cache_write_per_1m) || 0,
		note: body.note ?? null,
		is_default: false,
	});
	return c.json(result);
});

// PUT /api/settings/cost-overrides/:id — Update by id
settingsRouter.put("/cost-overrides/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body) return c.json({ error: "Invalid body" }, 400);

	const repo = getCostOverrideRepo();
	const all = await repo.findAll();
	const existing = all.find((o) => o.id === id);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const result = await repo.upsert({
		provider_id: existing.provider_id,
		model_id: existing.model_id,
		input_per_1m: Number(body.input_per_1m) ?? existing.input_per_1m,
		output_per_1m: Number(body.output_per_1m) ?? existing.output_per_1m,
		cache_read_per_1m: Number(body.cache_read_per_1m) ?? existing.cache_read_per_1m,
		cache_write_per_1m: Number(body.cache_write_per_1m) ?? existing.cache_write_per_1m,
		note: body.note !== undefined ? body.note : existing.note,
		is_default: false,
	});
	return c.json(result);
});

// DELETE /api/settings/cost-overrides/:id — Delete override
settingsRouter.delete("/cost-overrides/:id", async (c) => {
	const id = c.req.param("id");
	const repo = getCostOverrideRepo();
	await repo.delete(id);
	return c.json({ ok: true });
});

// POST /api/settings/cost-overrides/seed-defaults — Re-seed default values
settingsRouter.post("/cost-overrides/seed-defaults", async (c) => {
	const repo = getCostOverrideRepo();
	await repo.seedDefaults();
	const all = await repo.findAll();
	return c.json(all);
});

export { settingsRouter };
