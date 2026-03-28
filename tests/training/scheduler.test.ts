import { describe, it, expect, vi } from "vitest";
import { createScheduler, type TrainingSchedulerContext } from "../../src/training_scheduler.js";

describe("TrainingScheduler", () => {
  function makeContext(overrides: Partial<TrainingSchedulerContext> = {}): TrainingSchedulerContext {
    return {
      getTrainingCount: vi.fn().mockResolvedValue(0),
      runTraining: vi.fn().mockResolvedValue(undefined),
      getNow: vi.fn().mockReturnValue(0),
      minCandidates: 10,
      maxIntervalMs: 3_600_000,
      ...overrides,
    };
  }

  it("triggers when training count equals minCandidates", async () => {
    const ctx = makeContext({ getTrainingCount: vi.fn().mockResolvedValue(10) });
    const scheduler = createScheduler(ctx);
    await scheduler.tick();
    expect(ctx.runTraining).toHaveBeenCalledOnce();
  });

  it("triggers when training count exceeds minCandidates", async () => {
    const ctx = makeContext({ getTrainingCount: vi.fn().mockResolvedValue(15) });
    const scheduler = createScheduler(ctx);
    await scheduler.tick();
    expect(ctx.runTraining).toHaveBeenCalledOnce();
  });

  it("does not trigger when count is below minCandidates and interval not elapsed", async () => {
    const ctx = makeContext({
      getTrainingCount: vi.fn().mockResolvedValue(9),
      getNow: vi.fn().mockReturnValue(0),
      maxIntervalMs: 3_600_000,
    });
    const scheduler = createScheduler(ctx);
    await scheduler.tick();
    expect(ctx.runTraining).not.toHaveBeenCalled();
  });

  it("triggers when maxInterval has elapsed regardless of buffer size", async () => {
    let now = 0;
    const ctx = makeContext({
      getTrainingCount: vi.fn().mockResolvedValue(0),
      getNow: vi.fn().mockImplementation(() => now),
      maxIntervalMs: 1_000,
    });
    const scheduler = createScheduler(ctx); // lastTrainedAt = 0
    now = 1_000;
    await scheduler.tick();
    expect(ctx.runTraining).toHaveBeenCalledOnce();
  });

  it("does not trigger when maxInterval has not yet elapsed", async () => {
    let now = 0;
    const ctx = makeContext({
      getTrainingCount: vi.fn().mockResolvedValue(0),
      getNow: vi.fn().mockImplementation(() => now),
      maxIntervalMs: 1_000,
    });
    const scheduler = createScheduler(ctx);
    now = 999;
    await scheduler.tick();
    expect(ctx.runTraining).not.toHaveBeenCalled();
  });

  it("re-entrancy guard: second tick while training in progress is a no-op", async () => {
    let resolveTraining!: () => void;
    const runTraining = vi.fn().mockImplementationOnce(
      () => new Promise<void>(resolve => { resolveTraining = resolve; }),
    );
    const ctx = makeContext({ getTrainingCount: vi.fn().mockResolvedValue(10), runTraining });
    const scheduler = createScheduler(ctx);

    // isTraining = true is set synchronously before any await in tick()
    const first = scheduler.tick();
    const second = scheduler.tick(); // sees isTraining = true → immediate no-op

    await second;
    expect(runTraining).toHaveBeenCalledOnce();

    resolveTraining();
    await first;
  });

  it("updates lastTrainedAt after training so interval does not re-trigger immediately", async () => {
    let now = 0;
    const ctx = makeContext({
      getTrainingCount: vi.fn().mockResolvedValue(0),
      getNow: vi.fn().mockImplementation(() => now),
      maxIntervalMs: 1_000,
    });
    const scheduler = createScheduler(ctx); // lastTrainedAt = 0
    now = 1_000;
    await scheduler.tick(); // triggers; lastTrainedAt updated to 1000
    expect(ctx.runTraining).toHaveBeenCalledTimes(1);

    // Interval just reset — neither condition met
    await scheduler.tick();
    expect(ctx.runTraining).toHaveBeenCalledTimes(1);
  });
});
