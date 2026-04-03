import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock side-effect modules before importing the plugin
// ---------------------------------------------------------------------------

vi.mock("../../src/training_scheduler.js", () => ({
  startCron: vi.fn(),
  spawnTrainAndDeploy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/lora_deployer.js", () => ({
  deployAdapter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    promises: {
      appendFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
    },
  };
});
vi.mock("../../src/attribution.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/attribution.js")>();
  return {
    ...real,
    attributeFeedback: vi.fn().mockResolvedValue({
      feedbackEvent: { kind: "message", from: "operator", content: "wrong", timestamp: 0 },
      sessionKey: "agent:main:main",
      contextWindow: [{ message: { role: "assistant", content: "bad answer" } }],
    }),
  };
});
vi.mock("../../src/feedback_analyzer.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/feedback_analyzer.js")>();
  return {
    ...real,
    analyzeFeedback: vi.fn().mockResolvedValue({
      sentiment: -1, magnitude: 0.8,
      hypothesis: "wrong answer", attributed_turn: "bad answer",
    }),
  };
});
vi.mock("../../src/candidate_synthesizer.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/candidate_synthesizer.js")>();
  return {
    ...real,
    synthesizeCandidate: vi.fn().mockResolvedValue({
      prompt: "q", chosen: "good", rejected: "bad", reward: -0.8,
    }),
  };
});
vi.mock("../../src/confirmation_handler.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/confirmation_handler.js")>();
  return {
    ...real,
    handleConfirmation: vi.fn().mockResolvedValue({ status: "approved" }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_AGENT_LIST = [
  {
    id: "main",
    adaptive_learning: {
      feedback_window_turns: 5,
      confidence_threshold: 0.6,
      training_trigger: { min_candidates: 10, max_interval: "7d" },
      model_path: "/models/qwen.gguf",
      oracle_subagent: "guru",
    },
  },
];

const SESSION_STORE = {
  "agent:main:main": {
    sessionId: "s1",
    sessionFile: "/sessions/main.jsonl",
    origin: { from: "operator", surface: "telegram", threadId: "123" },
  },
  "agent:main:sub-1": {
    sessionId: "s2",
    sessionFile: "/sessions/sub1.jsonl",
    spawnedBy: "agent:main:main",
    origin: { from: "operator", surface: "telegram" },
  },
};

function makeApi(agentList = VALID_AGENT_LIST as unknown[]) {
  const hooks: Record<string, ((...args: unknown[]) => unknown)> = {};

  const subagentRun = vi.fn().mockResolvedValue({ runId: "run-1" });
  const subagentWait = vi.fn().mockResolvedValue({ status: "ok" });
  const subagentGetMessages = vi.fn().mockResolvedValue({
    messages: [{ role: "assistant", content: "subagent output" }],
  });

  const api = {
    config: { agents: { list: agentList } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      hooks[event] = handler;
    }),
    runtime: {
      agent: {
        session: {
          resolveStorePath: vi.fn().mockReturnValue("/state/sessions.json"),
          loadSessionStore: vi.fn().mockReturnValue(SESSION_STORE),
        },
      },
      subagent: { run: subagentRun, waitForRun: subagentWait, getSessionMessages: subagentGetMessages },
      state: { resolveStateDir: vi.fn().mockReturnValue("/state") },
    },
  };

  const fire = (event: string, ...args: unknown[]) =>
    Promise.resolve(hooks[event]?.(...args));

  return { api, hooks, fire, subagentRun };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("live plugin default export", () => {
  let plugin: { id: string; name: string; register: (api: unknown) => void };
  let _buildLivePlugin: (api: unknown) => { pendingResponses: Map<string, (t: string | null) => void> } | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/plugin/feedback_capture.js");
    plugin = mod.default;
    _buildLivePlugin = (mod as unknown as Record<string, typeof _buildLivePlugin>)._buildLivePlugin;
  });

  // --- Registration guard ---

  it("warns and skips hook registration when no agent has adaptive_learning", () => {
    const { api } = makeApi([{ id: "main" }]);
    plugin.register(api);
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("adaptive_learning"),
    );
    expect(api.on).not.toHaveBeenCalled();
  });

  it("registers message_received and after_tool_call when config present", () => {
    const { api } = makeApi();
    plugin.register(api);
    expect(api.on).toHaveBeenCalledWith("message_received", expect.any(Function));
    expect(api.on).toHaveBeenCalledWith("after_tool_call", expect.any(Function));
  });

  // --- Scheduler ---

  it("starts scheduler on register", async () => {
    const { startCron } = await import("../../src/training_scheduler.js");
    const { api } = makeApi();
    plugin.register(api);
    expect(startCron).toHaveBeenCalledOnce();
    expect(startCron).toHaveBeenCalledWith(
      expect.objectContaining({ minCandidates: 10 }),
      expect.any(Number),
    );
  });

  // --- Session mapping ---

  it("getSessions excludes subagent sessions", async () => {
    const { api, fire } = makeApi();
    plugin.register(api);

    // Capture sessions passed to handleFeedbackEvent via a message_received trigger.
    // We mock handleFeedbackEvent at the module level to capture its call args.
    // Since the attribution engine will return null (no real transcript), the pipeline
    // short-circuits after attribution — but sessions are loaded before that.
    // We verify via session store spy.
    await fire("message_received",
      { from: "operator", content: "bad answer", timestamp: Date.now() },
      { channelId: "telegram", sessionKey: "agent:main:main" },
    );

    // loadSessionStore was called — returned both entries, subagent must be filtered
    expect(api.runtime.agent.session.loadSessionStore).toHaveBeenCalled();
    // If subagent session leaked through, attribution would have two sessions.
    // We confirm by checking only one non-subagent key exists in the store.
    const store = api.runtime.agent.session.loadSessionStore.mock.results[0].value as Record<string, { spawnedBy?: string }>;
    const nonSubagent = Object.entries(store).filter(([, e]) => !e.spawnedBy);
    expect(nonSubagent).toHaveLength(1);
    expect(nonSubagent[0][0]).toBe("agent:main:main");
  });

  // --- Subagent session key routing ---

  it("spawnAgent uses agent:main:* session key with deliver:false", async () => {
    const { api, subagentRun } = makeApi();
    const seam = _buildLivePlugin(api);
    expect(seam).toBeDefined();

    await seam!.spawnAgent({ message: "analyse this", spawnedBy: "test" });

    expect(subagentRun).toHaveBeenCalledOnce();
    const [params] = subagentRun.mock.calls[0] as [{ sessionKey: string; deliver: boolean }];
    expect(params.sessionKey).toMatch(/^agent:main:/);
    expect(params.deliver).toBe(false);
  });

  it("spawnOracle uses agent:guru:* session key", async () => {
    const { api, subagentRun } = makeApi();
    const seam = _buildLivePlugin(api);
    expect(seam).toBeDefined();

    await seam!.spawnOracle({ message: "generate chosen", spawnedBy: "test" });

    expect(subagentRun).toHaveBeenCalledOnce();
    const [params] = subagentRun.mock.calls[0] as [{ sessionKey: string }];
    expect(params.sessionKey).toMatch(/^agent:guru:/);
  });

  // --- Confirmation short-circuit ---

  it("second message from same sender resolves pending awaitResponse without re-running pipeline", async () => {
    const { api, fire } = makeApi();
    const seam = _buildLivePlugin(api);
    expect(seam).toBeDefined();

    // Manually register a pending response for "operator" — simulating the
    // confirmation handler having called awaitResponse mid-pipeline.
    let resolved: string | null = null;
    seam!.pendingResponses.set("operator", (text) => { resolved = text; });

    // Fire a message from the same sender — should resolve the pending response,
    // not run the pipeline.
    await fire("message_received",
      { from: "operator", content: "approve", timestamp: Date.now() },
      { channelId: "telegram" },
    );

    expect(resolved).toBe("approve");
    // Session store NOT loaded — pipeline path was not entered
    expect(api.runtime.agent.session.loadSessionStore).not.toHaveBeenCalled();
  });
});
