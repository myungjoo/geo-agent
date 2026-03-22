/**
 * Pipeline Repository
 *
 * Pipeline 실행 상태를 DB에 저장/조회/업데이트
 */
import { desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { PipelineStage, PipelineState } from "../../models/pipeline-state.js";
import type { GeoDatabase } from "../connection.js";
import { pipelineRuns } from "../schema.js";

export class PipelineRepository {
	constructor(private db: GeoDatabase) {}

	async findById(pipelineId: string): Promise<PipelineState | null> {
		const rows = await this.db
			.select()
			.from(pipelineRuns)
			.where(eq(pipelineRuns.pipeline_id, pipelineId));
		return rows.length > 0 ? this.toModel(rows[0]) : null;
	}

	async findByTargetId(targetId: string): Promise<PipelineState[]> {
		const rows = await this.db
			.select()
			.from(pipelineRuns)
			.where(eq(pipelineRuns.target_id, targetId))
			.orderBy(desc(pipelineRuns.started_at));
		return rows.map(this.toModel);
	}

	async findLatestByTargetId(targetId: string): Promise<PipelineState | null> {
		const rows = await this.db
			.select()
			.from(pipelineRuns)
			.where(eq(pipelineRuns.target_id, targetId))
			.orderBy(desc(pipelineRuns.started_at))
			.limit(1);
		return rows.length > 0 ? this.toModel(rows[0]) : null;
	}

	async create(targetId: string): Promise<PipelineState> {
		const now = new Date().toISOString();
		const record = {
			pipeline_id: uuidv4(),
			target_id: targetId,
			stage: "INIT" as const,
			started_at: now,
			updated_at: now,
			completed_at: null,
			analysis_report_ref: null,
			optimization_plan_ref: null,
			validation_report_ref: null,
			retry_count: 0,
			error_message: null,
			resumable: false,
			resume_from_stage: null,
		};

		await this.db.insert(pipelineRuns).values(record);
		return this.findById(record.pipeline_id) as Promise<PipelineState>;
	}

	async updateStage(pipelineId: string, stage: PipelineStage): Promise<PipelineState | null> {
		const existing = await this.findById(pipelineId);
		if (!existing) return null;

		const now = new Date().toISOString();
		const updates: Record<string, unknown> = {
			stage,
			updated_at: now,
		};

		if (
			stage === "COMPLETED" ||
			stage === "FAILED" ||
			stage === "PARTIAL_FAILURE" ||
			stage === "STOPPED"
		) {
			updates.completed_at = now;
		}

		await this.db.update(pipelineRuns).set(updates).where(eq(pipelineRuns.pipeline_id, pipelineId));
		return this.findById(pipelineId);
	}

	async updateRefs(
		pipelineId: string,
		refs: {
			analysis_report_ref?: string;
			optimization_plan_ref?: string;
			validation_report_ref?: string;
		},
	): Promise<PipelineState | null> {
		const existing = await this.findById(pipelineId);
		if (!existing) return null;

		const updates: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		};
		if (refs.analysis_report_ref !== undefined)
			updates.analysis_report_ref = refs.analysis_report_ref;
		if (refs.optimization_plan_ref !== undefined)
			updates.optimization_plan_ref = refs.optimization_plan_ref;
		if (refs.validation_report_ref !== undefined)
			updates.validation_report_ref = refs.validation_report_ref;

		await this.db.update(pipelineRuns).set(updates).where(eq(pipelineRuns.pipeline_id, pipelineId));
		return this.findById(pipelineId);
	}

	async setError(
		pipelineId: string,
		errorMessage: string,
		resumable = false,
	): Promise<PipelineState | null> {
		const existing = await this.findById(pipelineId);
		if (!existing) return null;

		const now = new Date().toISOString();
		await this.db
			.update(pipelineRuns)
			.set({
				stage: "FAILED",
				error_message: errorMessage,
				resumable,
				resume_from_stage: resumable ? existing.stage : null,
				completed_at: now,
				updated_at: now,
			})
			.where(eq(pipelineRuns.pipeline_id, pipelineId));

		return this.findById(pipelineId);
	}

	async incrementRetry(pipelineId: string): Promise<number> {
		const existing = await this.findById(pipelineId);
		if (!existing) return -1;
		const newCount = existing.retry_count + 1;
		await this.db
			.update(pipelineRuns)
			.set({
				retry_count: newCount,
				updated_at: new Date().toISOString(),
			})
			.where(eq(pipelineRuns.pipeline_id, pipelineId));
		return newCount;
	}

	/**
	 * 파이프라인 레코드 삭제.
	 * @returns 삭제 성공 여부
	 */
	async deleteById(pipelineId: string): Promise<boolean> {
		const existing = await this.findById(pipelineId);
		if (!existing) return false;
		await this.db.delete(pipelineRuns).where(eq(pipelineRuns.pipeline_id, pipelineId));
		return true;
	}

	private toModel(row: typeof pipelineRuns.$inferSelect): PipelineState {
		return {
			pipeline_id: row.pipeline_id,
			target_id: row.target_id,
			stage: row.stage as PipelineStage,
			started_at: row.started_at,
			updated_at: row.updated_at,
			completed_at: row.completed_at ?? null,
			analysis_report_ref: row.analysis_report_ref ?? null,
			optimization_plan_ref: row.optimization_plan_ref ?? null,
			validation_report_ref: row.validation_report_ref ?? null,
			retry_count: row.retry_count,
			error_message: row.error_message ?? null,
			resumable: row.resumable,
			resume_from_stage: (row.resume_from_stage as PipelineStage) ?? null,
		};
	}
}
