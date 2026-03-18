import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { CreateTarget, TargetProfile, UpdateTarget } from "../../models/target-profile.js";
import type { GeoDatabase } from "../connection.js";
import { targets } from "../schema.js";

const DEFAULT_NOTIFICATIONS = {
	on_score_drop: true,
	on_external_change: true,
	on_optimization_complete: true,
	channels: ["dashboard"] as const,
};

export class TargetRepository {
	constructor(private db: GeoDatabase) {}

	async findAll(): Promise<TargetProfile[]> {
		const rows = await this.db.select().from(targets);
		return rows.map(this.toModel);
	}

	async findById(id: string): Promise<TargetProfile | null> {
		const rows = await this.db.select().from(targets).where(eq(targets.id, id));
		return rows.length > 0 ? this.toModel(rows[0]) : null;
	}

	async create(input: CreateTarget): Promise<TargetProfile> {
		const now = new Date().toISOString();
		const record = {
			id: uuidv4(),
			url: input.url,
			name: input.name,
			description: input.description ?? "",
			topics: input.topics ?? [],
			target_queries: input.target_queries ?? [],
			audience: input.audience ?? "",
			competitors: input.competitors ?? [],
			business_goal: input.business_goal ?? "",
			llm_priorities: input.llm_priorities ?? [],
			clone_base_path: input.clone_base_path ?? null,
			site_type: input.site_type ?? "generic",
			notifications: input.notifications ?? DEFAULT_NOTIFICATIONS,
			monitoring_interval: input.monitoring_interval ?? "daily",
			status: "active",
			created_at: now,
			updated_at: now,
		};

		await this.db.insert(targets).values(record);
		return this.findById(record.id) as Promise<TargetProfile>;
	}

	async update(id: string, input: UpdateTarget): Promise<TargetProfile | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const updates: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		};

		if (input.url !== undefined) updates.url = input.url;
		if (input.name !== undefined) updates.name = input.name;
		if (input.description !== undefined) updates.description = input.description;
		if (input.topics !== undefined) updates.topics = input.topics;
		if (input.target_queries !== undefined) updates.target_queries = input.target_queries;
		if (input.audience !== undefined) updates.audience = input.audience;
		if (input.competitors !== undefined) updates.competitors = input.competitors;
		if (input.business_goal !== undefined) updates.business_goal = input.business_goal;
		if (input.llm_priorities !== undefined) updates.llm_priorities = input.llm_priorities;
		if (input.clone_base_path !== undefined) updates.clone_base_path = input.clone_base_path;
		if (input.site_type !== undefined) updates.site_type = input.site_type;
		if (input.notifications !== undefined) updates.notifications = input.notifications;
		if (input.monitoring_interval !== undefined)
			updates.monitoring_interval = input.monitoring_interval;

		await this.db.update(targets).set(updates).where(eq(targets.id, id));
		return this.findById(id);
	}

	async delete(id: string): Promise<boolean> {
		const existing = await this.findById(id);
		if (!existing) return false;
		await this.db.delete(targets).where(eq(targets.id, id));
		return true;
	}

	private toModel(row: typeof targets.$inferSelect): TargetProfile {
		return {
			id: row.id,
			url: row.url,
			name: row.name,
			description: row.description,
			topics: row.topics as string[],
			target_queries: row.target_queries as string[],
			audience: row.audience,
			competitors: row.competitors as TargetProfile["competitors"],
			business_goal: row.business_goal,
			llm_priorities: row.llm_priorities as TargetProfile["llm_priorities"],
			clone_base_path: row.clone_base_path,
			site_type: row.site_type as TargetProfile["site_type"],
			notifications: row.notifications as TargetProfile["notifications"],
			monitoring_interval: row.monitoring_interval as TargetProfile["monitoring_interval"],
			status: row.status as TargetProfile["status"],
			created_at: row.created_at,
			updated_at: row.updated_at,
		};
	}
}
