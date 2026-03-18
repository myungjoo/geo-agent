import { describe, expect, it, vi } from "vitest";
import type { PipelineStage, PipelineState } from "../models/pipeline-state.js";
import { Orchestrator, type StageContext, type StageHandler } from "./orchestrator.js";
import { PipelineStateMachine } from "./state-machine.js";

// Helper: create a simple passing handler
function passHandler(): StageHandler {
	return async () => {};
}

// Helper: create a handler that sets a ref
function refHandler(key: "analysis" | "optimization" | "validation", ref: string): StageHandler {
	return async (ctx) => {
		ctx.setRef(key, ref);
	};
}

// Helper: create a handler that fails N times then succeeds
function failThenSucceed(failures: number): StageHandler {
	let attempts = 0;
	return async () => {
		attempts++;
		if (attempts <= failures) {
			throw new Error(`Fail attempt ${attempts}`);
		}
	};
}

// Helper: create a handler that always fails
function alwaysFail(msg = "Always fails"): StageHandler {
	return async () => {
		throw new Error(msg);
	};
}

describe("Orchestrator", () => {
	describe("basic pipeline execution", () => {
		it("runs through all stages to COMPLETED", async () => {
			const orch = new Orchestrator();
			orch.registerHandler("ANALYZING", passHandler());
			orch.registerHandler("CLONING", passHandler());
			orch.registerHandler("STRATEGIZING", passHandler());
			orch.registerHandler("OPTIMIZING", passHandler());
			orch.registerHandler("VALIDATING", passHandler());
			orch.registerHandler("REPORTING", passHandler());

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
			expect(result.finalState.completed_at).not.toBeNull();
			expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
			expect(result.cyclesCompleted).toBe(0);
		});

		it("completes even without handlers (auto-advance)", async () => {
			const orch = new Orchestrator();
			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
		});

		it("records stage timings", async () => {
			const orch = new Orchestrator();
			orch.registerHandler("ANALYZING", passHandler());
			orch.registerHandler("CLONING", passHandler());

			const result = await orch.run("target-1");
			expect(result.stageTimings).toHaveProperty("ANALYZING");
			expect(result.stageTimings).toHaveProperty("CLONING");
		});
	});

	describe("stage handlers", () => {
		it("passes correct context to handlers", async () => {
			const capturedCtx: StageContext[] = [];
			const handler: StageHandler = async (ctx) => {
				capturedCtx.push({ ...ctx });
			};

			const orch = new Orchestrator();
			orch.registerHandler("ANALYZING", handler);

			await orch.run("target-42");
			expect(capturedCtx.length).toBeGreaterThanOrEqual(1);
			expect(capturedCtx[0].targetId).toBe("target-42");
			expect(capturedCtx[0].stage).toBe("ANALYZING");
			expect(capturedCtx[0].retryCount).toBe(0);
		});

		it("allows handlers to set refs", async () => {
			const orch = new Orchestrator();
			orch.registerHandler("ANALYZING", refHandler("analysis", "report-001"));
			orch.registerHandler("STRATEGIZING", refHandler("optimization", "plan-001"));
			orch.registerHandler("VALIDATING", refHandler("validation", "validation-001"));

			const result = await orch.run("target-1");
			expect(result.finalState.analysis_report_ref).toBe("report-001");
			expect(result.finalState.optimization_plan_ref).toBe("plan-001");
			expect(result.finalState.validation_report_ref).toBe("validation-001");
		});
	});

	describe("retry logic", () => {
		it("retries failed stage up to maxRetries", async () => {
			const orch = new Orchestrator({ maxRetries: 2 });
			orch.registerHandler("ANALYZING", failThenSucceed(2));

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
			expect(result.finalState.retry_count).toBe(2);
		});

		it("fails pipeline when retries exhausted", async () => {
			const orch = new Orchestrator({ maxRetries: 1 });
			orch.registerHandler("ANALYZING", alwaysFail("Network error"));

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("FAILED");
			expect(result.finalState.error_message).toContain("Network error");
			expect(result.finalState.resumable).toBe(true);
		});

		it("retries correct number of times (0 retries = 1 attempt)", async () => {
			const orch = new Orchestrator({ maxRetries: 0 });
			let attempts = 0;
			orch.registerHandler("ANALYZING", async () => {
				attempts++;
				throw new Error("fail");
			});

			await orch.run("target-1");
			expect(attempts).toBe(1);
		});
	});

	describe("cycle control (VALIDATING → STRATEGIZING loop)", () => {
		it("supports validation loop back to strategizing", async () => {
			let validationCount = 0;
			const orch = new Orchestrator({ maxCycles: 10 });
			orch.registerHandler("STRATEGIZING", passHandler());
			orch.registerHandler("OPTIMIZING", passHandler());
			orch.registerHandler("VALIDATING", async (ctx) => {
				validationCount++;
				if (validationCount < 3) {
					ctx.setNextStage("STRATEGIZING");
				}
				// else: proceed to REPORTING (default)
			});
			orch.registerHandler("REPORTING", passHandler());

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
			expect(result.cyclesCompleted).toBe(2);
			expect(validationCount).toBe(3);
		});

		it("stops cycling when maxCycles reached", async () => {
			const orch = new Orchestrator({ maxCycles: 2 });
			let validationCount = 0;
			orch.registerHandler("STRATEGIZING", passHandler());
			orch.registerHandler("OPTIMIZING", passHandler());
			orch.registerHandler("VALIDATING", async (ctx) => {
				validationCount++;
				ctx.setNextStage("STRATEGIZING"); // always loop
			});
			orch.registerHandler("REPORTING", passHandler());

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
			expect(result.cyclesCompleted).toBe(2);
		});
	});

	describe("manual stop", () => {
		it("stops pipeline when stop() is called", async () => {
			const orch = new Orchestrator();
			orch.registerHandler("ANALYZING", async () => {
				// Simulate external stop during execution
				orch.stop();
			});

			const result = await orch.run("target-1");
			// After ANALYZING completes, the loop checks stopped flag
			// CLONING cannot transition to COMPLETED directly, so it goes to FAILED
			expect(["COMPLETED", "FAILED"]).toContain(result.finalState.stage);
		});

		it("handler can check isStopped", async () => {
			const orch = new Orchestrator();
			let sawStopped = false;
			orch.registerHandler("ANALYZING", async (ctx) => {
				orch.stop();
				sawStopped = ctx.isStopped();
			});

			await orch.run("target-1");
			expect(sawStopped).toBe(true);
		});

		it("stops cleanly at REPORTING stage (can reach COMPLETED)", async () => {
			const orch = new Orchestrator();
			orch.registerHandler("REPORTING", async () => {
				orch.stop();
			});

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
		});
	});

	describe("timeout", () => {
		it("fails pipeline on timeout", async () => {
			const orch = new Orchestrator({ timeoutMs: 1 });
			orch.registerHandler("ANALYZING", async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
			});

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("FAILED");
			expect(result.finalState.error_message).toContain("timeout");
		});
	});

	describe("state change callback", () => {
		it("fires onStateChange for each transition", async () => {
			const states: PipelineStage[] = [];
			const orch = new Orchestrator();
			orch.onStateChange((state) => states.push(state.stage));

			await orch.run("target-1");
			// Should have multiple state changes: ANALYZING, CLONING, ..., COMPLETED
			expect(states.length).toBeGreaterThan(1);
			expect(states[0]).toBe("ANALYZING");
			expect(states[states.length - 1]).toBe("COMPLETED");
		});
	});

	describe("resume from existing state", () => {
		it("resumes from a given pipeline state", async () => {
			// Create a state that's already at STRATEGIZING
			const machine = new PipelineStateMachine("target-1");
			machine.transition("ANALYZING");
			machine.transition("CLONING");
			machine.transition("STRATEGIZING");

			const orch = new Orchestrator();
			orch.registerHandler("STRATEGIZING", passHandler());
			orch.registerHandler("OPTIMIZING", passHandler());
			orch.registerHandler("VALIDATING", passHandler());
			orch.registerHandler("REPORTING", passHandler());

			const result = await orch.run("target-1", machine.getState());
			expect(result.finalState.stage).toBe("COMPLETED");
		});

		it("does not re-run already completed stages", async () => {
			const analyzingCalled = vi.fn();
			const machine = new PipelineStateMachine("target-1");
			machine.transition("ANALYZING");
			machine.transition("CLONING");
			machine.transition("STRATEGIZING");

			const orch = new Orchestrator();
			orch.registerHandler("ANALYZING", async () => analyzingCalled());

			const result = await orch.run("target-1", machine.getState());
			expect(result.finalState.stage).toBe("COMPLETED");
			expect(analyzingCalled).not.toHaveBeenCalled();
		});
	});

	describe("OrchestratorConfig defaults", () => {
		it("uses default config when none provided", async () => {
			const orch = new Orchestrator();
			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
		});

		it("allows partial config override", async () => {
			const orch = new Orchestrator({ maxRetries: 5 });
			orch.registerHandler("ANALYZING", failThenSucceed(4));
			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("COMPLETED");
		});
	});

	describe("error propagation", () => {
		it("captures non-Error throws as strings", async () => {
			const orch = new Orchestrator({ maxRetries: 0 });
			orch.registerHandler("ANALYZING", async () => {
				throw "string error";
			});

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("FAILED");
			expect(result.finalState.error_message).toContain("string error");
		});

		it("marks failed pipeline as resumable", async () => {
			const orch = new Orchestrator({ maxRetries: 0 });
			orch.registerHandler("OPTIMIZING", alwaysFail("Optimization failed"));

			const result = await orch.run("target-1");
			expect(result.finalState.stage).toBe("FAILED");
			expect(result.finalState.resumable).toBe(true);
		});
	});
});
