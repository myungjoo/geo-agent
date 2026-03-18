/**
 * Pipeline State Machine
 *
 * INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
 *                                    ↑                          │
 *                                    └── 목표 미달 ─────────────┘
 *                                                     FAILED / PARTIAL_FAILURE
 */
import { v4 as uuidv4 } from "uuid";
import type { PipelineStage, PipelineState } from "../models/pipeline-state.js";

/** 정상 진행 시 허용되는 전이 맵 */
const TRANSITIONS: Record<string, PipelineStage[]> = {
	INIT: ["ANALYZING", "FAILED"],
	ANALYZING: ["CLONING", "FAILED"],
	CLONING: ["STRATEGIZING", "FAILED"],
	STRATEGIZING: ["OPTIMIZING", "FAILED"],
	OPTIMIZING: ["VALIDATING", "FAILED"],
	VALIDATING: ["REPORTING", "STRATEGIZING", "FAILED", "PARTIAL_FAILURE"],
	REPORTING: ["COMPLETED", "FAILED"],
	COMPLETED: [],
	FAILED: [],
	PARTIAL_FAILURE: [],
};

export class PipelineStateMachine {
	private state: PipelineState;

	constructor(targetId: string, pipelineId?: string) {
		const now = new Date().toISOString();
		this.state = {
			pipeline_id: pipelineId ?? uuidv4(),
			target_id: targetId,
			stage: "INIT",
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
	}

	/** 현재 상태를 반환 */
	getState(): Readonly<PipelineState> {
		return { ...this.state };
	}

	/** 현재 스테이지를 반환 */
	getStage(): PipelineStage {
		return this.state.stage;
	}

	/** 다음 스테이지로 전이 가능한지 확인 */
	canTransition(nextStage: PipelineStage): boolean {
		const allowed = TRANSITIONS[this.state.stage];
		return allowed ? allowed.includes(nextStage) : false;
	}

	/** 다음 스테이지로 전이 */
	transition(nextStage: PipelineStage): PipelineState {
		if (!this.canTransition(nextStage)) {
			throw new Error(`Invalid transition: ${this.state.stage} → ${nextStage}`);
		}

		this.state.stage = nextStage;
		this.state.updated_at = new Date().toISOString();

		if (nextStage === "COMPLETED" || nextStage === "FAILED" || nextStage === "PARTIAL_FAILURE") {
			this.state.completed_at = this.state.updated_at;
		}

		return this.getState();
	}

	/** 실패 처리 */
	fail(errorMessage: string, resumable = false): PipelineState {
		const currentStage = this.state.stage;
		this.state.error_message = errorMessage;
		this.state.resumable = resumable;
		if (resumable) {
			this.state.resume_from_stage = currentStage;
		}
		return this.transition("FAILED");
	}

	/** 재시도 카운트 증가 */
	incrementRetry(): number {
		this.state.retry_count += 1;
		this.state.updated_at = new Date().toISOString();
		return this.state.retry_count;
	}

	/** 분석 리포트 참조 설정 */
	setAnalysisReportRef(ref: string): void {
		this.state.analysis_report_ref = ref;
		this.state.updated_at = new Date().toISOString();
	}

	/** 최적화 계획 참조 설정 */
	setOptimizationPlanRef(ref: string): void {
		this.state.optimization_plan_ref = ref;
		this.state.updated_at = new Date().toISOString();
	}

	/** 검증 리포트 참조 설정 */
	setValidationReportRef(ref: string): void {
		this.state.validation_report_ref = ref;
		this.state.updated_at = new Date().toISOString();
	}

	/** 기존 PipelineState 로부터 복원 */
	static fromState(state: PipelineState): PipelineStateMachine {
		const machine = new PipelineStateMachine(state.target_id, state.pipeline_id);
		machine.state = { ...state };
		return machine;
	}

	/** 터미널 상태인지 확인 */
	isTerminal(): boolean {
		return ["COMPLETED", "FAILED", "PARTIAL_FAILURE"].includes(this.state.stage);
	}

	/** 허용되는 다음 전이 목록 */
	getAllowedTransitions(): PipelineStage[] {
		return TRANSITIONS[this.state.stage] ?? [];
	}
}
