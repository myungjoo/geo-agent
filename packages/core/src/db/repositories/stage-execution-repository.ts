/**
 * Stage Execution Repository
 *
 * 파이프라인 스테이지별 실행 기록을 DB에 저장/조회
 */
import { type SQL, asc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { GeoDatabase } from "../connection.js";
import { stageExecutions } from "../schema.js";

export interface StageExecution {
	id: string;
	pipeline_id: string;
	stage: string;
	cycle: number;
	status: "pending" | "running" | "completed" | "failed";
	prompt_summary: string;
	result_summary: string;
	result_full: string | null;
	error_message: string | null;
	started_at: string;
	completed_at: string | null;
	duration_ms: number | null;
}

export class StageExecutionRepository {
	constructor(private db: GeoDatabase) {}

	/**
	 * 스테이지 실행 시작 기록. status=running, started_at=now.
	 * @returns 생성된 StageExecution (id 포함)
	 */
	async create(
		pipelineId: string,
		stage: string,
		cycle: number,
		promptSummary: string,
	): Promise<StageExecution> {
		const id = uuidv4();
		const now = new Date().toISOString();

		await this.db.insert(stageExecutions).values({
			id,
			pipeline_id: pipelineId,
			stage,
			cycle,
			status: "running",
			prompt_summary: promptSummary.slice(0, 500),
			result_summary: "",
			result_full: null,
			error_message: null,
			started_at: now,
			completed_at: null,
			duration_ms: null,
		});

		return (await this.findById(id))!;
	}

	/**
	 * 스테이지 실행 완료 기록.
	 */
	async complete(
		id: string,
		resultSummary: string,
		resultFull?: unknown,
	): Promise<StageExecution | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const now = new Date().toISOString();
		const durationMs = new Date(now).getTime() - new Date(existing.started_at).getTime();

		await this.db
			.update(stageExecutions)
			.set({
				status: "completed",
				result_summary: resultSummary.slice(0, 500),
				result_full: resultFull !== undefined ? JSON.stringify(resultFull) : null,
				completed_at: now,
				duration_ms: durationMs,
			})
			.where(eq(stageExecutions.id, id));

		return this.findById(id);
	}

	/**
	 * 스테이지 실행 실패 기록.
	 */
	async fail(id: string, errorMessage: string): Promise<StageExecution | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const now = new Date().toISOString();
		const durationMs = new Date(now).getTime() - new Date(existing.started_at).getTime();

		await this.db
			.update(stageExecutions)
			.set({
				status: "failed",
				error_message: errorMessage,
				completed_at: now,
				duration_ms: durationMs,
			})
			.where(eq(stageExecutions.id, id));

		return this.findById(id);
	}

	/**
	 * 단건 조회 (result_full 포함).
	 */
	async findById(id: string): Promise<StageExecution | null> {
		const rows = await this.db.select().from(stageExecutions).where(eq(stageExecutions.id, id));
		return rows.length > 0 ? this.toModel(rows[0]) : null;
	}

	/**
	 * 파이프라인 ID로 전체 스테이지 실행 목록 조회 (started_at 오름차순).
	 */
	async findByPipelineId(pipelineId: string): Promise<StageExecution[]> {
		const rows = await this.db
			.select()
			.from(stageExecutions)
			.where(eq(stageExecutions.pipeline_id, pipelineId))
			.orderBy(asc(stageExecutions.started_at));
		return rows.map(this.toModel);
	}

	/**
	 * 파이프라인 ID에 속하는 모든 스테이지 실행 기록 삭제.
	 * @returns 삭제된 행 수
	 */
	async deleteByPipelineId(pipelineId: string): Promise<number> {
		const existing = await this.findByPipelineId(pipelineId);
		if (existing.length === 0) return 0;
		await this.db.delete(stageExecutions).where(eq(stageExecutions.pipeline_id, pipelineId));
		return existing.length;
	}

	/**
	 * result_full JSON에 키를 병합 (기존 데이터 유지). Executive summary 저장 등에 사용.
	 */
	async patchResultFull(id: string, patch: Record<string, unknown>): Promise<void> {
		const existing = await this.findById(id);
		if (!existing) return;
		let current: Record<string, unknown> = {};
		if (existing.result_full) {
			try {
				current = JSON.parse(existing.result_full);
			} catch {
				current = {};
			}
		}
		const merged = { ...current, ...patch };
		await this.db
			.update(stageExecutions)
			.set({ result_full: JSON.stringify(merged) })
			.where(eq(stageExecutions.id, id));
	}

	private toModel(row: typeof stageExecutions.$inferSelect): StageExecution {
		return {
			id: row.id,
			pipeline_id: row.pipeline_id,
			stage: row.stage,
			cycle: row.cycle,
			status: row.status as StageExecution["status"],
			prompt_summary: row.prompt_summary,
			result_summary: row.result_summary,
			result_full: row.result_full ?? null,
			error_message: row.error_message ?? null,
			started_at: row.started_at,
			completed_at: row.completed_at ?? null,
			duration_ms: row.duration_ms ?? null,
		};
	}
}
