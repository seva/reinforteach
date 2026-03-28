import { describe, it, expect } from "vitest";
import { toSessionEntry } from "../../src/session_adapter.js";
import type { HostSession } from "../../src/session_adapter.js";

const host: HostSession = {
  sessionId: "s1",
  sessionKey: "agent:main:main",
  sessionFile: "/sessions/transcript.jsonl",
  origin: { from: "seva", surface: "telegram", threadId: "954092305" },
};

describe("toSessionEntry", () => {
  it("maps all HostSession fields through unchanged", () => {
    const entry = toSessionEntry(host, () => []);

    expect(entry.sessionId).toBe("s1");
    expect(entry.sessionKey).toBe("agent:main:main");
    expect(entry.sessionFile).toBe("/sessions/transcript.jsonl");
    expect(entry.origin).toEqual(host.origin);
  });

  it("derives archivedTranscripts via listFiles with sessionFile as prefix", () => {
    const archived = [
      "/sessions/transcript.jsonl.reset.2026-03-28T00:00:00.000Z",
      "/sessions/transcript.jsonl.reset.2026-03-27T12:00:00.000Z",
    ];
    const listFiles = (prefix: string) =>
      archived.filter((p) => p.startsWith(prefix));

    const entry = toSessionEntry(host, listFiles);

    expect(entry.archivedTranscripts).toEqual(expect.arrayContaining(archived));
    expect(entry.archivedTranscripts).toHaveLength(archived.length);
  });

  it("passes the correct prefix to listFiles", () => {
    let capturedPrefix = "";
    const listFiles = (prefix: string) => {
      capturedPrefix = prefix;
      return [];
    };

    toSessionEntry(host, listFiles);

    expect(capturedPrefix).toBe("/sessions/transcript.jsonl.reset.");
  });

  it("sets archivedTranscripts to empty array when no archives exist", () => {
    const entry = toSessionEntry(host, () => []);

    expect(entry.archivedTranscripts).toEqual([]);
  });

  it("sorts archived paths oldest-first so most recent is last", () => {
    const unsorted = [
      "/sessions/transcript.jsonl.reset.2026-03-28T00:00:00.000Z",
      "/sessions/transcript.jsonl.reset.2026-03-26T00:00:00.000Z",
      "/sessions/transcript.jsonl.reset.2026-03-27T00:00:00.000Z",
    ];
    const entry = toSessionEntry(host, () => unsorted);

    expect(entry.archivedTranscripts).toEqual([
      "/sessions/transcript.jsonl.reset.2026-03-26T00:00:00.000Z",
      "/sessions/transcript.jsonl.reset.2026-03-27T00:00:00.000Z",
      "/sessions/transcript.jsonl.reset.2026-03-28T00:00:00.000Z",
    ]);
  });
});
