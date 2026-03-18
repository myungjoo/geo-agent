import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── targets ──────────────────────────────────────────────
export const targets = sqliteTable("targets", {
	id: text("id").primaryKey(), // UUID
	url: text("url").notNull(),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	topics: text("topics", { mode: "json" }).notNull().default("[]"), // string[]
	target_queries: text("target_queries", { mode: "json" }).notNull().default("[]"),
	audience: text("audience").notNull().default(""),
	competitors: text("competitors", { mode: "json" }).notNull().default("[]"),
	business_goal: text("business_goal").notNull().default(""),
	llm_priorities: text("llm_priorities", { mode: "json" }).notNull().default("[]"),
	clone_base_path: text("clone_base_path"),
	site_type: text("site_type").notNull().default("generic"),
	notifications: text("notifications", { mode: "json" }),
	monitoring_interval: text("monitoring_interval").notNull().default("daily"),
	status: text("status").notNull().default("active"),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

// ─── content_snapshots ────────────────────────────────────
export const contentSnapshots = sqliteTable("content_snapshots", {
	snapshot_id: text("snapshot_id").primaryKey(),
	url: text("url").notNull(),
	captured_at: text("captured_at").notNull(),
	html_hash: text("html_hash").notNull(),
	content_text: text("content_text").notNull(),
	structured_data: text("structured_data", { mode: "json" }).notNull().default("{}"),
	geo_score: text("geo_score", { mode: "json" }),
	llm_responses: text("llm_responses", { mode: "json" }).notNull().default("[]"),
});

// ─── change_records ───────────────────────────────────────
export const changeRecords = sqliteTable("change_records", {
	change_id: text("change_id").primaryKey(),
	experiment_id: text("experiment_id").notNull(),
	url: text("url").notNull(),
	changed_at: text("changed_at").notNull(),
	change_type: text("change_type").notNull(),
	change_summary: text("change_summary").notNull(),
	diff: text("diff").notNull(),
	snapshot_before: text("snapshot_before").notNull(),
	snapshot_after: text("snapshot_after"),
	triggered_by: text("triggered_by").notNull().default("auto"),
	strategy_ref: text("strategy_ref"),
});

// ─── change_impacts ───────────────────────────────────────
export const changeImpacts = sqliteTable("change_impacts", {
	change_id: text("change_id").primaryKey(),
	measured_at: text("measured_at").notNull(),
	score_before: real("score_before").notNull(),
	score_after: real("score_after").notNull(),
	delta: real("delta").notNull(),
	delta_pct: real("delta_pct").notNull(),
	per_llm_impact: text("per_llm_impact", { mode: "json" }).notNull().default("{}"),
	confidence: real("confidence").notNull(),
	confounders: text("confounders", { mode: "json" }).notNull().default("[]"),
	verdict: text("verdict").notNull(),
});

// ─── geo_time_series ──────────────────────────────────────
export const geoTimeSeries = sqliteTable("geo_time_series", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	url: text("url").notNull(),
	llm_service: text("llm_service").notNull(),
	measured_at: text("measured_at").notNull(),
	geo_score: real("geo_score").notNull(),
	citation_rate: real("citation_rate").notNull(),
	citation_rank: integer("citation_rank"),
	change_id: text("change_id"),
	delta_score: real("delta_score").notNull().default(0),
});

// ─── pipeline_runs ────────────────────────────────────────
export const pipelineRuns = sqliteTable("pipeline_runs", {
	pipeline_id: text("pipeline_id").primaryKey(),
	target_id: text("target_id").notNull(),
	stage: text("stage").notNull(),
	started_at: text("started_at").notNull(),
	updated_at: text("updated_at").notNull(),
	completed_at: text("completed_at"),
	analysis_report_ref: text("analysis_report_ref"),
	optimization_plan_ref: text("optimization_plan_ref"),
	validation_report_ref: text("validation_report_ref"),
	retry_count: integer("retry_count").notNull().default(0),
	error_message: text("error_message"),
	resumable: integer("resumable", { mode: "boolean" }).notNull().default(false),
	resume_from_stage: text("resume_from_stage"),
});

// ─── error_events ─────────────────────────────────────────
export const errorEvents = sqliteTable("error_events", {
	error_id: text("error_id").primaryKey(),
	timestamp: text("timestamp").notNull(),
	agent_id: text("agent_id").notNull(),
	target_id: text("target_id").notNull(),
	error_type: text("error_type").notNull(),
	severity: text("severity").notNull(),
	message: text("message").notNull(),
	context: text("context", { mode: "json" }).notNull().default("{}"),
	resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
});
