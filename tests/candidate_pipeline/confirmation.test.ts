import { describe, it, expect, vi } from "vitest";
import { handleConfirmation } from "../../src/confirmation_handler.js";
import type { ConfirmationHandlerContext } from "../../src/confirmation_handler.js";
import type { DPOCandidate } from "../../src/candidate_synthesizer.js";

const candidate: DPOCandidate = {
  prompt: "user: What is the capital of France?",
  chosen: "The capital of France is Paris.",
  rejected: "The capital of France is Berlin.",
  reward: -0.72,
};

const operatorId = "operator";

const makeContext = (
  response: string | null,
  overrides: Partial<ConfirmationHandlerContext> = {},
): ConfirmationHandlerContext => ({
  sendMessage: vi.fn(async () => {}),
  awaitResponse: vi.fn(async () => response),
  appendToBuffer: vi.fn(async () => {}),
  timeoutMs: 5000,
  ...overrides,
});

describe("handleConfirmation — message content", () => {
  it("sends confirmation message containing hypothesis, chosen, and rejected", async () => {
    const ctx = makeContext("approve");
    const hypothesis = "Agent stated incorrect capital city";

    await handleConfirmation(candidate, operatorId, hypothesis, ctx);

    const [, messageText] = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(messageText).toContain(hypothesis);
    expect(messageText).toContain(candidate.chosen);
    expect(messageText).toContain(candidate.rejected);
  });

  it("sends confirmation message to the operator", async () => {
    const ctx = makeContext("approve");

    await handleConfirmation(candidate, operatorId, "h", ctx);

    const [sentTo] = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(sentTo).toBe(operatorId);
  });
});

describe("handleConfirmation — operator approval", () => {
  it.each(["approve", "yes", "+1"])('"%s" → appends original candidate to buffer', async (response) => {
    const ctx = makeContext(response);

    const result = await handleConfirmation(candidate, operatorId, "h", ctx);

    expect(ctx.appendToBuffer).toHaveBeenCalledWith(candidate);
    expect(result.status).toBe("approved");
  });
});

describe("handleConfirmation — operator rejection", () => {
  it.each(["reject", "no", "-1"])('"%s" → discards candidate, no buffer write', async (response) => {
    const ctx = makeContext(response);

    const result = await handleConfirmation(candidate, operatorId, "h", ctx);

    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
    expect(result.status).toBe("rejected");
  });
});

describe("handleConfirmation — operator edit", () => {
  it("non-keyword response → appends candidate with chosen replaced by edit", async () => {
    const editedChosen = "Paris is the capital of France.";
    const ctx = makeContext(editedChosen);

    const result = await handleConfirmation(candidate, operatorId, "h", ctx);

    expect(result.status).toBe("edited");
    if (result.status === "edited") {
      expect(result.candidate.chosen).toBe(editedChosen);
      expect(result.candidate.rejected).toBe(candidate.rejected);
      expect(result.candidate.prompt).toBe(candidate.prompt);
      expect(result.candidate.reward).toBe(candidate.reward);
    }
    expect(ctx.appendToBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ chosen: editedChosen }),
    );
  });
});

describe("handleConfirmation — timeout", () => {
  it("null response → discards candidate, no buffer write, returns timeout status", async () => {
    const ctx = makeContext(null);

    const result = await handleConfirmation(candidate, operatorId, "h", ctx);

    expect(ctx.appendToBuffer).not.toHaveBeenCalled();
    expect(result.status).toBe("timeout");
  });
});
