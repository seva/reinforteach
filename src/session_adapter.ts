import type { SessionEntry } from "./attribution.js";

/** Mirrors the real OpenClaw session schema — no derived fields. */
export interface HostSession {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  origin: {
    from: string;
    surface: string;
    threadId?: string | number;
  };
}

/**
 * Maps a raw host session to the domain SessionEntry used by the attribution engine.
 *
 * archivedTranscripts is derived — not present in the host schema. The real OpenClaw
 * gateway renames the transcript file to {sessionFile}.reset.{ISO-timestamp} on reset.
 * listFiles receives the prefix "{sessionFile}.reset." and returns matching paths.
 * Results are sorted oldest-first so the last entry is always the most recent archive.
 */
export function toSessionEntry(
  host: HostSession,
  listFiles: (prefix: string) => string[],
): SessionEntry {
  const prefix = `${host.sessionFile}.reset.`;
  const archivedTranscripts = listFiles(prefix).sort();

  return {
    sessionId: host.sessionId,
    sessionKey: host.sessionKey,
    sessionFile: host.sessionFile,
    origin: host.origin,
    archivedTranscripts,
  };
}
