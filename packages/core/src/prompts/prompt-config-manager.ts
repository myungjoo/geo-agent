/**
 * Unified Prompt Config Manager
 *
 * 전체 프롬프트의 조회/저장/리셋을 통합 관리.
 * 저장 경로: workspace/prompt-configs/{id}.json
 * 우선순위: custom file > default
 */
import fs from "node:fs";
import path from "node:path";
import {
	CATEGORY_ICONS,
	CATEGORY_LABELS,
	CATEGORY_ORDER,
	type PromptCategory,
	type PromptConfigGroup,
	type PromptConfigItem,
} from "../models/prompt-config.js";
import { getPromptDefaults } from "./prompt-defaults.js";

export class PromptConfigManager {
	private configDir: string;

	constructor(private workspaceDir: string) {
		this.configDir = path.join(workspaceDir, "prompt-configs");
	}

	/** Load single config (custom > default) */
	load(id: string): PromptConfigItem {
		const defaults = getPromptDefaults();
		const defaultItem = defaults[id];
		if (!defaultItem) {
			throw new Error(`Unknown prompt config ID: ${id}`);
		}

		const customPath = path.join(this.configDir, `${this.safeFilename(id)}.json`);
		if (fs.existsSync(customPath)) {
			try {
				const raw = JSON.parse(fs.readFileSync(customPath, "utf-8"));
				return {
					...defaultItem,
					...raw,
					id: defaultItem.id,
					category: defaultItem.category,
					is_customized: true,
				};
			} catch {
				// Fall through to default
			}
		}

		return { ...defaultItem };
	}

	/** Load all configs, optionally filtered by category */
	loadAll(category?: PromptCategory): PromptConfigItem[] {
		const defaults = getPromptDefaults();
		const items = Object.values(defaults);

		const filtered = category ? items.filter((i) => i.category === category) : items;

		return filtered.map((item) => this.load(item.id));
	}

	/** Load grouped by category (in display order) */
	loadGrouped(): PromptConfigGroup[] {
		const allItems = this.loadAll();
		const grouped = new Map<PromptCategory, PromptConfigItem[]>();

		for (const item of allItems) {
			const list = grouped.get(item.category) ?? [];
			list.push(item);
			grouped.set(item.category, list);
		}

		return CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => ({
			category: cat,
			label: CATEGORY_LABELS[cat],
			icon: CATEGORY_ICONS[cat],
			items: grouped.get(cat) ?? [],
		}));
	}

	/** Save customized config */
	save(config: Partial<PromptConfigItem> & { id: string }): PromptConfigItem {
		fs.mkdirSync(this.configDir, { recursive: true });

		const current = this.load(config.id);
		const updated: PromptConfigItem = {
			...current,
			...config,
			id: current.id,
			category: current.category,
			is_customized: true,
			last_modified: new Date().toISOString(),
		};

		const filePath = path.join(this.configDir, `${this.safeFilename(config.id)}.json`);
		fs.writeFileSync(
			filePath,
			JSON.stringify(
				{
					id: updated.id,
					prompt_template: updated.prompt_template,
					system_instruction: updated.system_instruction,
					is_customized: true,
					last_modified: updated.last_modified,
				},
				null,
				2,
			),
		);

		return updated;
	}

	/** Reset single to default */
	reset(id: string): PromptConfigItem {
		const customPath = path.join(this.configDir, `${this.safeFilename(id)}.json`);
		if (fs.existsSync(customPath)) {
			fs.unlinkSync(customPath);
		}
		return this.load(id);
	}

	/** Reset all in a category */
	resetCategory(category: PromptCategory): PromptConfigItem[] {
		const defaults = getPromptDefaults();
		const categoryItems = Object.values(defaults).filter((i) => i.category === category);
		for (const item of categoryItems) {
			this.reset(item.id);
		}
		return categoryItems.map((i) => this.load(i.id));
	}

	/** Reset all prompts */
	resetAll(): PromptConfigItem[] {
		if (fs.existsSync(this.configDir)) {
			const files = fs.readdirSync(this.configDir);
			for (const file of files) {
				if (file.endsWith(".json")) {
					fs.unlinkSync(path.join(this.configDir, file));
				}
			}
		}
		return this.loadAll();
	}

	/** Convert ID to safe filename (replace dots with underscores) */
	private safeFilename(id: string): string {
		return id.replace(/\./g, "_");
	}
}

/**
 * Resolve a prompt template by replacing {{VAR}} placeholders with values.
 */
export function resolvePrompt(template: string, variables: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(variables)) {
		const placeholder = key.startsWith("{{") ? key : `{{${key}}}`;
		result = result.replaceAll(placeholder, value);
	}
	return result;
}
