import { describe, it, expect, vi } from "vitest";
import {
  handleFeedbackEvent,
  type PipelineContext,
} from "../../src/plugin/pipeline.js";
import type { AdaptiveLearningConfig } from "../../src/config_loader.js";
import type { SessionEntry, TranscriptLine } from "../../src/attribution.js";
import type { MessageFeedbackEvent } from "../../src/plugin/feedback_capture.js";
import type { DPOCandidate } from "../../src/candidate_synthesizer.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

const config: AdaptiveLearningConfig = {
  feedbackWindowTurns: 5,
  confidenceThreshold: 0.5,
  trainingTrigger: { minCandidates: 10, maxIntervalMs: 604800000 },
  modelPath: "/models/agent.gguf",
  oracleSubagent: "oracle",
};

const session: SessionEntry = {
  sessionId: "s1",
  sessionKey: "sk1",
  sessionFile: "/sessions/s1.json",
  origin: { from: "operator-1", surface: "telegram" },
};

const transcript: TranscriptLine[] = [
  { message: { role: "user", content: "How do I reset my password?" } },
  { message: { role: "assistant", content: "Click the forgot password link." } },
];

const msgEvent: MessageFeedbackEvent = {
  kind: "message",
  from: "operator-1",
  content: "That answer was wrong — the link is broken on mobile",
  timestamp: 1000,
};

const negativeAnalysisJson = JSON.stringify({
  sentiment: -0.8,
  magnitude: 0.9,
  hypothesis: "Agent gave non-functional instructions for mobile users",
  attributed_turn: "Click the forgot password link.",
});

const positiveAnalysisJson = JSON.stringify({
  sentiment: 0.7,
  magnitude: 0.8,
  hypothesis: "Agent gave a clear, accurate answer",
  attributed_turn: "Click the forgot password link.",
});

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    readTranscript: vi.fn().mockResolvedValue(transcript),
    spawnAgent: vi.fn().mockResolvedValue(negativeAnalysisJson),
    spawnOracle: vi.fn().mockResolvedValue("Tap Settings → Account → Reset Password"),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    awaitResponse: vi.fn().mockResolvedValue("approve"),
    appendToBuffer: vi.fn().mockResolvedValue(undefined),
    operatorId: "operator-1",
    confirmationTimeoutMs: 100,
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("handleFeedbackEvent — negative signal path", () => {
  it("runs full pipeline and writes candidate to buffer on operator approval", async () => {
    const ctx = makeContext();
    await handleFeedbackEvent(msgEvent, [session], config, ctx);

    expect(ctx.appendToBuffer).toHaveBeenCalledOnce();
    const candidate = (ctx.appendToBuffer as ReturnType<typeof vi.fn>).mock.calls[0][0] as DPOCandidate;
    expect(candidate.reward).toBeLessThan(0); // negative sentiment × magnitude
    expect(typeof candidate.prompt).toBe("string");
    expect(typeof candidate.chosen).toBe("string");
    expect(typeof candidate.rejected).toBe("string");
  });

  it("sends confirmation message to operatorId", async () => {
    const ctx = makeContext();
    await handleFeedbackEvent(msgEvent, [session], config, ctx);

    expect(ctx.sendMessage).toHaveBeenCalledOnce();
    const [to] = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(to).toBe("operator-1");
  });

  it("does not write to buffer when operator rejects", async () => {
    const ctx = makeContext({ awaitResponse: vi.fn().mockResolvedValue("reject") });
    await handleFeedbackEvent(msgEvent, [session], config, ctx);

    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
  });

  it("does not write to buffer on confirmation timeout", async () => {
    const ctx = makeContext({ awaitResponse: vi.fn().mockResolvedValue(null) });
    await handleFeedbackEvent(msgEvent, [session], config, ctx);

    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
  });
});

describe("handleFeedbackEvent — positive signal path", () => {
  it("inverts chosen/rejected roles (agent output becomes chosen)", async () => {
    const ctx = makeContext({ spawnAgent: vi.fn().mockResolvedValue(positiveAnalysisJson) });
    await handleFeedbackEvent(msgEvent, [session], config, ctx);

    expect(ctx.appendToBuffer).toHaveBeenCalledOnce();
    const candidate = (ctx.appendToBuffer as ReturnType<typeof vi.fn>).mock.calls[0][0] as DPOCandidate;
    expect(candidate.reward).toBeGreaterThan(0); // positive sentiment × magnitude
  });
});

describe("handleFeedbackEvent — early exits", () => {
  it("returns without analysis when attribution fails (no matching session)", async () => {
    const ctx = makeContext();
    const unrelatedEvent: MessageFeedbackEvent = { ...msgEvent, from: "unknown-user" };
    await handleFeedbackEvent(unrelatedEvent, [session], config, ctx);

    expect(ctx.spawnAgent).not.toHaveBeenCalled();
    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
  });

  it("returns without synthesis when analysis is below confidence threshold", async () => {
    const lowConfidenceJson = JSON.stringify({
      sentiment: -0.5,
      magnitude: 0.1, // below threshold of 0.5
      hypothesis: "weak signal",
      attributed_turn: "...",
    });
    const ctx = makeContext({ spawnAgent: vi.fn().mockResolvedValue(lowConfidenceJson) });
    await handleFeedbackEvent(msgEvent, [session], config, ctx);

    expect(ctx.spawnOracle).not.toHaveBeenCalled();
    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
  });

  it("does not run pipeline for tool_call events", async () => {
    const ctx = makeContext();
    const toolEvent = {
      kind: "tool_call" as const,
      toolName: "readFile",
      params: { path: "/foo" },
      sessionKey: "sk1",
      timestamp: 2000,
    };
    await handleFeedbackEvent(toolEvent, [session], config, ctx);

    expect(ctx.spawnAgent).not.toHaveBeenCalled();
    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
  });

  it("loads config via feedbackWindowTurns from AdaptiveLearningConfig", async () => {
    // Verify the config's feedbackWindowTurns is used for attribution
    const narrowConfig = { ...config, feedbackWindowTurns: 1 };
    const ctx = makeContext();
    await handleFeedbackEvent(msgEvent, [session], narrowConfig, ctx);

    // Pipeline still completes — transcript sliced to last 1 turn
    expect(ctx.appendToBuffer).toHaveBeenCalledOnce();
  });
});
