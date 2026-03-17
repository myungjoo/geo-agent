import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { GeoDatabase } from "../connection.js";
import { targets } from "../schema.js";
import type { TargetProfile, CreateTarget, UpdateTarget } from "../../models/target-profile.js";

export class TargetRepository {
	constructor(private db: GeoDatabase) {}

	async findAll(): Promise<TargetProfile[]> {
		const rows = await this.db.select().from(targets);
		return rows.map(this.toModel);
	}

	async findById(id: string): Promise<TargetProfile | null> {
		const rows = await this.db
			.select()
			.from(targets)
			.where(eq(targets.id, id));
		return rows.length > 0 ? this.toModel(rows[0]) : null;
	}

	async create(input: CreateTarget): Promise<TargetProfile> {
		const now = new Date().toISOString();
		const record = {
			id: uuidv4(),
			url: input.url,
			name: input.name,
			description: input.description ?? "",
			topics: JSON.stringify(input.topics ?? []),
			target_queries: JSON.stringify(input.target_queries ?? []),
			audience: input.audience ?? "",
			competitors: JSON.stringify(input.competitors ?? []),
			business_goal: input.business_goal ?? "",
			llm_priorities: JSON.stringify(input.llm_priorities ?? []),
			deployment_mode: input.deployment_mode ?? "suggestion_only",
			deployment_config: input.deployment_config
				? JSON.stringify(input.deployment_config)
				: null,
			notifications: input.notifications
				? JSON.stringify(input.notifications)
				: null,
			monitoring_interval: input.monitoring_interval ?? "daily",
			created_at: now,
			updated_at: now,
		};

		await this.db.insert(targets).values(record);
		return this.findById(record.id) as Promise<TargetProfile>;
	}

	async update(
		id: string,
		input: UpdateTarget,
	): Promise<TargetProfile | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const updates: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		};

		if (input.url !== undefined) updates.url = input.url;
		if (input.name !== undefined) updates.name = input.name;
		if (input.description !== undefined) updates.description = input.description;
		if (input.topics !== undefined) updates.topics = JSON.stringify(input.topics);
		if (input.target_queries !== undefined)
			updates.target_queries = JSON.stringify(input.target_queries);
		if (input.audience !== undefined) updates.audience = input.audience;
		if (input.competitors !== undefined)
			updates.competitors = JSON.stringify(input.competitors);
		if (input.business_goal !== undefined)
			updates.business_goal = input.business_goal;
		if (input.llm_priorities !== undefined)
			updates.llm_priorities = JSON.stringify(input.llm_priorities);
		if (input.deployment_mode !== undefined)
			updates.deployment_mode = input.deployment_mode;
		if (input.deployment_config !== undefined)
			updates.deployment_config = JSON.stringify(input.deployment_config);
		if (input.notifications !== undefined)
			updates.notifications = JSON.stringify(input.notifications);
		if (input.monitoring_interval !== undefined)
			updates.monitoring_interval = input.monitoring_interval;

		await this.db.update(targets).set(updates).where(eq(targets.id, id));
		return this.findById(id);
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db
			.delete(targets)
			.where(eq(targets.id, id));
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
			deployment_mode: row.deployment_mode as TargetProfile["deployment_mode"],
			deployment_config: row.deployment_config as TargetProfile["deployment_config"],
			notifications: row.notifications as TargetProfile["notifications"],
			monitoring_interval: row.monitoring_interval as TargetProfile["monitoring_interval"],
			created_at: row.created_at,
			updated_at: row.updated_at,
		};
	}
}
