import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ValidationError } from "../errors.js";
import type { SessionEntry } from "../attribution.js";
import { loadConfig } from "../config_loader.js";
import type { AdaptiveLearningConfig } from "../config_loader.js";
import type { PipelineContext } from "./pipeline.js";
import { handleFeedbackEvent } from "./pipeline.js";
import type { SpawnParams } from "../feedback_analyzer.js";
import { appendToBuffer } from "../training_buffer.js";
import { startCron, spawnTrainAndDeploy } from "../training_scheduler.js";
import { deployAdapter } from "../lora_deployer.js";
import { toSessionEntry } from "../session_adapter.js";

export interface MessageFeedbackEvent {
  kind: "message";
  from: string;
  content: string;
  timestamp: number;
  conversationId?: string;
  accountId?: string;
  sessionKey?: string;
}

export interface ToolCallFeedbackEvent {
  kind: "tool_call";
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  agentId?: string;
  sessionKey?: string;
  timestamp: number;
}

export type FeedbackEvent = MessageFeedbackEvent | ToolCallFeedbackEvent;

interface MessageEvent {
  from: string;
  content: string;
  timestamp?: number;
}

interface MessageContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
}

interface ToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

interface ToolCallContext {
  agentId: string;
  sessionKey: string;
  toolName: string;
}

function validateMessageEvent(event: unknown): asserts event is MessageEvent {
  if (!event || typeof event !== "object") throw new ValidationError("message event must be an object");
  const e = event as Record<string, unknown>;
  if (typeof e.from !== "string") throw new ValidationError("message event missing required field: from");
  if (typeof e.content !== "string") throw new ValidationError("message event missing required field: content");
}

function validateToolCallEvent(event: unknown): asserts event is ToolCallEvent {
  if (!event || typeof event !== "object") throw new ValidationError("tool_call event must be an object");
  const e = event as Record<string, unknown>;
  if (typeof e.toolName !== "string") throw new ValidationError("tool_call event missing required field: toolName");
  if (!e.params || typeof e.params !== "object") throw new ValidationError("tool_call event missing required field: params");
}

export function handleMessageReceived(
  event: unknown,
  context: MessageContext,
): MessageFeedbackEvent {
  validateMessageEvent(event);
  return {
    kind: "message",
    from: event.from,
    content: event.content,
    timestamp: event.timestamp ?? Date.now(),
    ...(context.conversationId !== undefined && { conversationId: context.conversationId }),
    ...(context.accountId !== undefined && { accountId: context.accountId }),
    ...(context.sessionKey !== undefined && { sessionKey: context.sessionKey }),
  };
}

export function handleAfterToolCall(
  event: unknown,
  context: ToolCallContext,
): ToolCallFeedbackEvent {
  validateToolCallEvent(event);
  return {
    kind: "tool_call",
    toolName: event.toolName,
    params: event.params,
    timestamp: Date.now(),
    ...(event.result !== undefined && { result: event.result }),
    ...(event.error !== undefined && { error: event.error }),
    ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
    ...(context.agentId !== undefined && { agentId: context.agentId }),
    ...(context.sessionKey !== undefined && { sessionKey: context.sessionKey }),
  };
}

export interface PluginWireContext {
  getSessions: () => Promise<SessionEntry[]>;
  config: AdaptiveLearningConfig;
  pipeline: PipelineContext;
  startScheduler: () => void;
}

export function createPlugin(
  context: PluginWireContext,
  handleEvent: (event: FeedbackEvent, sessions: SessionEntry[], config: AdaptiveLearningConfig, ctx: PipelineContext) => Promise<void>,
) {
  return {
    id: "reinforteach",
    name: "Reinforteach",
    register(api: { on: (event: string, handler: (...args: unknown[]) => unknown) => void }) {
      context.startScheduler();
      api.on("message_received", async (event: unknown, ctx: unknown) => {
        const feedbackEvent = handleMessageReceived(event, ctx as MessageContext);
        const sessions = await context.getSessions();
        await handleEvent(feedbackEvent, sessions, context.config, context.pipeline);
      });
      api.on("after_tool_call", (event: unknown, ctx: unknown) =>
        handleAfterToolCall(event, ctx as ToolCallContext),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Live plugin wiring — loaded by OpenClaw in production.
// Requires openclaw peer dependency at runtime.
// ---------------------------------------------------------------------------

type OpenClawApi = {
  config: unknown;
  pluginConfig: Record<string, unknown>;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  on: (event: string, handler: (...args: unknown[]) => unknown) => void;
  runtime: {
    agent: {
      session: {
        resolveStorePath: (cfg: unknown) => string;
        loadSessionStore: (storePath: string) => Record<string, {
          sessionId: string;
          sessionFile?: string;
          spawnedBy?: string;
          origin?: { from?: string; surface?: string; provider?: string; threadId?: string | number };
        }>;
      };
    };
    subagent: {
      run: (p: { sessionKey: string; message: string; extraSystemPrompt?: string; deliver?: boolean }) => Promise<{ runId: string }>;
      waitForRun: (p: { runId: string; timeoutMs?: number }) => Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
      getSessionMessages: (p: { sessionKey: string; limit?: number }) => Promise<{ messages: unknown[] }>;
    };
    state: { resolveStateDir: () => string };
  };
};

export interface _LivePluginTestSeam {
  pendingResponses: Map<string, (text: string | null) => void>;
  spawnAgent: (params: SpawnParams) => Promise<string>;
  spawnOracle: (params: SpawnParams) => Promise<string>;
  sendMessage: (to: string, text: string) => Promise<void>;
  awaitResponse: (from: string, timeoutMs: number) => Promise<string | null>;
}

export function _buildLivePlugin(api: OpenClawApi): _LivePluginTestSeam | undefined {
  // Config lives in plugins.entries.reinforteach.config in openclaw.json,
  // accessed via api.pluginConfig. loadConfig expects adaptive_learning at top level.
  if (!api.pluginConfig.adaptive_learning) {
    api.logger.warn("reinforteach: no adaptive_learning in plugin config — plugin inactive");
    return undefined;
  }
  const config = loadConfig(JSON.stringify(api.pluginConfig));

  // --- Sessions ---
  const storePath = api.runtime.agent.session.resolveStorePath(api.config);

  const getSessions = async (): Promise<SessionEntry[]> => {
    const store = api.runtime.agent.session.loadSessionStore(storePath);
    return Object.entries(store)
      .filter(([, e]) => !e.spawnedBy)
      .map(([sessionKey, e]) => {
        const sessionFile = e.sessionFile ?? "";
        return toSessionEntry(
          {
            sessionId: e.sessionId,
            sessionKey,
            sessionFile,
            origin: {
              from: e.origin?.from ?? "",
              surface: e.origin?.surface ?? e.origin?.provider ?? "",
              ...(e.origin?.threadId !== undefined && { threadId: String(e.origin.threadId) }),
            },
          },
          (prefix: string) => {
            try {
              const dir = path.dirname(sessionFile);
              const base = path.basename(sessionFile);
              return fs.readdirSync(dir)
                .filter((f) => f.startsWith(base + ".reset."))
                .map((f) => path.join(dir, f));
            } catch {
              return [];
            }
          },
        );
      });
  };

  // --- Subagent spawn ---
  const spawnSubagent = async (agentId: string, params: SpawnParams): Promise<string> => {
    const sessionKey = `agent:${agentId}:reinforteach-${crypto.randomUUID()}`;
    const { runId } = await api.runtime.subagent.run({
      sessionKey,
      message: params.message,
      ...(params.extraSystemPrompt && { extraSystemPrompt: params.extraSystemPrompt }),
      deliver: false,
    });
    const waited = await api.runtime.subagent.waitForRun({ runId, timeoutMs: params.timeout ?? 60_000 });
    if (waited.status === "error") throw new Error(`Subagent error: ${waited.error ?? "unknown"}`);
    if (waited.status === "timeout") throw new Error("Subagent timed out");
    const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 5 });
    const last = [...messages].reverse().find(
      (m) => typeof m === "object" && m !== null && (m as Record<string, unknown>).role === "assistant",
    );
    if (!last) throw new Error("Subagent produced no output");
    const content = (last as Record<string, unknown>).content;
    return typeof content === "string" ? content : JSON.stringify(content);
  };

  const spawnAgent = (params: SpawnParams) => spawnSubagent("main", params);
  const spawnOracle = (params: SpawnParams) => spawnSubagent(config.oracleSubagent, params);

  // --- Confirmation channel ---
  const pendingResponses = new Map<string, (text: string | null) => void>();
  let activeSessionKey = "agent:main:main";

  const sendMessage = async (_to: string, text: string): Promise<void> => {
    const { runId } = await api.runtime.subagent.run({
      sessionKey: activeSessionKey,
      message: text,
      extraSystemPrompt: "Output the user message exactly as received, with no changes or additions.",
      deliver: true,
    });
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: 30_000 });
  };

  const awaitResponse = (from: string, timeoutMs: number): Promise<string | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => { pendingResponses.delete(from); resolve(null); }, timeoutMs);
      pendingResponses.set(from, (text) => { clearTimeout(timer); resolve(text); });
    });

  // --- Buffer ---
  const stateDir = path.join(api.runtime.state.resolveStateDir(), "reinforteach");
  fs.mkdirSync(stateDir, { recursive: true });
  const trainingFile = path.join(stateDir, "training_buffer.jsonl");
  const heldOutFile = path.join(stateDir, "held_out.jsonl");

  const bufferCtx = {
    store: {
      append: (file: string, line: string) => fs.promises.appendFile(file, line + "\n"),
      lineCount: async (file: string) => {
        try { return (await fs.promises.readFile(file, "utf8")).split("\n").filter(Boolean).length; }
        catch { return 0; }
      },
      readLines: async (file: string) => {
        try { return (await fs.promises.readFile(file, "utf8")).split("\n").filter(Boolean); }
        catch { return []; }
      },
    },
    trainingFile,
    heldOutFile,
    confidenceThreshold: config.confidenceThreshold,
    heldOutSize: 5,
  };

  const readTranscript = async (filePath: string) => {
    try {
      return (await fs.promises.readFile(filePath, "utf8"))
        .split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch { return []; }
  };

  const log = (msg: string, ...args: unknown[]) =>
    api.logger.info(msg, args.length ? { args } : undefined);

  const pipelineCtx: PipelineContext = {
    readTranscript,
    spawnAgent,
    spawnOracle,
    sendMessage,
    awaitResponse,
    appendToBuffer: (c) => appendToBuffer(c, bufferCtx).then(() => {}),
    operatorId: "",
    confirmationTimeoutMs: 5 * 60 * 1000,
    log,
  };

  // --- Scheduler ---
  startCron(
    {
      getTrainingCount: async () => {
        const lines = await bufferCtx.store.readLines(trainingFile);
        return lines.length;
      },
      runTraining: () =>
        spawnTrainAndDeploy({
          bufferPath: trainingFile,
          heldOutPath: heldOutFile,
          outputDir: path.join(stateDir, "adapters"),
          modelPath: config.modelPath,
          minCandidates: config.trainingTrigger.minCandidates,
          convertScript: process.env.LLAMACPP_DIR
            ? path.join(process.env.LLAMACPP_DIR, "convert_lora_to_gguf.py")
            : undefined,
          deploy: async () => {
            await deployAdapter(
              { adapterId: 0, scale: 1.0 },
              { llamaCppBaseUrl: "http://localhost:8080", fetch: globalThis.fetch, log: { info: log, warn: log, error: log } },
            );
          },
        }),
      getNow: () => Date.now(),
      minCandidates: config.trainingTrigger.minCandidates,
      maxIntervalMs: config.trainingTrigger.maxIntervalMs,
    },
    60_000,
  );

  // --- Hooks ---
  api.on("message_received", async (event: unknown, context: unknown) => {
    const e = event as { from?: string; content?: string; timestamp?: number };
    const ctx = context as MessageContext & { sessionKey?: string; conversationId?: string };
    const from = e.from ?? "";

    if (ctx.sessionKey) activeSessionKey = ctx.sessionKey;
    else if (ctx.conversationId) activeSessionKey = ctx.conversationId;

    // Confirmation response — resolve pending promise and stop
    if (pendingResponses.has(from)) {
      pendingResponses.get(from)!(e.content ?? "");
      return;
    }

    try {
      const feedbackEvent = handleMessageReceived(event, ctx);
      const sessions = await getSessions();
      await handleFeedbackEvent(feedbackEvent, sessions, config, {
        ...pipelineCtx,
        operatorId: feedbackEvent.from,
      });
    } catch (err) {
      api.logger.error("reinforteach: pipeline error", { error: String(err) });
    }
  });

  api.on("after_tool_call", (event: unknown, ctx: unknown) => {
    handleAfterToolCall(event, ctx as ToolCallContext);
  });

  return { pendingResponses, spawnAgent, spawnOracle, sendMessage, awaitResponse };
}

const plugin = {
  id: "reinforteach",
  name: "Reinforteach",
  register(api: unknown) {
    try { _buildLivePlugin(api as OpenClawApi); }
    catch (err) { (api as OpenClawApi).logger.error("reinforteach: failed to initialise", { error: String(err) }); }
  },
};

export default plugin;
