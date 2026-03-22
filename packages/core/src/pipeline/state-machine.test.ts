import { describe, expect, it } from "vitest";
import type { PipelineStage, PipelineState } from "../models/pipeline-state.js";
import { PipelineStateMachine } from "./state-machine.js";

const TARGET_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PIPELINE_ID = "11111111-2222-3333-4444-555555555555";

/**
 * Forward stage sequence (happy path).
 * INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
 */
const FORWARD_STAGES: PipelineStage[] = [
	"ANALYZING",
	"CLONING",
	"STRATEGIZING",
	"OPTIMIZING",
	"VALIDATING",
	"REPORTING",
	"COMPLETED",
];

describe("PipelineStateMachine", () => {
	// ─── 1. Constructor ──────────────────────────────────────────────

	describe("constructor", () => {
		it("creates initial state at INIT stage", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const state = sm.getState();

			expect(state.target_id).toBe(TARGET_ID);
			expect(state.stage).toBe("INIT");
			expect(state.retry_count).toBe(0);
			expect(state.error_message).toBeNull();
			expect(state.completed_at).toBeNull();
			expect(state.analysis_report_ref).toBeNull();
			expect(state.optimization_plan_ref).toBeNull();
			expect(state.validation_report_ref).toBeNull();
			expect(state.resumable).toBe(false);
			expect(state.resume_from_stage).toBeNull();
		});

		it("auto-generates pipeline_id when not provided", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(sm.getState().pipeline_id).toBeTruthy();
			expect(sm.getState().pipeline_id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
		});

		it("uses provided pipeline_id", () => {
			const sm = new PipelineStateMachine(TARGET_ID, PIPELINE_ID);
			expect(sm.getState().pipeline_id).toBe(PIPELINE_ID);
		});

		it("sets started_at and updated_at to the same timestamp", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const state = sm.getState();
			expect(state.started_at).toBe(state.updated_at);
		});
	});

	// ─── 2. getState() ───────────────────────────────────────────────

	describe("getState()", () => {
		it("returns a copy, not the internal reference", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const s1 = sm.getState();
			const s2 = sm.getState();
			expect(s1).toEqual(s2);
			expect(s1).not.toBe(s2);
		});

		it("mutations on returned copy do not affect internal state", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const copy = sm.getState() as PipelineState;
			(copy as { stage: PipelineStage }).stage = "COMPLETED";
			expect(sm.getStage()).toBe("INIT");
		});
	});

	// ─── 3. getStage() ──────────────────────────────────────────────

	describe("getStage()", () => {
		it("returns current stage", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(sm.getStage()).toBe("INIT");
		});

		it("reflects transitions", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.transition("ANALYZING");
			expect(sm.getStage()).toBe("ANALYZING");
		});
	});

	// ─── 4. canTransition() ─────────────────────────────────────────

	describe("canTransition()", () => {
		it("returns true for valid forward transition from INIT", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(sm.canTransition("ANALYZING")).toBe(true);
		});

		it("returns true for FAILED from any non-terminal stage", () => {
			const stages: PipelineStage[] = [
				"INIT",
				"ANALYZING",
				"CLONING",
				"STRATEGIZING",
				"OPTIMIZING",
				"VALIDATING",
				"REPORTING",
			];
			for (const stage of stages) {
				const restored: PipelineState = buildState({ stage });
				const sm = PipelineStateMachine.fromState(restored);
				expect(sm.canTransition("FAILED")).toBe(true);
			}
		});

		it("returns false for invalid transitions", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(sm.canTransition("COMPLETED")).toBe(false);
			expect(sm.canTransition("REPORTING")).toBe(false);
			expect(sm.canTransition("OPTIMIZING")).toBe(false);
		});

		it("returns false for any transition from terminal stages", () => {
			for (const terminal of [
				"COMPLETED",
				"FAILED",
				"PARTIAL_FAILURE",
				"STOPPED",
			] as PipelineStage[]) {
				const sm = PipelineStateMachine.fromState(buildState({ stage: terminal }));
				expect(sm.canTransition("INIT")).toBe(false);
				expect(sm.canTransition("ANALYZING")).toBe(false);
				expect(sm.canTransition("FAILED")).toBe(false);
			}
		});

		it("returns true for VALIDATING → STRATEGIZING (loop back)", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			expect(sm.canTransition("STRATEGIZING")).toBe(true);
		});

		it("returns true for VALIDATING → PARTIAL_FAILURE", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			expect(sm.canTransition("PARTIAL_FAILURE")).toBe(true);
		});
	});

	// ─── 5. transition() — valid forward transitions ────────────────

	describe("transition() — valid forward", () => {
		it("walks through the entire happy-path sequence", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			for (const next of FORWARD_STAGES) {
				const result = sm.transition(next);
				expect(result.stage).toBe(next);
			}
			expect(sm.getStage()).toBe("COMPLETED");
		});

		it("updates updated_at on each transition", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const before = sm.getState().updated_at;
			// small delay is not guaranteed, but updated_at should be set
			sm.transition("ANALYZING");
			const after = sm.getState().updated_at;
			expect(after).toBeTruthy();
			// updated_at should be >= before
			expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
		});

		it("returns a copy of the state", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const result = sm.transition("ANALYZING");
			expect(result.stage).toBe("ANALYZING");
			// mutating returned object should not affect internal state
			(result as { stage: PipelineStage }).stage = "FAILED";
			expect(sm.getStage()).toBe("ANALYZING");
		});
	});

	// ─── 6. transition() — invalid transitions throw ────────────────

	describe("transition() — invalid", () => {
		it("throws on INIT → COMPLETED", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(() => sm.transition("COMPLETED")).toThrowError(/Invalid transition.*INIT.*COMPLETED/);
		});

		it("throws on INIT → REPORTING", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(() => sm.transition("REPORTING")).toThrowError(/Invalid transition/);
		});

		it("throws on ANALYZING → OPTIMIZING (skipping stages)", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.transition("ANALYZING");
			expect(() => sm.transition("OPTIMIZING")).toThrowError(/Invalid transition/);
		});

		it("throws when transitioning from a terminal state", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "COMPLETED" }));
			expect(() => sm.transition("INIT")).toThrowError(/Invalid transition/);
		});

		it("throws on FAILED → anything", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "FAILED" }));
			expect(() => sm.transition("ANALYZING")).toThrowError(/Invalid transition/);
		});

		it("throws on PARTIAL_FAILURE → anything", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "PARTIAL_FAILURE" }));
			expect(() => sm.transition("STRATEGIZING")).toThrowError(/Invalid transition/);
		});
	});

	// ─── 7. Terminal transitions set completed_at ────────────────────

	describe("terminal transitions set completed_at", () => {
		it("COMPLETED sets completed_at", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			for (const s of FORWARD_STAGES.slice(0, -1)) {
				sm.transition(s);
			}
			expect(sm.getState().completed_at).toBeNull();
			sm.transition("COMPLETED");
			expect(sm.getState().completed_at).not.toBeNull();
			expect(sm.getState().completed_at).toBe(sm.getState().updated_at);
		});

		it("FAILED sets completed_at", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.transition("ANALYZING");
			sm.transition("FAILED");
			expect(sm.getState().completed_at).not.toBeNull();
		});

		it("PARTIAL_FAILURE sets completed_at", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			sm.transition("PARTIAL_FAILURE");
			expect(sm.getState().completed_at).not.toBeNull();
			expect(sm.getState().completed_at).toBe(sm.getState().updated_at);
		});

		it("non-terminal transitions do NOT set completed_at", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.transition("ANALYZING");
			expect(sm.getState().completed_at).toBeNull();
			sm.transition("CLONING");
			expect(sm.getState().completed_at).toBeNull();
		});
	});

	// ─── 8. fail() ──────────────────────────────────────────────────

	describe("fail()", () => {
		it("transitions to FAILED with error message", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.transition("ANALYZING");
			const result = sm.fail("Something went wrong");
			expect(result.stage).toBe("FAILED");
			expect(result.error_message).toBe("Something went wrong");
			expect(result.completed_at).not.toBeNull();
		});

		it("sets resumable=false by default", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const result = sm.fail("Error");
			expect(result.resumable).toBe(false);
			expect(result.resume_from_stage).toBeNull();
		});
	});

	// ─── 9. fail() with resumable=true ──────────────────────────────

	describe("fail() with resumable=true", () => {
		it("sets resume_from_stage to the stage before failure", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.transition("ANALYZING");
			sm.transition("CLONING");
			sm.transition("STRATEGIZING");

			const result = sm.fail("Timeout", true);
			expect(result.stage).toBe("FAILED");
			expect(result.resumable).toBe(true);
			expect(result.resume_from_stage).toBe("STRATEGIZING");
			expect(result.error_message).toBe("Timeout");
		});

		it("sets resume_from_stage=INIT when failing from INIT", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const result = sm.fail("Startup error", true);
			expect(result.resume_from_stage).toBe("INIT");
		});
	});

	// ─── 10. incrementRetry() ───────────────────────────────────────

	describe("incrementRetry()", () => {
		it("increases retry count from 0 to 1", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const count = sm.incrementRetry();
			expect(count).toBe(1);
			expect(sm.getState().retry_count).toBe(1);
		});

		it("increments cumulatively", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.incrementRetry();
			sm.incrementRetry();
			const count = sm.incrementRetry();
			expect(count).toBe(3);
			expect(sm.getState().retry_count).toBe(3);
		});

		it("updates updated_at", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const before = sm.getState().updated_at;
			sm.incrementRetry();
			expect(new Date(sm.getState().updated_at).getTime()).toBeGreaterThanOrEqual(
				new Date(before).getTime(),
			);
		});
	});

	// ─── 11. setRef methods ─────────────────────────────────────────

	describe("set*Ref methods", () => {
		const REF_UUID = "99999999-aaaa-bbbb-cccc-dddddddddddd";

		it("setAnalysisReportRef sets analysis_report_ref", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.setAnalysisReportRef(REF_UUID);
			expect(sm.getState().analysis_report_ref).toBe(REF_UUID);
		});

		it("setOptimizationPlanRef sets optimization_plan_ref", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.setOptimizationPlanRef(REF_UUID);
			expect(sm.getState().optimization_plan_ref).toBe(REF_UUID);
		});

		it("setValidationReportRef sets validation_report_ref", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			sm.setValidationReportRef(REF_UUID);
			expect(sm.getState().validation_report_ref).toBe(REF_UUID);
		});

		it("setRef methods update updated_at", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			const before = sm.getState().updated_at;
			sm.setAnalysisReportRef(REF_UUID);
			expect(new Date(sm.getState().updated_at).getTime()).toBeGreaterThanOrEqual(
				new Date(before).getTime(),
			);
		});
	});

	// ─── 12. fromState() ────────────────────────────────────────────

	describe("fromState()", () => {
		it("restores a state machine at the given stage", () => {
			const existing = buildState({
				stage: "OPTIMIZING",
				retry_count: 2,
				error_message: null,
			});
			const sm = PipelineStateMachine.fromState(existing);
			expect(sm.getStage()).toBe("OPTIMIZING");
			expect(sm.getState().retry_count).toBe(2);
			expect(sm.getState().target_id).toBe(existing.target_id);
			expect(sm.getState().pipeline_id).toBe(existing.pipeline_id);
		});

		it("restored machine can continue transitions", () => {
			const existing = buildState({ stage: "OPTIMIZING" });
			const sm = PipelineStateMachine.fromState(existing);
			sm.transition("VALIDATING");
			expect(sm.getStage()).toBe("VALIDATING");
		});

		it("restored machine respects transition rules", () => {
			const existing = buildState({ stage: "COMPLETED" });
			const sm = PipelineStateMachine.fromState(existing);
			expect(() => sm.transition("INIT")).toThrowError(/Invalid transition/);
		});

		it("creates a copy — changes do not affect original object", () => {
			const original = buildState({ stage: "ANALYZING" });
			const sm = PipelineStateMachine.fromState(original);
			sm.transition("CLONING");
			expect(original.stage).toBe("ANALYZING");
		});

		it("preserves all fields from the input state", () => {
			const ref = "ffffffff-0000-1111-2222-333333333333";
			const existing = buildState({
				stage: "VALIDATING",
				analysis_report_ref: ref,
				optimization_plan_ref: ref,
				validation_report_ref: ref,
				retry_count: 5,
				error_message: "previous error",
				resumable: true,
				resume_from_stage: "STRATEGIZING",
			});
			const sm = PipelineStateMachine.fromState(existing);
			const state = sm.getState();
			expect(state.analysis_report_ref).toBe(ref);
			expect(state.optimization_plan_ref).toBe(ref);
			expect(state.validation_report_ref).toBe(ref);
			expect(state.retry_count).toBe(5);
			expect(state.error_message).toBe("previous error");
			expect(state.resumable).toBe(true);
			expect(state.resume_from_stage).toBe("STRATEGIZING");
		});
	});

	// ─── 13. isTerminal() ───────────────────────────────────────────

	describe("isTerminal()", () => {
		it("returns true for COMPLETED", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "COMPLETED" }));
			expect(sm.isTerminal()).toBe(true);
		});

		it("returns true for FAILED", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "FAILED" }));
			expect(sm.isTerminal()).toBe(true);
		});

		it("returns true for PARTIAL_FAILURE", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "PARTIAL_FAILURE" }));
			expect(sm.isTerminal()).toBe(true);
		});

		it("returns true for STOPPED", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "STOPPED" }));
			expect(sm.isTerminal()).toBe(true);
		});

		it("returns false for non-terminal stages", () => {
			const nonTerminal: PipelineStage[] = [
				"INIT",
				"ANALYZING",
				"CLONING",
				"STRATEGIZING",
				"OPTIMIZING",
				"VALIDATING",
				"REPORTING",
			];
			for (const stage of nonTerminal) {
				const sm = PipelineStateMachine.fromState(buildState({ stage }));
				expect(sm.isTerminal()).toBe(false);
			}
		});
	});

	// ─── 14. getAllowedTransitions() ─────────────────────────────────

	describe("getAllowedTransitions()", () => {
		it("returns [ANALYZING, FAILED, STOPPED] for INIT", () => {
			const sm = new PipelineStateMachine(TARGET_ID);
			expect(sm.getAllowedTransitions()).toEqual(["ANALYZING", "FAILED", "STOPPED"]);
		});

		it("returns [CLONING, FAILED, STOPPED] for ANALYZING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "ANALYZING" }));
			expect(sm.getAllowedTransitions()).toEqual(["CLONING", "FAILED", "STOPPED"]);
		});

		it("returns [STRATEGIZING, FAILED, STOPPED] for CLONING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "CLONING" }));
			expect(sm.getAllowedTransitions()).toEqual(["STRATEGIZING", "FAILED", "STOPPED"]);
		});

		it("returns [OPTIMIZING, FAILED, STOPPED] for STRATEGIZING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "STRATEGIZING" }));
			expect(sm.getAllowedTransitions()).toEqual(["OPTIMIZING", "FAILED", "STOPPED"]);
		});

		it("returns [VALIDATING, FAILED, STOPPED] for OPTIMIZING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "OPTIMIZING" }));
			expect(sm.getAllowedTransitions()).toEqual(["VALIDATING", "FAILED", "STOPPED"]);
		});

		it("returns [REPORTING, STRATEGIZING, FAILED, PARTIAL_FAILURE, STOPPED] for VALIDATING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			expect(sm.getAllowedTransitions()).toEqual([
				"REPORTING",
				"STRATEGIZING",
				"FAILED",
				"PARTIAL_FAILURE",
				"STOPPED",
			]);
		});

		it("returns [COMPLETED, FAILED, STOPPED] for REPORTING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "REPORTING" }));
			expect(sm.getAllowedTransitions()).toEqual(["COMPLETED", "FAILED", "STOPPED"]);
		});

		it("returns [] for terminal stages", () => {
			for (const stage of [
				"COMPLETED",
				"FAILED",
				"PARTIAL_FAILURE",
				"STOPPED",
			] as PipelineStage[]) {
				const sm = PipelineStateMachine.fromState(buildState({ stage }));
				expect(sm.getAllowedTransitions()).toEqual([]);
			}
		});
	});

	// ─── 15. VALIDATING → STRATEGIZING (loop back) ──────────────────

	describe("VALIDATING → STRATEGIZING loop", () => {
		it("allows transition from VALIDATING back to STRATEGIZING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			const result = sm.transition("STRATEGIZING");
			expect(result.stage).toBe("STRATEGIZING");
		});

		it("can loop multiple times: STRATEGIZING → … → VALIDATING → STRATEGIZING", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "STRATEGIZING" }));

			// First pass
			sm.transition("OPTIMIZING");
			sm.transition("VALIDATING");
			// Loop back
			sm.transition("STRATEGIZING");
			expect(sm.getStage()).toBe("STRATEGIZING");

			// Second pass
			sm.transition("OPTIMIZING");
			sm.transition("VALIDATING");
			// Loop back again
			sm.transition("STRATEGIZING");
			expect(sm.getStage()).toBe("STRATEGIZING");
		});

		it("can eventually proceed to REPORTING after looping", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			sm.transition("STRATEGIZING");
			sm.transition("OPTIMIZING");
			sm.transition("VALIDATING");
			sm.transition("REPORTING");
			sm.transition("COMPLETED");
			expect(sm.getStage()).toBe("COMPLETED");
			expect(sm.isTerminal()).toBe(true);
		});
	});

	// ─── 16. VALIDATING → PARTIAL_FAILURE ───────────────────────────

	describe("VALIDATING → PARTIAL_FAILURE", () => {
		it("allows transition from VALIDATING to PARTIAL_FAILURE", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			const result = sm.transition("PARTIAL_FAILURE");
			expect(result.stage).toBe("PARTIAL_FAILURE");
		});

		it("sets completed_at when entering PARTIAL_FAILURE", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			sm.transition("PARTIAL_FAILURE");
			expect(sm.getState().completed_at).not.toBeNull();
		});

		it("PARTIAL_FAILURE is a terminal state — no further transitions", () => {
			const sm = PipelineStateMachine.fromState(buildState({ stage: "VALIDATING" }));
			sm.transition("PARTIAL_FAILURE");
			expect(sm.isTerminal()).toBe(true);
			expect(sm.getAllowedTransitions()).toEqual([]);
			expect(() => sm.transition("STRATEGIZING")).toThrowError(/Invalid transition/);
		});

		it("PARTIAL_FAILURE is only reachable from VALIDATING", () => {
			const nonValidating: PipelineStage[] = [
				"INIT",
				"ANALYZING",
				"CLONING",
				"STRATEGIZING",
				"OPTIMIZING",
				"REPORTING",
			];
			for (const stage of nonValidating) {
				const sm = PipelineStateMachine.fromState(buildState({ stage }));
				expect(sm.canTransition("PARTIAL_FAILURE")).toBe(false);
			}
		});
	});
});

// ─── Helper ─────────────────────────────────────────────────────────

function buildState(overrides: Partial<PipelineState> = {}): PipelineState {
	const now = new Date().toISOString();
	return {
		pipeline_id: PIPELINE_ID,
		target_id: TARGET_ID,
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
		...overrides,
	};
}
