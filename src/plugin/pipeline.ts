import type { FeedbackEvent } from "./feedback_capture.js";
import type { SessionEntry, TranscriptLine } from "../attribution.js";
import type { SpawnParams } from "../feedback_analyzer.js";
import type { DPOCandidate } from "../candidate_synthesizer.js";
import type { AdaptiveLearningConfig } from "../config_loader.js";
import { attributeFeedback } from "../attribution.js";
import { analyzeFeedback } from "../feedback_analyzer.js";
import { synthesizeCandidate } from "../candidate_synthesizer.js";
import { handleConfirmation } from "../confirmation_handler.js";

export interface PipelineContext {
  readTranscript: (path: string) => Promise<TranscriptLine[]>;
  spawnAgent: (params: SpawnParams) => Promise<string>;
  spawnOracle: (params: SpawnParams) => Promise<string>;
  sendMessage: (to: string, text: string) => Promise<void>;
  awaitResponse: (from: string, timeoutMs: number) => Promise<string | null>;
  appendToBuffer: (candidate: DPOCandidate) => Promise<void>;
  operatorId: string;
  confirmationTimeoutMs: number;
  log?: (msg: string, ...args: unknown[]) => void;
}

export async function handleFeedbackEvent(
  event: FeedbackEvent,
  sessions: SessionEntry[],
  config: AdaptiveLearningConfig,
  context: PipelineContext,
): Promise<void> {
  // Pipeline only processes operator message feedback — tool_call events are attribution signals only.
  if (event.kind !== "message") return;

  const log = context.log ?? (() => {});
  const {
    readTranscript,
    spawnAgent,
    spawnOracle,
    sendMessage,
    awaitResponse,
    appendToBuffer,
    operatorId,
    confirmationTimeoutMs,
  } = context;

  // Step 1: Attribution
  const attributed = await attributeFeedback(event, {
    sessions,
    readTranscript,
    feedbackWindowTurns: config.feedbackWindowTurns,
  });

  if (!attributed) {
    log("pipeline: attribution failed — no matching session for event from %s", event.from);
    return;
  }

  // Step 2: Feedback analysis
  const analysis = await analyzeFeedback(attributed, {
    spawnAgent,
    confidenceThreshold: config.confidenceThreshold,
    spawnedBy: "reinforteach:feedback-analyzer",
  });

  if (!analysis) {
    log("pipeline: analysis below confidence threshold — discarding event from %s", event.from);
    return;
  }

  // Step 3: Candidate synthesis
  const candidate = await synthesizeCandidate(attributed, analysis, {
    spawnOracle,
    spawnedBy: "reinforteach:candidate-synthesizer",
  });

  // Step 4: Operator confirmation
  const outcome = await handleConfirmation(candidate, operatorId, analysis.hypothesis, {
    sendMessage,
    awaitResponse,
    appendToBuffer,
    timeoutMs: confirmationTimeoutMs,
  });

  log("pipeline: confirmation outcome: %s", outcome.status);
}
