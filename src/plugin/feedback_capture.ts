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

export function handleMessageReceived(
  event: MessageEvent,
  context: MessageContext,
): MessageFeedbackEvent {
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
  event: ToolCallEvent,
  context: ToolCallContext,
): ToolCallFeedbackEvent {
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

const plugin = {
  id: "reinforteach",
  name: "Reinforteach",
  register(api: { on: (event: string, handler: (...args: unknown[]) => unknown) => void }) {
    api.on("message_received", (event: unknown, context: unknown) =>
      handleMessageReceived(event as MessageEvent, context as MessageContext),
    );
    api.on("after_tool_call", (event: unknown, context: unknown) =>
      handleAfterToolCall(event as ToolCallEvent, context as ToolCallContext),
    );
  },
};

export default plugin;
