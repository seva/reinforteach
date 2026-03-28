import type { DPOCandidate } from "./candidate_synthesizer.js";

export type ConfirmationOutcome =
  | { status: "approved" }
  | { status: "rejected" }
  | { status: "edited"; candidate: DPOCandidate }
  | { status: "timeout" };

export interface ConfirmationHandlerContext {
  sendMessage: (to: string, text: string) => Promise<void>;
  awaitResponse: (from: string, timeoutMs: number) => Promise<string | null>;
  appendToBuffer: (candidate: DPOCandidate) => Promise<void>;
  timeoutMs: number;
}

const APPROVAL_TOKENS = new Set(["approve", "yes", "+1"]);
const REJECTION_TOKENS = new Set(["reject", "no", "-1"]);

export async function handleConfirmation(
  candidate: DPOCandidate,
  operatorId: string,
  hypothesis: string,
  context: ConfirmationHandlerContext,
): Promise<ConfirmationOutcome> {
  const { sendMessage, awaitResponse, appendToBuffer, timeoutMs } = context;

  const message = [
    `Feedback hypothesis: ${hypothesis}`,
    `\nChosen (preferred): ${candidate.chosen}`,
    `\nRejected (penalized): ${candidate.rejected}`,
    `\nReply "approve" / "yes" / "+1" to confirm, "reject" / "no" / "-1" to discard, or send a corrected completion to edit.`,
  ].join("");

  await sendMessage(operatorId, message);

  const response = await awaitResponse(operatorId, timeoutMs);

  if (response === null) return { status: "timeout" };

  const normalized = response.trim().toLowerCase();

  if (APPROVAL_TOKENS.has(normalized)) {
    await appendToBuffer(candidate);
    return { status: "approved" };
  }

  if (REJECTION_TOKENS.has(normalized)) {
    return { status: "rejected" };
  }

  // Treat any other response as an edited chosen completion
  const edited: DPOCandidate = { ...candidate, chosen: response.trim() };
  await appendToBuffer(edited);
  return { status: "edited", candidate: edited };
}
