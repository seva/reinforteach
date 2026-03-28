import { describe, it, expect } from "vitest";
import { appendToBuffer, readTrainingSet } from "../../src/training_buffer.js";
import type { TrainingBufferContext } from "../../src/training_buffer.js";
import type { DPOCandidate } from "../../src/candidate_synthesizer.js";

const candidate = (reward: number): DPOCandidate => ({
  prompt: "user: What is 2+2?",
  chosen: "4",
  rejected: "5",
  reward,
});

const makeStore = () => {
  const files: Record<string, string[]> = {};
  return {
    append: async (path: string, line: string) => {
      files[path] ??= [];
      files[path].push(line);
    },
    lineCount: async (path: string) => files[path]?.length ?? 0,
    readLines: async (path: string) => files[path] ?? [],
    _files: files,
  };
};

const makeContext = (
  overrides: Partial<TrainingBufferContext> = {},
): { ctx: TrainingBufferContext; store: ReturnType<typeof makeStore> } => {
  const store = makeStore();
  const ctx: TrainingBufferContext = {
    store,
    trainingFile: "/buf/training.jsonl",
    heldOutFile: "/buf/held_out.jsonl",
    confidenceThreshold: 0.5,
    heldOutSize: 3,
    ...overrides,
  };
  return { ctx, store };
};

describe("appendToBuffer — confidence gate", () => {
  it("appends when |reward| >= confidenceThreshold", async () => {
    const { ctx, store } = makeContext();

    await appendToBuffer(candidate(-0.6), ctx);

    expect(store._files[ctx.heldOutFile]).toHaveLength(1);
  });

  it("rejects when |reward| < confidenceThreshold", async () => {
    const { ctx, store } = makeContext();

    const result = await appendToBuffer(candidate(-0.3), ctx);

    expect(result.status).toBe("rejected");
    expect(store._files[ctx.trainingFile]).toBeUndefined();
    expect(store._files[ctx.heldOutFile]).toBeUndefined();
  });

  it("appends when |reward| equals confidenceThreshold exactly", async () => {
    const { ctx } = makeContext();

    const result = await appendToBuffer(candidate(-0.5), ctx);

    expect(result.status).not.toBe("rejected");
  });

  it("applies gate on absolute value — positive reward also gated", async () => {
    const { ctx, store } = makeContext();

    await appendToBuffer(candidate(0.8), ctx);

    const written = store._files[ctx.heldOutFile] ?? store._files[ctx.trainingFile];
    expect(written).toHaveLength(1);
  });
});

describe("appendToBuffer — JSONL format", () => {
  it("appended line is valid JSON containing all DPO fields", async () => {
    const { ctx, store } = makeContext();
    const c = candidate(-0.72);

    await appendToBuffer(c, ctx);

    const line = (store._files[ctx.heldOutFile] ?? store._files[ctx.trainingFile])![0];
    const parsed = JSON.parse(line);
    expect(parsed.prompt).toBe(c.prompt);
    expect(parsed.chosen).toBe(c.chosen);
    expect(parsed.rejected).toBe(c.rejected);
    expect(parsed.reward).toBe(c.reward);
  });
});

describe("appendToBuffer — held-out vs training routing", () => {
  it("first N candidates go to held-out file", async () => {
    const { ctx, store } = makeContext({ heldOutSize: 3 });

    await appendToBuffer(candidate(-0.8), ctx);
    await appendToBuffer(candidate(-0.7), ctx);
    await appendToBuffer(candidate(-0.6), ctx);

    expect(store._files[ctx.heldOutFile]).toHaveLength(3);
    expect(store._files[ctx.trainingFile]).toBeUndefined();
  });

  it("candidates after held-out is full go to training file only", async () => {
    const { ctx, store } = makeContext({ heldOutSize: 2 });

    await appendToBuffer(candidate(-0.9), ctx);
    await appendToBuffer(candidate(-0.8), ctx);
    // held-out now full
    await appendToBuffer(candidate(-0.7), ctx);
    await appendToBuffer(candidate(-0.6), ctx);

    expect(store._files[ctx.heldOutFile]).toHaveLength(2);
    expect(store._files[ctx.trainingFile]).toHaveLength(2);
  });

  it("returns destination 'held_out' while held-out set incomplete", async () => {
    const { ctx } = makeContext({ heldOutSize: 3 });

    const result = await appendToBuffer(candidate(-0.8), ctx);

    expect(result.status).toBe("appended");
    if (result.status === "appended") {
      expect(result.destination).toBe("held_out");
    }
  });

  it("returns destination 'training' once held-out set is full", async () => {
    const { ctx } = makeContext({ heldOutSize: 1 });

    await appendToBuffer(candidate(-0.9), ctx); // fills held-out
    const result = await appendToBuffer(candidate(-0.8), ctx);

    expect(result.status).toBe("appended");
    if (result.status === "appended") {
      expect(result.destination).toBe("training");
    }
  });
});

describe("readTrainingSet", () => {
  it("returns parsed candidates from training file only", async () => {
    const { ctx, store } = makeContext({ heldOutSize: 1 });

    await appendToBuffer(candidate(-0.9), ctx); // → held-out
    await appendToBuffer(candidate(-0.8), ctx); // → training
    await appendToBuffer(candidate(-0.7), ctx); // → training

    const training = await readTrainingSet(ctx);

    expect(training).toHaveLength(2);
    expect(training[0]).toMatchObject({ reward: -0.8 * 1 });
  });

  it("returns empty array when training file has no candidates", async () => {
    const { ctx } = makeContext();

    const training = await readTrainingSet(ctx);

    expect(training).toEqual([]);
  });
});
