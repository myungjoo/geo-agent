/**
 * Pipeline Orchestrator — 파이프라인 스테이지를 순서대로 실행하는 에이전트 엔진
 *
 * 각 스테이지에 대한 핸들러를 등록하고, 상태 머신을 통해 순차 실행.
 * Cycle 제어(VALIDATING → STRATEGIZING 루프), 에러 핸들링, 재시도 포함.
 */
import type { PipelineStage, PipelineState } from "../models/pipeline-state.js";
import { PipelineStateMachine } from "./state-machine.js";

// ── Stage Handler 타입 ──────────────────────────────────────

export interface StageContext {
	pipelineId: string;
	targetId: string;
	stage: PipelineStage;
	retryCount: number;
	/** 핸들러에서 다음 스테이지를 제어하기 위한 콜백 */
	setNextStage: (stage: PipelineStage) => void;
	/** 중간 참조 저장 */
	setRef: (key: "analysis" | "optimization" | "validation", ref: string) => void;
	/** 사이클 수동 중단 여부 확인 */
	isStopped: () => boolean;
}

export type StageHandler = (ctx: StageContext) => Promise<void>;

export interface OrchestratorConfig {
	/** 스테이지별 최대 재시도 횟수 (기본: 3) */
	maxRetries: number;
	/** 전체 파이프라인 타임아웃 (밀리초, 기본: 30분) */
	timeoutMs: number;
	/** 사이클 제어: 최대 사이클 수 (VALIDATING → STRATEGIZING 루프, 기본: 10) */
	maxCycles: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
	maxRetries: 3,
	timeoutMs: 30 * 60 * 1000,
	maxCycles: 10,
};

export interface OrchestratorResult {
	finalState: PipelineState;
	cyclesCompleted: number;
	totalDurationMs: number;
	stageTimings: Record<string, number>;
}

// ── Normal stage progression ─────────────────────────────────

const STAGE_ORDER: PipelineStage[] = [
	"INIT",
	"ANALYZING",
	"CLONING",
	"STRATEGIZING",
	"OPTIMIZING",
	"VALIDATING",
	"REPORTING",
	"COMPLETED",
];

function getNextStage(current: PipelineStage): PipelineStage | null {
	const idx = STAGE_ORDER.indexOf(current);
	if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
	return STAGE_ORDER[idx + 1];
}

// ── Orchestrator ─────────────────────────────────────────────

export class Orchestrator {
	private handlers: Map<PipelineStage, StageHandler> = new Map();
	private config: OrchestratorConfig;
	private stopped = false;
	private onStageChange?: (state: PipelineState) => void;

	constructor(config?: Partial<OrchestratorConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/** 스테이지 핸들러 등록 */
	registerHandler(stage: PipelineStage, handler: StageHandler): void {
		this.handlers.set(stage, handler);
	}

	/** 스테이지 변경 콜백 등록 */
	onStateChange(callback: (state: PipelineState) => void): void {
		this.onStageChange = callback;
	}

	/** 수동 중단 */
	stop(): void {
		this.stopped = true;
	}

	/** 파이프라인 실행 */
	async run(targetId: string, existingState?: PipelineState): Promise<OrchestratorResult> {
		const startTime = Date.now();
		const stageTimings: Record<string, number> = {};
		let cyclesCompleted = 0;
		this.stopped = false;

		// 기존 상태 복원 또는 새 파이프라인 생성
		const machine = existingState
			? PipelineStateMachine.fromState(existingState)
			: new PipelineStateMachine(targetId);

		// INIT → ANALYZING 첫 전이
		if (machine.getStage() === "INIT") {
			machine.transition("ANALYZING");
			this.emitStateChange(machine.getState());
		}

		// 메인 실행 루프
		while (!machine.isTerminal()) {
			// 타임아웃 체크
			if (Date.now() - startTime > this.config.timeoutMs) {
				machine.fail("Pipeline timeout exceeded", true);
				this.emitStateChange(machine.getState());
				break;
			}

			// 수동 중단 체크 — COMPLETED로 바로 갈 수 없으면 FAILED로 처리
			if (this.stopped) {
				if (machine.canTransition("COMPLETED")) {
					machine.transition("COMPLETED");
				} else {
					machine.fail("Pipeline manually stopped", false);
				}
				this.emitStateChange(machine.getState());
				break;
			}

			const currentStage = machine.getStage();
			const handler = this.handlers.get(currentStage);

			if (!handler) {
				// 핸들러 없으면 자동으로 다음 스테이지로 진행
				const next = getNextStage(currentStage);
				if (next && machine.canTransition(next)) {
					machine.transition(next);
					this.emitStateChange(machine.getState());
					continue;
				}
				// 더 이상 갈 곳이 없으면 완료
				if (machine.canTransition("COMPLETED")) {
					machine.transition("COMPLETED");
					this.emitStateChange(machine.getState());
				}
				break;
			}

			// 스테이지 핸들러 실행 (재시도 포함)
			const stageStart = Date.now();
			let nextStageOverride: PipelineStage | null = null;

			const ctx: StageContext = {
				pipelineId: machine.getState().pipeline_id,
				targetId: machine.getState().target_id,
				stage: currentStage,
				retryCount: machine.getState().retry_count,
				setNextStage: (stage) => {
					nextStageOverride = stage;
				},
				setRef: (key, ref) => {
					if (key === "analysis") machine.setAnalysisReportRef(ref);
					else if (key === "optimization") machine.setOptimizationPlanRef(ref);
					else if (key === "validation") machine.setValidationReportRef(ref);
				},
				isStopped: () => this.stopped,
			};

			let success = false;
			let lastError: Error | null = null;

			for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
				try {
					await handler(ctx);
					success = true;
					break;
				} catch (err) {
					lastError = err instanceof Error ? err : new Error(String(err));
					if (attempt < this.config.maxRetries) {
						machine.incrementRetry();
					}
				}
			}

			stageTimings[currentStage] = Date.now() - stageStart;

			if (!success) {
				machine.fail(lastError?.message ?? "Unknown error", true);
				this.emitStateChange(machine.getState());
				break;
			}

			// 다음 스테이지 결정
			if (nextStageOverride) {
				// 핸들러가 명시적으로 다음 스테이지를 지정 (예: VALIDATING → STRATEGIZING 루프백)
				if (currentStage === "VALIDATING" && nextStageOverride === "STRATEGIZING") {
					cyclesCompleted++;
					if (cyclesCompleted >= this.config.maxCycles) {
						// 최대 사이클 초과 → REPORTING으로 진행
						machine.transition("REPORTING");
					} else {
						machine.transition("STRATEGIZING");
					}
				} else if (machine.canTransition(nextStageOverride)) {
					machine.transition(nextStageOverride);
				}
			} else {
				// 기본 진행
				const next = getNextStage(currentStage);
				if (next && machine.canTransition(next)) {
					machine.transition(next);
				}
			}

			this.emitStateChange(machine.getState());
		}

		return {
			finalState: machine.getState(),
			cyclesCompleted,
			totalDurationMs: Date.now() - startTime,
			stageTimings,
		};
	}

	private emitStateChange(state: PipelineState): void {
		if (this.onStageChange) {
			this.onStageChange(state);
		}
	}
}
