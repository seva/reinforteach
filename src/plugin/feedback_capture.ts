import { ValidationError } from "../errors.js";
import type { SessionEntry } from "../attribution.js";
import type { AdaptiveLearningConfig } from "../config_loader.js";
import type { PipelineContext } from "./pipeline.js";

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

const plugin = {
  id: "reinforteach",
  name: "Reinforteach",
  register(api: { on: (event: string, handler: (...args: unknown[]) => unknown) => void }) {
    api.on("message_received", (event: unknown, context: unknown) =>
      handleMessageReceived(event, context as MessageContext),
    );
    api.on("after_tool_call", (event: unknown, context: unknown) =>
      handleAfterToolCall(event, context as ToolCallContext),
    );
  },
};

export default plugin;
