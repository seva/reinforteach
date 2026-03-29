import { describe, it, expect, vi } from "vitest";
import { createPlugin, type PluginWireContext } from "../../src/plugin/feedback_capture.js";
import type { SessionEntry } from "../../src/attribution.js";
import type { AdaptiveLearningConfig } from "../../src/config_loader.js";
import type { PipelineContext } from "../../src/plugin/pipeline.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockSessions: SessionEntry[] = [
  { sessionId: "s1", sessionKey: "sk1", sessionFile: "/s/s1.json", origin: { from: "op", surface: "telegram" } },
];

const config: AdaptiveLearningConfig = {
  feedbackWindowTurns: 5,
  confidenceThreshold: 0.5,
  trainingTrigger: { minCandidates: 10, maxIntervalMs: 604800000 },
  modelPath: "/models/agent.gguf",
  oracleSubagent: "oracle",
};

const pipelineContext = {} as PipelineContext;

function makeWireContext(overrides: Partial<PluginWireContext> = {}): PluginWireContext {
  return {
    getSessions: vi.fn().mockResolvedValue(mockSessions),
    config,
    pipeline: pipelineContext,
    startScheduler: vi.fn(),
    ...overrides,
  };
}

function makeApi() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  return {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      handlers[event] = handler;
    },
    handlers,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("createPlugin — register wiring", () => {
  it("calls startScheduler on register", () => {
    const ctx = makeWireContext();
    const plugin = createPlugin(ctx, vi.fn().mockResolvedValue(undefined));
    plugin.register(makeApi());
    expect(ctx.startScheduler).toHaveBeenCalledOnce();
  });

  it("pipes message_received to handleEvent with parsed event, sessions, config, and pipeline", async () => {
    const ctx = makeWireContext();
    const handleEvent = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin(ctx, handleEvent);
    const api = makeApi();
    plugin.register(api);

    await api.handlers["message_received"](
      { from: "operator-1", content: "wrong answer", timestamp: 1000 },
      { channelId: "ch1", sessionKey: "sk1" },
    );

    expect(handleEvent).toHaveBeenCalledOnce();
    const [feedbackEvent, sessions, cfg, pipeline] = handleEvent.mock.calls[0] as unknown[];
    expect((feedbackEvent as { kind: string }).kind).toBe("message");
    expect((feedbackEvent as { from: string }).from).toBe("operator-1");
    expect(sessions).toBe(mockSessions);
    expect(cfg).toBe(config);
    expect(pipeline).toBe(pipelineContext);
  });

  it("calls getSessions before forwarding to handleEvent", async () => {
    const ctx = makeWireContext();
    const handleEvent = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin(ctx, handleEvent);
    const api = makeApi();
    plugin.register(api);

    await api.handlers["message_received"](
      { from: "op", content: "hi", timestamp: 1 },
      { channelId: "ch" },
    );

    expect(ctx.getSessions).toHaveBeenCalledOnce();
  });

  it("does not call handleEvent for after_tool_call events", async () => {
    const ctx = makeWireContext();
    const handleEvent = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin(ctx, handleEvent);
    const api = makeApi();
    plugin.register(api);

    await api.handlers["after_tool_call"](
      { toolName: "readFile", params: { path: "/foo" } },
      { agentId: "a1", sessionKey: "sk1", toolName: "readFile" },
    );

    expect(handleEvent).not.toHaveBeenCalled();
  });
});
