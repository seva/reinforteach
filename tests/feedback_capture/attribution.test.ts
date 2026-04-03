import { describe, it, expect } from "vitest";
import { attributeFeedback } from "../../src/attribution.js";
import type { SessionEntry, TranscriptLine } from "../../src/attribution.js";
import type { MessageFeedbackEvent, ToolCallFeedbackEvent } from "../../src/plugin/feedback_capture.js";
import { ReadFailedError } from "../../src/errors.js";

const makeTranscript = (count: number): TranscriptLine[] =>
  Array.from({ length: count }, (_, i) => ({
    message: {
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${i}`,
    },
  }));

const session: SessionEntry = {
  sessionId: "s1",
  sessionKey: "agent:test-agent:session-1",
  sessionFile: "/fake/transcript.jsonl",
  origin: { from: "operator", surface: "telegram", threadId: "123456789" },
};

const feedbackWindowTurns = 3;

describe("attributeFeedback — active session", () => {
  it("returns context window from the active transcript", async () => {
    const transcript = makeTranscript(5);
    const readTranscript = async (_path: string) => transcript;

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "operator",
      content: "That answer was wrong",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).not.toBeNull();
    expect(result!.sessionKey).toBe("agent:test-agent:session-1");
    expect(result!.contextWindow).toHaveLength(feedbackWindowTurns);
    expect(result!.contextWindow).toEqual(transcript.slice(-feedbackWindowTurns));
    expect(result!.feedbackEvent).toBe(event);
  });

  it("attributes a tool_call event by its sessionKey directly", async () => {
    const transcript = makeTranscript(4);
    const readTranscript = async (_path: string) => transcript;

    const event: ToolCallFeedbackEvent = {
      kind: "tool_call",
      toolName: "bash",
      params: { command: "ls" },
      sessionKey: "agent:test-agent:session-1",
      agentId: "test-agent",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).not.toBeNull();
    expect(result!.sessionKey).toBe("agent:test-agent:session-1");
    expect(result!.contextWindow).toHaveLength(feedbackWindowTurns);
  });

  it("returns fewer turns when transcript is shorter than feedbackWindowTurns", async () => {
    const transcript = makeTranscript(2);
    const readTranscript = async (_path: string) => transcript;

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "operator",
      content: "ok",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).not.toBeNull();
    expect(result!.contextWindow).toHaveLength(2);
  });
});

describe("attributeFeedback — session reset", () => {
  it("reads from archived transcript when session has been reset", async () => {
    const archivedPath = "/fake/transcript.jsonl.reset.2026-03-28T00:00:00.000Z";
    const archivedTranscript = makeTranscript(6);

    const resetSession: SessionEntry = {
      sessionId: "s2-after-reset",
      sessionKey: "agent:test-agent:session-1",
      sessionFile: "/fake/transcript-new.jsonl",
      origin: { from: "operator", surface: "telegram", threadId: "123456789" },
      archivedTranscripts: [archivedPath],
    };

    const readTranscript = async (path: string) => {
      if (path === archivedPath) return archivedTranscript;
      return [] as TranscriptLine[];
    };

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "operator",
      content: "That was still wrong",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [resetSession],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).not.toBeNull();
    expect(result!.contextWindow).toHaveLength(feedbackWindowTurns);
    expect(result!.contextWindow).toEqual(archivedTranscript.slice(-feedbackWindowTurns));
  });
});

describe("attributeFeedback — I/O failure", () => {
  it("returns null when readTranscript rejects (graceful degradation)", async () => {
    const readTranscript = async (_path: string): Promise<TranscriptLine[]> => {
      throw new ReadFailedError("disk read failed");
    };

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "operator",
      content: "wrong",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).toBeNull();
  });
});

describe("attributeFeedback — tool_call sessionKey no match", () => {
  it("returns null when tool_call sessionKey matches no session", async () => {
    const readTranscript = async (_path: string) => makeTranscript(3);

    const event: ToolCallFeedbackEvent = {
      kind: "tool_call",
      toolName: "bash",
      params: { command: "ls" },
      sessionKey: "agent:test-agent:session-2",
      agentId: "test-agent",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).toBeNull();
  });
});

describe("attributeFeedback — tool_call without sessionKey", () => {
  it("returns null when tool_call event has no sessionKey", async () => {
    const readTranscript = async (_path: string) => makeTranscript(3);

    const event: ToolCallFeedbackEvent = {
      kind: "tool_call",
      toolName: "bash",
      params: { command: "ls" },
      // sessionKey intentionally absent
      agentId: "test-agent",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).toBeNull();
  });
});

describe("attributeFeedback — empty transcript, no archives", () => {
  it("returns empty contextWindow when active transcript is empty and no archives exist", async () => {
    const sessionWithNoArchives: SessionEntry = {
      sessionId: "s1",
      sessionKey: "agent:test-agent:session-1",
      sessionFile: "/fake/transcript.jsonl",
      origin: { from: "operator", surface: "telegram" },
      // archivedTranscripts absent
    };

    const readTranscript = async (_path: string) => [] as TranscriptLine[];

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "operator",
      content: "ok",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [sessionWithNoArchives],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).not.toBeNull();
    expect(result!.contextWindow).toEqual([]);
  });
});

describe("attributeFeedback — no match", () => {
  it("returns null when no session matches the feedback sender", async () => {
    const readTranscript = async (_path: string) => [] as TranscriptLine[];

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "unknown-user",
      content: "hello",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [session],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).toBeNull();
  });

  it("returns null when sessions list is empty", async () => {
    const readTranscript = async (_path: string) => [] as TranscriptLine[];

    const event: MessageFeedbackEvent = {
      kind: "message",
      from: "operator",
      content: "hello",
      timestamp: Date.now(),
    };

    const result = await attributeFeedback(event, {
      sessions: [],
      readTranscript,
      feedbackWindowTurns,
    });

    expect(result).toBeNull();
  });
});
