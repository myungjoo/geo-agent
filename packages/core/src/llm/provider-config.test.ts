import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
	ProviderConfigManager,
	DEFAULT_PROVIDERS,
	LLMProviderIdSchema,
	LLMProviderSettingsSchema,
} from "./provider-config.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = path.join(
		os.tmpdir(),
		`geo-provider-test-${crypto.randomBytes(8).toString("hex")}`,
	);
	fs.mkdirSync(dir, { recursive: true });
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
	tmpDirs = [];
});

// ─── LLMProviderIdSchema ────────────────────────────────────────

describe("LLMProviderIdSchema", () => {
	it("validates all 6 correct provider IDs", () => {
		const ids = ["openai", "anthropic", "google", "perplexity", "microsoft", "meta"];
		for (const id of ids) {
			expect(LLMProviderIdSchema.parse(id)).toBe(id);
		}
	});

	it("rejects invalid provider IDs", () => {
		expect(() => LLMProviderIdSchema.parse("aws")).toThrow();
		expect(() => LLMProviderIdSchema.parse("")).toThrow();
		expect(() => LLMProviderIdSchema.parse("OpenAI")).toThrow();
		expect(() => LLMProviderIdSchema.parse("unknown")).toThrow();
	});
});

// ─── LLMProviderSettingsSchema ──────────────────────────────────

describe("LLMProviderSettingsSchema", () => {
	it("validates a complete settings object", () => {
		const settings = LLMProviderSettingsSchema.parse({
			provider_id: "openai",
			display_name: "OpenAI",
			enabled: true,
			auth_method: "api_key",
			api_key: "sk-test-123",
			api_base_url: "https://api.openai.com/v1",
			default_model: "gpt-4o",
			available_models: ["gpt-4o", "gpt-4o-mini"],
			max_tokens: 8192,
			temperature: 0.7,
			rate_limit_rpm: 120,
		});
		expect(settings.provider_id).toBe("openai");
		expect(settings.enabled).toBe(true);
		expect(settings.api_key).toBe("sk-test-123");
		expect(settings.max_tokens).toBe(8192);
		expect(settings.temperature).toBe(0.7);
	});

	it("applies defaults for optional fields", () => {
		const settings = LLMProviderSettingsSchema.parse({
			provider_id: "anthropic",
			display_name: "Anthropic",
			default_model: "claude-sonnet-4-6",
		});
		expect(settings.enabled).toBe(false);
		expect(settings.auth_method).toBe("api_key");
		expect(settings.available_models).toEqual([]);
		expect(settings.max_tokens).toBe(4096);
		expect(settings.temperature).toBe(0.3);
		expect(settings.rate_limit_rpm).toBe(60);
	});

	it("rejects invalid provider_id", () => {
		expect(() =>
			LLMProviderSettingsSchema.parse({
				provider_id: "invalid",
				display_name: "Invalid",
				default_model: "model-1",
			}),
		).toThrow();
	});

	it("rejects temperature out of range", () => {
		expect(() =>
			LLMProviderSettingsSchema.parse({
				provider_id: "openai",
				display_name: "OpenAI",
				default_model: "gpt-4o",
				temperature: 3.0,
			}),
		).toThrow();
	});

	it("rejects negative max_tokens", () => {
		expect(() =>
			LLMProviderSettingsSchema.parse({
				provider_id: "openai",
				display_name: "OpenAI",
				default_model: "gpt-4o",
				max_tokens: -1,
			}),
		).toThrow();
	});

	it("accepts oauth auth_method", () => {
		const settings = LLMProviderSettingsSchema.parse({
			provider_id: "google",
			display_name: "Google AI",
			default_model: "gemini-2.0-flash",
			auth_method: "oauth",
		});
		expect(settings.auth_method).toBe("oauth");
	});

	it("rejects invalid auth_method", () => {
		expect(() =>
			LLMProviderSettingsSchema.parse({
				provider_id: "openai",
				display_name: "OpenAI",
				default_model: "gpt-4o",
				auth_method: "bearer_token",
			}),
		).toThrow();
	});
});

// ─── DEFAULT_PROVIDERS ──────────────────────────────────────────

describe("DEFAULT_PROVIDERS", () => {
	it("has 6 entries", () => {
		expect(DEFAULT_PROVIDERS).toHaveLength(6);
	});

	it("contains all expected provider IDs", () => {
		const ids = DEFAULT_PROVIDERS.map((p) => p.provider_id);
		expect(ids).toContain("openai");
		expect(ids).toContain("anthropic");
		expect(ids).toContain("google");
		expect(ids).toContain("perplexity");
		expect(ids).toContain("microsoft");
		expect(ids).toContain("meta");
	});

	it("only openai is enabled by default", () => {
		const enabled = DEFAULT_PROVIDERS.filter((p) => p.enabled);
		expect(enabled).toHaveLength(1);
		expect(enabled[0].provider_id).toBe("openai");
	});

	it("all entries validate against LLMProviderSettingsSchema", () => {
		for (const provider of DEFAULT_PROVIDERS) {
			const result = LLMProviderSettingsSchema.safeParse(provider);
			expect(result.success).toBe(true);
		}
	});
});

// ─── ProviderConfigManager ──────────────────────────────────────

describe("ProviderConfigManager", () => {
	let manager: ProviderConfigManager;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		manager = new ProviderConfigManager(tmpDir);
	});

	describe("loadAll", () => {
		it("returns default providers when no file exists", () => {
			const providers = manager.loadAll();

			expect(providers).toHaveLength(6);
			expect(providers[0].provider_id).toBe("openai");
			expect(providers[0].enabled).toBe(true);
		});

		it("returns defaults when config file is malformed JSON", () => {
			fs.writeFileSync(
				path.join(tmpDir, "llm-providers.json"),
				"not valid json!!",
			);

			const providers = manager.loadAll();
			expect(providers).toHaveLength(6);
		});

		it("returns a copy, not a reference to DEFAULT_PROVIDERS", () => {
			const providers = manager.loadAll();
			providers[0].enabled = false;

			const again = manager.loadAll();
			// Should still be true from default
			expect(again[0].enabled).toBe(true);
		});
	});

	describe("load", () => {
		it("returns specific provider from defaults", () => {
			const anthropic = manager.load("anthropic");

			expect(anthropic.provider_id).toBe("anthropic");
			expect(anthropic.display_name).toBe("Anthropic");
			expect(anthropic.enabled).toBe(false);
		});

		it("returns provider from saved config", () => {
			const settings = manager.load("openai");
			settings.api_key = "sk-my-key";
			manager.save(settings);

			const loaded = manager.load("openai");
			expect(loaded.api_key).toBe("sk-my-key");
		});
	});

	describe("save", () => {
		it("persists provider config to file", () => {
			const openai = manager.load("openai");
			openai.api_key = "sk-saved-key";
			openai.temperature = 0.9;
			manager.save(openai);

			// Read directly from file
			const filePath = path.join(tmpDir, "llm-providers.json");
			expect(fs.existsSync(filePath)).toBe(true);

			const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			const saved = raw.find(
				(p: { provider_id: string }) => p.provider_id === "openai",
			);
			expect(saved.api_key).toBe("sk-saved-key");
			expect(saved.temperature).toBe(0.9);
		});

		it("preserves other providers when saving one", () => {
			const anthropic = manager.load("anthropic");
			anthropic.enabled = true;
			manager.save(anthropic);

			const all = manager.loadAll();
			const openai = all.find((p) => p.provider_id === "openai");
			expect(openai?.enabled).toBe(true); // Still enabled
			expect(openai?.default_model).toBe("gpt-4o");
		});
	});

	describe("setEnabled", () => {
		it("changes enabled state to true", () => {
			const result = manager.setEnabled("anthropic", true);

			expect(result.enabled).toBe(true);
			expect(result.provider_id).toBe("anthropic");

			// Verify persisted
			const loaded = manager.load("anthropic");
			expect(loaded.enabled).toBe(true);
		});

		it("changes enabled state to false", () => {
			const result = manager.setEnabled("openai", false);

			expect(result.enabled).toBe(false);

			const loaded = manager.load("openai");
			expect(loaded.enabled).toBe(false);
		});
	});

	describe("getEnabled", () => {
		it("returns only enabled providers", () => {
			const enabled = manager.getEnabled();

			expect(enabled).toHaveLength(1);
			expect(enabled[0].provider_id).toBe("openai");
		});

		it("reflects changes after enabling more providers", () => {
			manager.setEnabled("anthropic", true);
			manager.setEnabled("google", true);

			const enabled = manager.getEnabled();

			expect(enabled).toHaveLength(3);
			const ids = enabled.map((p) => p.provider_id);
			expect(ids).toContain("openai");
			expect(ids).toContain("anthropic");
			expect(ids).toContain("google");
		});

		it("returns empty array when all are disabled", () => {
			manager.setEnabled("openai", false);

			const enabled = manager.getEnabled();
			expect(enabled).toHaveLength(0);
		});
	});

	describe("reset", () => {
		it("restores default for one provider", () => {
			// Modify openai settings
			const openai = manager.load("openai");
			openai.api_key = "sk-custom";
			openai.temperature = 1.5;
			openai.enabled = false;
			manager.save(openai);

			// Reset
			const restored = manager.reset("openai");

			expect(restored.api_key).toBeUndefined();
			expect(restored.temperature).toBe(0.3);
			expect(restored.enabled).toBe(true);
		});

		it("does not affect other providers", () => {
			manager.setEnabled("anthropic", true);
			manager.reset("openai");

			const anthropic = manager.load("anthropic");
			expect(anthropic.enabled).toBe(true);
		});

		it("throws for unknown provider", () => {
			expect(() =>
				manager.reset("unknown" as never),
			).toThrow("Unknown provider");
		});
	});

	describe("resetAll", () => {
		it("restores all defaults", () => {
			// Modify multiple providers
			manager.setEnabled("anthropic", true);
			manager.setEnabled("google", true);
			const openai = manager.load("openai");
			openai.api_key = "sk-modified";
			manager.save(openai);

			// Reset all
			const restored = manager.resetAll();

			expect(restored).toHaveLength(6);

			const enabledCount = restored.filter((p) => p.enabled).length;
			expect(enabledCount).toBe(1);

			const restoredOpenai = restored.find((p) => p.provider_id === "openai");
			expect(restoredOpenai?.api_key).toBeUndefined();
			expect(restoredOpenai?.enabled).toBe(true);

			const restoredAnthropic = restored.find(
				(p) => p.provider_id === "anthropic",
			);
			expect(restoredAnthropic?.enabled).toBe(false);
		});

		it("persists the reset to file", () => {
			manager.setEnabled("anthropic", true);
			manager.resetAll();

			// Create new manager to read from disk
			const freshManager = new ProviderConfigManager(tmpDir);
			const anthropic = freshManager.load("anthropic");
			expect(anthropic.enabled).toBe(false);
		});
	});
});
