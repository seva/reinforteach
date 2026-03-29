import { describe, it, expect } from "vitest";
import { loadConfig, type AdaptiveLearningConfig } from "../../src/config_loader.js";
import { ValidationError } from "../../src/errors.js";

const validConfig: AdaptiveLearningConfig = {
  feedbackWindowTurns: 5,
  confidenceThreshold: 0.7,
  trainingTrigger: { minCandidates: 20, maxIntervalMs: 7 * 24 * 60 * 60 * 1000 },
  modelPath: "/models/agent.gguf",
  oracleSubagent: "oracle",
};

const validRaw = JSON.stringify({
  adaptive_learning: {
    feedback_window_turns: 5,
    confidence_threshold: 0.7,
    training_trigger: { min_candidates: 20, max_interval: "7d" },
    model_path: "/models/agent.gguf",
    oracle_subagent: "oracle",
  },
});

describe("loadConfig — happy path", () => {
  it("parses valid config and returns typed AdaptiveLearningConfig", () => {
    const result = loadConfig(validRaw);
    expect(result).toEqual(validConfig);
  });

  it("converts max_interval string to milliseconds", () => {
    const result = loadConfig(validRaw);
    expect(result.trainingTrigger.maxIntervalMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("parses max_interval in hours (e.g. 24h)", () => {
    const raw = JSON.stringify({
      adaptive_learning: {
        ...JSON.parse(validRaw).adaptive_learning,
        training_trigger: { min_candidates: 10, max_interval: "24h" },
      },
    });
    const result = loadConfig(raw);
    expect(result.trainingTrigger.maxIntervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it("parses max_interval in minutes (e.g. 30m)", () => {
    const raw = JSON.stringify({
      adaptive_learning: {
        ...JSON.parse(validRaw).adaptive_learning,
        training_trigger: { min_candidates: 10, max_interval: "30m" },
      },
    });
    const result = loadConfig(raw);
    expect(result.trainingTrigger.maxIntervalMs).toBe(30 * 60 * 1000);
  });
});

describe("loadConfig — validation errors", () => {
  it("throws ValidationError when adaptive_learning block is missing", () => {
    expect(() => loadConfig(JSON.stringify({}))).toThrow(ValidationError);
  });

  it("throws ValidationError when model_path is missing", () => {
    const raw = JSON.stringify({
      adaptive_learning: { ...JSON.parse(validRaw).adaptive_learning, model_path: undefined },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError when max_interval format is unrecognised", () => {
    const raw = JSON.stringify({
      adaptive_learning: {
        ...JSON.parse(validRaw).adaptive_learning,
        training_trigger: { min_candidates: 10, max_interval: "2w" },
      },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError on invalid JSON", () => {
    expect(() => loadConfig("not json {{")).toThrow(ValidationError);
  });

  it("throws ValidationError when JSON is valid but not an object", () => {
    expect(() => loadConfig("null")).toThrow(ValidationError);
    expect(() => loadConfig("42")).toThrow(ValidationError);
  });

  it("throws ValidationError when feedback_window_turns is missing", () => {
    const raw = JSON.stringify({
      adaptive_learning: { ...JSON.parse(validRaw).adaptive_learning, feedback_window_turns: undefined },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError when confidence_threshold is missing", () => {
    const raw = JSON.stringify({
      adaptive_learning: { ...JSON.parse(validRaw).adaptive_learning, confidence_threshold: undefined },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError when oracle_subagent is missing", () => {
    const raw = JSON.stringify({
      adaptive_learning: { ...JSON.parse(validRaw).adaptive_learning, oracle_subagent: undefined },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError when training_trigger is not an object", () => {
    const raw = JSON.stringify({
      adaptive_learning: { ...JSON.parse(validRaw).adaptive_learning, training_trigger: 42 },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError when training_trigger.min_candidates is missing", () => {
    const raw = JSON.stringify({
      adaptive_learning: {
        ...JSON.parse(validRaw).adaptive_learning,
        training_trigger: { max_interval: "7d" },
      },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });

  it("throws ValidationError when training_trigger.max_interval is not a string", () => {
    const raw = JSON.stringify({
      adaptive_learning: {
        ...JSON.parse(validRaw).adaptive_learning,
        training_trigger: { min_candidates: 10, max_interval: 604800000 },
      },
    });
    expect(() => loadConfig(raw)).toThrow(ValidationError);
  });
});
