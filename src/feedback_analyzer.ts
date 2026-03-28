import type { AttributedFeedback } from "./attribution.js";
import { ValidationError } from "./errors.js";

export interface AnalysisResult {
  sentiment: number;
  magnitude: number;
  hypothesis: string;
  attributed_turn: string;
}

export interface SpawnParams {
  message: string;
  extraSystemPrompt: string;
  idempotencyKey: string;
}

export interface FeedbackAnalyzerContext {
  spawnAgent: (params: SpawnParams) => Promise<string>;
  confidenceThreshold: number;
  spawnedBy: string;
}

export async function analyzeFeedback(
  attributed: AttributedFeedback,
  context: FeedbackAnalyzerContext,
): Promise<AnalysisResult | null> {
  const { spawnAgent, confidenceThreshold, spawnedBy } = context;

  const contextSummary = attributed.contextWindow
    .map((t) => `${t.message.role}: ${t.message.content}`)
    .join("\n");

  const message = [
    `Session: ${attributed.sessionKey}`,
    `\nConversation context:\n${contextSummary}`,
    `\nOperator feedback: "${attributed.feedbackEvent.content}"`,
    `\nAnalyze the feedback. Return JSON with fields: sentiment (float -1 to 1), magnitude (float 0 to 1), hypothesis (string), attributed_turn (string).`,
  ].join("");

  const extraSystemPrompt = [
    "You are a Feedback Analyzer. Your role is to infer the sentiment and strength of operator feedback on an agent turn.",
    "sentiment < 0: operator is correcting the agent. sentiment > 0: operator is approving.",
    "magnitude: confidence/strength of the signal (0 = ambiguous, 1 = unambiguous).",
    "hypothesis: concise explanation of why this turn triggered the feedback.",
    "attributed_turn: the specific agent output being evaluated.",
    "Respond with valid JSON only. No prose.",
  ].join(" ");

  const raw = await spawnAgent({
    message,
    extraSystemPrompt,
    idempotencyKey: `feedback-analyzer-${attributed.sessionKey}-${attributed.feedbackEvent.timestamp}`,
  });

  const parsed = parseAndValidate(raw);

  if (parsed.magnitude < confidenceThreshold) return null;

  return parsed;
}

function parseAndValidate(raw: string): AnalysisResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationError(`Feedback Analyzer returned invalid JSON: ${raw.slice(0, 100)}`);
  }

  if (!obj || typeof obj !== "object") {
    throw new ValidationError("Feedback Analyzer response is not an object");
  }

  const r = obj as Record<string, unknown>;

  if (typeof r.sentiment !== "number") {
    throw new ValidationError("Feedback Analyzer response missing required field: sentiment");
  }
  if (typeof r.magnitude !== "number") {
    throw new ValidationError("Feedback Analyzer response missing required field: magnitude");
  }
  if (typeof r.hypothesis !== "string") {
    throw new ValidationError("Feedback Analyzer response missing required field: hypothesis");
  }
  if (typeof r.attributed_turn !== "string") {
    throw new ValidationError("Feedback Analyzer response missing required field: attributed_turn");
  }

  return {
    sentiment: r.sentiment,
    magnitude: r.magnitude,
    hypothesis: r.hypothesis,
    attributed_turn: r.attributed_turn,
  };
}
