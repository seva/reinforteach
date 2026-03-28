import type { FeedbackEvent } from "./plugin/feedback_capture.js";

export interface TranscriptLine {
  message: {
    role: "user" | "assistant" | "system" | "toolResult" | "tool";
    content: string;
    toolName?: string;
    toolCallId?: string;
  };
}

export interface SessionEntry {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  origin: {
    from: string;
    surface: string;
    threadId?: string | number;
  };
  archivedTranscripts?: string[];
}

export interface AttributedFeedback {
  feedbackEvent: FeedbackEvent;
  sessionKey: string;
  contextWindow: TranscriptLine[];
}

export interface AttributionContext {
  sessions: SessionEntry[];
  readTranscript: (path: string) => Promise<TranscriptLine[]>;
  feedbackWindowTurns: number;
}

export async function attributeFeedback(
  event: FeedbackEvent,
  context: AttributionContext,
): Promise<AttributedFeedback | null> {
  const { sessions, readTranscript, feedbackWindowTurns } = context;

  const session = findSession(event, sessions);
  if (!session) return null;

  const transcript = await resolveTranscript(session, readTranscript);
  const contextWindow = transcript.slice(-feedbackWindowTurns);

  return {
    feedbackEvent: event,
    sessionKey: session.sessionKey,
    contextWindow,
  };
}

function findSession(event: FeedbackEvent, sessions: SessionEntry[]): SessionEntry | null {
  if (event.kind === "tool_call" && event.sessionKey) {
    return sessions.find((s) => s.sessionKey === event.sessionKey) ?? null;
  }

  if (event.kind === "message") {
    return sessions.find((s) => s.origin.from === event.from) ?? null;
  }

  return null;
}

async function resolveTranscript(
  session: SessionEntry,
  readTranscript: (path: string) => Promise<TranscriptLine[]>,
): Promise<TranscriptLine[]> {
  const active = await readTranscript(session.sessionFile);
  if (active.length > 0) return active;

  if (session.archivedTranscripts && session.archivedTranscripts.length > 0) {
    const mostRecent = session.archivedTranscripts[session.archivedTranscripts.length - 1];
    return readTranscript(mostRecent);
  }

  return [];
}
