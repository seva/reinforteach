import { describe, it, expect } from "vitest";
import { synthesizeCandidate } from "../../src/candidate_synthesizer.js";
import type { CandidateSynthesizerContext } from "../../src/candidate_synthesizer.js";
import { ValidationError } from "../../src/errors.js";
import type { AttributedFeedback } from "../../src/attribution.js";
import type { AnalysisResult } from "../../src/feedback_analyzer.js";

const attributed: AttributedFeedback = {
  feedbackEvent: {
    kind: "message",
    from: "operator",
    content: "That answer was wrong",
    timestamp: Date.now(),
  },
  sessionKey: "agent:test-agent:session-1",
  contextWindow: [
    { message: { role: "user", content: "What is the capital of France?" } },
    { message: { role: "assistant", content: "The capital of France is Berlin." } },
  ],
};

const negativeAnalysis: AnalysisResult = {
  sentiment: -0.8,
  magnitude: 0.9,
  hypothesis: "Agent stated incorrect capital city",
  attributed_turn: "The capital of France is Berlin.",
};

const positiveAnalysis: AnalysisResult = {
  sentiment: 0.7,
  magnitude: 0.85,
  hypothesis: "Agent gave correct and concise answer",
  attributed_turn: "The capital of France is Paris.",
};

const makeContext = (oracleResponse: string): CandidateSynthesizerContext => ({
  spawnOracle: async () => oracleResponse,
  spawnedBy: "agent:test-agent:session-1",
});

describe("synthesizeCandidate — negative path", () => {
  it("sets chosen to oracle completion and rejected to agent output", async () => {
    const ctx = makeContext("The capital of France is Paris.");

    const result = await synthesizeCandidate(attributed, negativeAnalysis, ctx);

    expect(result.chosen).toBe("The capital of France is Paris.");
    expect(result.rejected).toBe("The capital of France is Berlin.");
  });

  it("reward = sentiment × magnitude (negative)", async () => {
    const ctx = makeContext("Paris.");

    const result = await synthesizeCandidate(attributed, negativeAnalysis, ctx);

    expect(result.reward).toBeCloseTo(-0.8 * 0.9);
    expect(result.reward).toBeLessThan(0);
  });
});

describe("synthesizeCandidate — positive path", () => {
  const positiveAttributed: AttributedFeedback = {
    ...attributed,
    contextWindow: [
      { message: { role: "user", content: "What is the capital of France?" } },
      { message: { role: "assistant", content: "The capital of France is Paris." } },
    ],
  };

  it("sets chosen to agent output and rejected to oracle-degraded version", async () => {
    const ctx = makeContext("The capital of France is Berlin.");

    const result = await synthesizeCandidate(positiveAttributed, positiveAnalysis, ctx);

    expect(result.chosen).toBe("The capital of France is Paris.");
    expect(result.rejected).toBe("The capital of France is Berlin.");
  });

  it("reward = sentiment × magnitude (positive)", async () => {
    const ctx = makeContext("Berlin.");

    const result = await synthesizeCandidate(positiveAttributed, positiveAnalysis, ctx);

    expect(result.reward).toBeCloseTo(0.7 * 0.85);
    expect(result.reward).toBeGreaterThan(0);
  });
});

describe("synthesizeCandidate — output schema", () => {
  it("output has all four DPO fields: prompt, chosen, rejected, reward", async () => {
    const ctx = makeContext("Paris.");

    const result = await synthesizeCandidate(attributed, negativeAnalysis, ctx);

    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("chosen");
    expect(result).toHaveProperty("rejected");
    expect(result).toHaveProperty("reward");
    expect(typeof result.prompt).toBe("string");
    expect(typeof result.chosen).toBe("string");
    expect(typeof result.rejected).toBe("string");
    expect(typeof result.reward).toBe("number");
  });

  it("prompt contains the user context, not the agent turn", async () => {
    const ctx = makeContext("Paris.");

    const result = await synthesizeCandidate(attributed, negativeAnalysis, ctx);

    expect(result.prompt).toContain("What is the capital of France?");
    expect(result.prompt).not.toContain("The capital of France is Berlin.");
  });
});

describe("synthesizeCandidate — validation", () => {
  it("throws ValidationError when context window has no assistant turn", async () => {
    const noAssistant: AttributedFeedback = {
      ...attributed,
      contextWindow: [
        { message: { role: "user", content: "What is 2+2?" } },
      ],
    };
    const ctx = makeContext("4.");

    await expect(synthesizeCandidate(noAssistant, negativeAnalysis, ctx)).rejects.toThrow(
      ValidationError,
    );
  });

  it("propagates oracle rejection without swallowing it", async () => {
    const ctx: CandidateSynthesizerContext = {
      spawnOracle: async () => { throw new Error("oracle unavailable"); },
      spawnedBy: "agent:test-agent:session-1",
    };

    await expect(synthesizeCandidate(attributed, negativeAnalysis, ctx)).rejects.toThrow(
      "oracle unavailable",
    );
  });
});
