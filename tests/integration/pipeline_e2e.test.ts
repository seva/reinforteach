/**
 * Phase 5 end-to-end verification.
 *
 * Exercises the full TypeScript pipeline from message_received hook through
 * attribution → feedback analyzer → candidate synthesizer → confirmation →
 * training buffer, using the real implementations of every business-logic
 * component. Only external API calls (subagent, session store, scheduler,
 * deployer) are mocked.
 *
 * Verifies: a candidate appears in training_buffer.jsonl or held_out.jsonl
 * after a single synthetic feedback event.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mock only external-boundary modules — never business logic.
vi.mock("../../src/training_scheduler.js", () => ({
  startCron: vi.fn(),
  spawnTrainAndDeploy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/lora_deployer.js", () => ({
  deployAdapter: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeSyntheticTranscript(filePath: string) {
  const lines = [
    { message: { role: "user", content: "How do I check recent changes in git?" } },
    { message: { role: "assistant", content: "You should run git status to see uncommitted changes." } },
  ];
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

function makeSubagentMessages(sessionKey: string) {
  // Feedback analyzer session → AnalysisResult JSON
  if (sessionKey.startsWith("agent:main:")) {
    return {
      messages: [{
        role: "assistant",
        content: JSON.stringify({
          sentiment: -0.8,
          magnitude: 0.9,
          hypothesis: "git status was wrong; operator wanted git log",
          attributed_turn: "You should run git status to see uncommitted changes.",
        }),
      }],
    };
  }
  // Oracle session → chosen completion text
  if (sessionKey.startsWith("agent:guru:")) {
    return {
      messages: [{
        role: "assistant",
        content: "You should run git log --oneline -10 to see recent commits.",
      }],
    };
  }
  return { messages: [{ role: "assistant", content: "ok" }] };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Phase 5 verification — pipeline_e2e", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("feedback event flows through full pipeline and writes candidate to buffer", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reinforteach-e2e-"));
    const sessionFile = path.join(tmpDir, "main.jsonl");
    writeSyntheticTranscript(sessionFile);

    const sessionStore = {
      "agent:main:main": {
        sessionId: "s-e2e-1",
        sessionFile,
        origin: { from: "operator", surface: "telegram", threadId: "123" },
      },
    };

    const subagentRun = vi.fn().mockResolvedValue({ runId: "run-e2e" });
    const subagentWait = vi.fn().mockResolvedValue({ status: "ok" });
    const subagentGetMessages = vi.fn().mockImplementation(
      async ({ sessionKey }: { sessionKey: string }) => makeSubagentMessages(sessionKey),
    );

    const api = {
      config: {},
      pluginConfig: {
        adaptive_learning: {
          feedback_window_turns: 10,
          confidence_threshold: 0.5,
          training_trigger: { min_candidates: 10, max_interval: "7d" },
          model_path: "/models/test.gguf",
          oracle_subagent: "guru",
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn((msg: string, meta: unknown) => {
          throw new Error(`Plugin error — ${msg}: ${JSON.stringify(meta)}`);
        }),
      },
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        hooks[event] = handler;
      }),
      runtime: {
        agent: {
          session: {
            resolveStorePath: vi.fn().mockReturnValue("/state/sessions.json"),
            loadSessionStore: vi.fn().mockReturnValue(sessionStore),
          },
        },
        subagent: { run: subagentRun, waitForRun: subagentWait, getSessionMessages: subagentGetMessages },
        state: { resolveStateDir: vi.fn().mockReturnValue(tmpDir) },
      },
    };

    const hooks: Record<string, (...args: unknown[]) => unknown> = {};

    // Import the plugin (no node:fs mock — real FS writes for buffer)
    const { _buildLivePlugin } = await import("../../src/plugin/feedback_capture.js");
    const seam = _buildLivePlugin(api);

    expect(seam).toBeDefined();
    expect(hooks["message_received"]).toBeDefined();

    // Auto-approve confirmation: whenever pendingResponses.set is called,
    // immediately schedule an "approve" resolution so confirmation completes.
    const origSet = seam!.pendingResponses.set.bind(seam!.pendingResponses);
    (seam!.pendingResponses as Map<string, (text: string | null) => void>).set = (
      key: string,
      fn: (text: string | null) => void,
    ) => {
      origSet(key, fn);
      Promise.resolve().then(() => fn("approve"));
    };

    // Fire the feedback event (fire-and-forget — returns immediately)
    hooks["message_received"](
      {
        from: "operator",
        content: "That was wrong — I wanted to see recent commits, not uncommitted changes.",
        timestamp: Date.now(),
      },
      { channelId: "telegram", sessionKey: "agent:main:main" },
    );

    // Wait for the async pipeline to complete (all subagents are mocked, so it's fast)
    await new Promise((r) => setTimeout(r, 200));

    // Plugin creates files under tmpDir/reinforteach/ (the stateDir subdir)
    const trainingFile = path.join(tmpDir, "reinforteach", "training_buffer.jsonl");
    const heldOutFile = path.join(tmpDir, "reinforteach", "held_out.jsonl");

    const bufferPath = fs.existsSync(heldOutFile) ? heldOutFile : trainingFile;
    expect(fs.existsSync(bufferPath), "no buffer file found").toBe(true);

    const lines = fs.readFileSync(bufferPath, "utf8").split("\n").filter(Boolean);
    expect(lines, "buffer should have exactly 1 candidate").toHaveLength(1);

    const candidate = JSON.parse(lines[0]);
    expect(candidate).toMatchObject({
      prompt: expect.any(String),
      chosen: expect.stringContaining("git log"),  // oracle response
      rejected: expect.stringContaining("git status"),  // agent's original response
      reward: expect.any(Number),
    });
    expect(candidate.reward).toBeLessThan(0);  // negative sentiment → negative reward
  });
});
