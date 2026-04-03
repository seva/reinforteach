import { describe, it, expect } from "vitest";
import {
  handleMessageReceived,
  handleAfterToolCall,
} from "../../src/plugin/feedback_capture.js";
import { ValidationError } from "../../src/errors.js";

describe("handleMessageReceived", () => {
  it("produces a message FeedbackEvent with all core fields", () => {
    const event = {
      from: "operator",
      content: "That answer was wrong",
      timestamp: 1711584000000,
    };
    const context = {
      channelId: "telegram",
      accountId: "123456789",
      conversationId: "conv-abc",
    };

    const result = handleMessageReceived(event, context);

    expect(result.kind).toBe("message");
    expect(result.from).toBe("operator");
    expect(result.content).toBe("That answer was wrong");
    expect(result.timestamp).toBe(1711584000000);
    expect(result.conversationId).toBe("conv-abc");
    expect(result.sessionKey).toBeUndefined();
  });

  it("falls back to Date.now() when timestamp is absent", () => {
    const before = Date.now();
    const result = handleMessageReceived(
      { from: "operator", content: "ok" },
      { channelId: "telegram" },
    );
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it("tolerates missing optional context fields", () => {
    const result = handleMessageReceived(
      { from: "operator", content: "nice" },
      { channelId: "telegram" },
    );

    expect(result.conversationId).toBeUndefined();
    expect(result.accountId).toBeUndefined();
  });

  it("does not carry unknown fields through", () => {
    const result = handleMessageReceived(
      { from: "operator", content: "ok", extra: "noise" } as never,
      { channelId: "telegram" },
    );

    expect(result).not.toHaveProperty("extra");
  });

  it("throws ValidationError when from is missing", () => {
    expect(() =>
      handleMessageReceived({ content: "hi" } as never, { channelId: "telegram" }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when content is missing", () => {
    expect(() =>
      handleMessageReceived({ from: "operator" } as never, { channelId: "telegram" }),
    ).toThrow(ValidationError);
  });
});

describe("handleAfterToolCall", () => {
  it("produces a tool_call FeedbackEvent with all core fields", () => {
    const event = {
      toolName: "bash",
      params: { command: "ls" },
      result: { output: "file.txt" },
      durationMs: 42,
    };
    const context = {
      agentId: "test-agent",
      sessionKey: "agent:test-agent:session-1",
      toolName: "bash",
    };

    const result = handleAfterToolCall(event, context);

    expect(result.kind).toBe("tool_call");
    expect(result.toolName).toBe("bash");
    expect(result.params).toEqual({ command: "ls" });
    expect(result.result).toEqual({ output: "file.txt" });
    expect(result.agentId).toBe("test-agent");
    expect(result.sessionKey).toBe("agent:test-agent:session-1");
    expect(result.durationMs).toBe(42);
    expect(result.error).toBeUndefined();
  });

  it("captures error field when tool fails", () => {
    const event = {
      toolName: "bash",
      params: {},
      error: "command not found",
    };
    const context = {
      agentId: "test-agent",
      sessionKey: "agent:test-agent:session-1",
      toolName: "bash",
    };

    const result = handleAfterToolCall(event, context);

    expect(result.kind).toBe("tool_call");
    expect(result.error).toBe("command not found");
    expect(result.result).toBeUndefined();
  });

  it("does not carry unknown fields through", () => {
    const result = handleAfterToolCall(
      { toolName: "bash", params: {}, extra: "noise" } as never,
      { agentId: "test-agent", sessionKey: "agent:test-agent:session-1", toolName: "bash" },
    );

    expect(result).not.toHaveProperty("extra");
  });

  it("sets timestamp to Date.now() on creation", () => {
    const before = Date.now();
    const result = handleAfterToolCall(
      { toolName: "bash", params: {} },
      { agentId: "test-agent", sessionKey: "agent:test-agent:session-1", toolName: "bash" },
    );
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it("throws ValidationError when toolName is missing", () => {
    expect(() =>
      handleAfterToolCall(
        { params: {} } as never,
        { agentId: "test-agent", sessionKey: "agent:test-agent:session-1", toolName: "bash" },
      ),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when params is missing", () => {
    expect(() =>
      handleAfterToolCall(
        { toolName: "bash" } as never,
        { agentId: "test-agent", sessionKey: "agent:test-agent:session-1", toolName: "bash" },
      ),
    ).toThrow(ValidationError);
  });
});
