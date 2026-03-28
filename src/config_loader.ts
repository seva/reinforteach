import { ValidationError } from "./errors.js";

export interface TrainingTrigger {
  minCandidates: number;
  maxIntervalMs: number;
}

export interface AdaptiveLearningConfig {
  feedbackWindowTurns: number;
  confidenceThreshold: number;
  trainingTrigger: TrainingTrigger;
  modelPath: string;
  oracleSubagent: string;
}

const INTERVAL_RE = /^(\d+)(d|h|m)$/;

function parseIntervalMs(value: string): number {
  const match = INTERVAL_RE.exec(value);
  if (!match) {
    throw new ValidationError(
      `Unrecognised max_interval format "${value}". Expected e.g. "7d", "24h", "30m".`,
    );
  }
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "d": return n * 24 * 60 * 60 * 1000;
    case "h": return n * 60 * 60 * 1000;
    case "m": return n * 60 * 1000;
  }
  // unreachable — regex only matches d|h|m
  throw new ValidationError(`Unexpected unit "${match[2]}"`);
}

export function loadConfig(rawJson: string): AdaptiveLearningConfig {
  let obj: unknown;
  try {
    obj = JSON.parse(rawJson);
  } catch {
    throw new ValidationError("Config file is not valid JSON");
  }

  if (!obj || typeof obj !== "object") {
    throw new ValidationError("Config must be a JSON object");
  }

  const root = obj as Record<string, unknown>;
  const al = root.adaptive_learning;

  if (!al || typeof al !== "object") {
    throw new ValidationError("Config is missing required block: adaptive_learning");
  }

  const c = al as Record<string, unknown>;

  if (typeof c.feedback_window_turns !== "number") {
    throw new ValidationError("adaptive_learning.feedback_window_turns must be a number");
  }
  if (typeof c.confidence_threshold !== "number") {
    throw new ValidationError("adaptive_learning.confidence_threshold must be a number");
  }
  if (typeof c.model_path !== "string") {
    throw new ValidationError("adaptive_learning.model_path must be a string");
  }
  if (typeof c.oracle_subagent !== "string") {
    throw new ValidationError("adaptive_learning.oracle_subagent must be a string");
  }

  const tt = c.training_trigger;
  if (!tt || typeof tt !== "object") {
    throw new ValidationError("adaptive_learning.training_trigger must be an object");
  }
  const t = tt as Record<string, unknown>;
  if (typeof t.min_candidates !== "number") {
    throw new ValidationError("adaptive_learning.training_trigger.min_candidates must be a number");
  }
  if (typeof t.max_interval !== "string") {
    throw new ValidationError("adaptive_learning.training_trigger.max_interval must be a string");
  }

  return {
    feedbackWindowTurns: c.feedback_window_turns,
    confidenceThreshold: c.confidence_threshold,
    trainingTrigger: {
      minCandidates: t.min_candidates,
      maxIntervalMs: parseIntervalMs(t.max_interval),
    },
    modelPath: c.model_path,
    oracleSubagent: c.oracle_subagent,
  };
}
