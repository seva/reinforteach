import { describe, it, expect } from "vitest";
import { analyzeFeedback } from "../../src/feedback_analyzer.js";
import type { FeedbackAnalyzerContext } from "../../src/feedback_analyzer.js";
import { ValidationError } from "../../src/errors.js";
import type { AttributedFeedback } from "../../src/attribution.js";
import type { MessageFeedbackEvent } from "../../src/plugin/feedback_capture.js";

const attributed: AttributedFeedback = {
  feedbackEvent: {
    kind: "message",
    from: "operator",
    content: "That answer was wrong",
    timestamp: Date.now(),
  } satisfies MessageFeedbackEvent,
  sessionKey: "agent:test-agent:session-1",
  contextWindow: [
    { message: { role: "user", content: "What is the capital of France?" } },
    { message: { role: "assistant", content: "The capital of France is Berlin." } },
  ],
};

const makeContext = (
  responseJson: object,
  confidenceThreshold = 0.7,
): FeedbackAnalyzerContext => ({
  spawnAgent: async () => JSON.stringify(responseJson),
  confidenceThreshold,
  spawnedBy: "agent:test-agent:session-1",
});

describe("analyzeFeedback — happy path", () => {
  it("returns parsed AnalysisResult with all core fields", async () => {
    const ctx = makeContext({
      sentiment: -0.8,
      magnitude: 0.9,
      hypothesis: "Agent stated incorrect capital city",
      attributed_turn: "The capital of France is Berlin.",
    });

    const result = await analyzeFeedback(attributed, ctx);

    expect(result).not.toBeNull();
    expect(result!.sentiment).toBe(-0.8);
    expect(result!.magnitude).toBe(0.9);
    expect(result!.hypothesis).toBe("Agent stated incorrect capital city");
    expect(result!.attributed_turn).toBe("The capital of France is Berlin.");
  });

  it("negative sentiment path: sentiment < 0, magnitude > 0", async () => {
    const ctx = makeContext({ sentiment: -0.6, magnitude: 0.85, hypothesis: "h", attributed_turn: "t" });

    const result = await analyzeFeedback(attributed, ctx);

    expect(result!.sentiment).toBeLessThan(0);
    expect(result!.magnitude).toBeGreaterThan(0);
  });

  it("positive sentiment path: sentiment > 0", async () => {
    const ctx = makeContext({ sentiment: 0.7, magnitude: 0.8, hypothesis: "h", attributed_turn: "t" });

    const result = await analyzeFeedback(attributed, ctx);

    expect(result!.sentiment).toBeGreaterThan(0);
  });
});

describe("analyzeFeedback — confidence filtering", () => {
  it("returns null when magnitude is below confidence threshold", async () => {
    const ctx = makeContext(
      { sentiment: -0.9, magnitude: 0.4, hypothesis: "h", attributed_turn: "t" },
      0.7,
    );

    const result = await analyzeFeedback(attributed, ctx);

    expect(result).toBeNull();
  });

  it("returns result when magnitude equals confidence threshold exactly", async () => {
    const ctx = makeContext(
      { sentiment: -0.9, magnitude: 0.7, hypothesis: "h", attributed_turn: "t" },
      0.7,
    );

    const result = await analyzeFeedback(attributed, ctx);

    expect(result).not.toBeNull();
  });
});

describe("analyzeFeedback — subagent response validation", () => {
  it("throws ValidationError when subagent returns invalid JSON", async () => {
    const ctx: FeedbackAnalyzerContext = {
      spawnAgent: async () => "not valid json {{",
      confidenceThreshold: 0.7,
      spawnedBy: "agent:test-agent:session-1",
    };

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when sentiment field is missing", async () => {
    const ctx = makeContext({ magnitude: 0.9, hypothesis: "h", attributed_turn: "t" });

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when magnitude field is missing", async () => {
    const ctx = makeContext({ sentiment: -0.8, hypothesis: "h", attributed_turn: "t" });

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when hypothesis field is missing", async () => {
    const ctx = makeContext({ sentiment: -0.8, magnitude: 0.9, attributed_turn: "t" });

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when attributed_turn field is missing", async () => {
    const ctx = makeContext({ sentiment: -0.8, magnitude: 0.9, hypothesis: "h" });

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when subagent returns valid JSON but not an object", async () => {
    const ctx: FeedbackAnalyzerContext = {
      spawnAgent: async () => "null",
      confidenceThreshold: 0.7,
      spawnedBy: "agent:test-agent:session-1",
    };

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow(ValidationError);
  });

  it("propagates spawnAgent rejection without swallowing it", async () => {
    const ctx: FeedbackAnalyzerContext = {
      spawnAgent: async () => { throw new Error("gateway unavailable"); },
      confidenceThreshold: 0.7,
      spawnedBy: "agent:test-agent:session-1",
    };

    await expect(analyzeFeedback(attributed, ctx)).rejects.toThrow("gateway unavailable");
  });
});
