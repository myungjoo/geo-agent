import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { GeoDatabase } from "../connection.js";
import { modelCostOverrides } from "../schema.js";

export interface ModelCostOverride {
	id: string;
	provider_id: string;
	model_id: string;
	input_per_1m: number;
	output_per_1m: number;
	cache_read_per_1m: number;
	cache_write_per_1m: number;
	note: string | null;
	is_default: boolean;
	created_at: string;
	updated_at: string;
}

export type ModelCostOverrideMap = Map<string, ModelCostOverride>;

/**
 * Default cost overrides for providers/models not in pi-ai's built-in registry.
 * Sources: official pricing pages as of 2025-Q4.
 */
const DEFAULT_OVERRIDES: Omit<ModelCostOverride, "id" | "created_at" | "updated_at">[] = [
	// ── Perplexity (maps to openai in pi-ai, but model IDs differ) ──────────
	{
		provider_id: "perplexity",
		model_id: "sonar",
		input_per_1m: 1.0,
		output_per_1m: 1.0,
		cache_read_per_1m: 0,
		cache_write_per_1m: 0,
		note: "Perplexity sonar (web search included)",
		is_default: true,
	},
	{
		provider_id: "perplexity",
		model_id: "sonar-pro",
		input_per_1m: 3.0,
		output_per_1m: 15.0,
		cache_read_per_1m: 0,
		cache_write_per_1m: 0,
		note: "Perplexity sonar-pro",
		is_default: true,
	},
	{
		provider_id: "perplexity",
		model_id: "sonar-reasoning",
		input_per_1m: 1.0,
		output_per_1m: 5.0,
		cache_read_per_1m: 0,
		cache_write_per_1m: 0,
		note: "Perplexity sonar-reasoning",
		is_default: true,
	},
	{
		provider_id: "perplexity",
		model_id: "sonar-reasoning-pro",
		input_per_1m: 2.0,
		output_per_1m: 8.0,
		cache_read_per_1m: 0,
		cache_write_per_1m: 0,
		note: "Perplexity sonar-reasoning-pro",
		is_default: true,
	},
	{
		provider_id: "perplexity",
		model_id: "sonar-deep-research",
		input_per_1m: 2.0,
		output_per_1m: 8.0,
		cache_read_per_1m: 0,
		cache_write_per_1m: 0,
		note: "Perplexity sonar-deep-research",
		is_default: true,
	},
	// ── Azure OpenAI — common deployment names that may differ from model IDs ──
	// Users often name Azure deployments the same as the model; these cover fallback
	{
		provider_id: "microsoft",
		model_id: "gpt-4o",
		input_per_1m: 2.5,
		output_per_1m: 10.0,
		cache_read_per_1m: 1.25,
		cache_write_per_1m: 0,
		note: "Azure OpenAI gpt-4o (same pricing as OpenAI)",
		is_default: true,
	},
	{
		provider_id: "microsoft",
		model_id: "gpt-4o-mini",
		input_per_1m: 0.15,
		output_per_1m: 0.6,
		cache_read_per_1m: 0.08,
		cache_write_per_1m: 0,
		note: "Azure OpenAI gpt-4o-mini",
		is_default: true,
	},
	{
		provider_id: "microsoft",
		model_id: "gpt-4.1",
		input_per_1m: 2.0,
		output_per_1m: 8.0,
		cache_read_per_1m: 0.5,
		cache_write_per_1m: 0,
		note: "Azure OpenAI gpt-4.1",
		is_default: true,
	},
	{
		provider_id: "microsoft",
		model_id: "gpt-4.1-mini",
		input_per_1m: 0.4,
		output_per_1m: 1.6,
		cache_read_per_1m: 0.1,
		cache_write_per_1m: 0,
		note: "Azure OpenAI gpt-4.1-mini",
		is_default: true,
	},
	{
		provider_id: "microsoft",
		model_id: "gpt-5.3-codex",
		input_per_1m: 1.75,
		output_per_1m: 14.0,
		cache_read_per_1m: 0.175,
		cache_write_per_1m: 0,
		note: "Azure OpenAI gpt-5.3-codex",
		is_default: true,
	},
	{
		provider_id: "microsoft",
		model_id: "o3",
		input_per_1m: 2.0,
		output_per_1m: 8.0,
		cache_read_per_1m: 0.5,
		cache_write_per_1m: 0,
		note: "Azure OpenAI o3",
		is_default: true,
	},
	{
		provider_id: "microsoft",
		model_id: "o4-mini",
		input_per_1m: 1.1,
		output_per_1m: 4.4,
		cache_read_per_1m: 0.28,
		cache_write_per_1m: 0,
		note: "Azure OpenAI o4-mini",
		is_default: true,
	},
];

export class ModelCostOverrideRepository {
	constructor(private db: GeoDatabase) {}

	async findAll(): Promise<ModelCostOverride[]> {
		const rows = await this.db
			.select()
			.from(modelCostOverrides)
			.orderBy(modelCostOverrides.provider_id, modelCostOverrides.model_id);
		return rows.map(this.toModel);
	}

	async findByProviderAndModel(
		providerId: string,
		modelId: string,
	): Promise<ModelCostOverride | null> {
		const rows = await this.db
			.select()
			.from(modelCostOverrides)
			.where(
				and(
					eq(modelCostOverrides.provider_id, providerId),
					eq(modelCostOverrides.model_id, modelId),
				),
			)
			.limit(1);
		return rows.length > 0 ? this.toModel(rows[0]) : null;
	}

	/** Build a lookup map keyed by "provider_id:model_id" for fast runtime access */
	async buildLookupMap(): Promise<ModelCostOverrideMap> {
		const all = await this.findAll();
		const map = new Map<string, ModelCostOverride>();
		for (const entry of all) {
			map.set(`${entry.provider_id}:${entry.model_id}`, entry);
		}
		return map;
	}

	async upsert(data: {
		provider_id: string;
		model_id: string;
		input_per_1m: number;
		output_per_1m: number;
		cache_read_per_1m: number;
		cache_write_per_1m: number;
		note?: string | null;
		is_default?: boolean;
	}): Promise<ModelCostOverride> {
		const existing = await this.findByProviderAndModel(data.provider_id, data.model_id);
		const now = new Date().toISOString();

		if (existing) {
			await this.db
				.update(modelCostOverrides)
				.set({
					input_per_1m: data.input_per_1m,
					output_per_1m: data.output_per_1m,
					cache_read_per_1m: data.cache_read_per_1m,
					cache_write_per_1m: data.cache_write_per_1m,
					note: data.note ?? existing.note,
					is_default: data.is_default ?? existing.is_default,
					updated_at: now,
				})
				.where(eq(modelCostOverrides.id, existing.id));
			return {
				...existing,
				...data,
				note: data.note ?? existing.note,
				is_default: data.is_default ?? existing.is_default,
				updated_at: now,
			};
		}

		const id = uuidv4();
		const row = {
			id,
			provider_id: data.provider_id,
			model_id: data.model_id,
			input_per_1m: data.input_per_1m,
			output_per_1m: data.output_per_1m,
			cache_read_per_1m: data.cache_read_per_1m,
			cache_write_per_1m: data.cache_write_per_1m,
			note: data.note ?? null,
			is_default: data.is_default ?? false,
			created_at: now,
			updated_at: now,
		};
		await this.db.insert(modelCostOverrides).values(row);
		return this.toModel(row);
	}

	async delete(id: string): Promise<void> {
		await this.db.delete(modelCostOverrides).where(eq(modelCostOverrides.id, id));
	}

	/** Seed default overrides — only inserts rows that don't exist yet */
	async seedDefaults(): Promise<void> {
		for (const def of DEFAULT_OVERRIDES) {
			const existing = await this.findByProviderAndModel(def.provider_id, def.model_id);
			if (!existing) {
				await this.upsert(def);
			}
		}
	}

	private toModel(row: typeof modelCostOverrides.$inferSelect): ModelCostOverride {
		return {
			id: row.id,
			provider_id: row.provider_id,
			model_id: row.model_id,
			input_per_1m: row.input_per_1m,
			output_per_1m: row.output_per_1m,
			cache_read_per_1m: row.cache_read_per_1m,
			cache_write_per_1m: row.cache_write_per_1m,
			note: row.note ?? null,
			is_default: row.is_default ?? false,
			created_at: row.created_at,
			updated_at: row.updated_at,
		};
	}
}
