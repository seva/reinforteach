import type { AttributedFeedback } from "./attribution.js";
import type { AnalysisResult, SpawnParams } from "./feedback_analyzer.js";
import { ValidationError } from "./errors.js";

export interface DPOCandidate {
  prompt: string;
  chosen: string;
  rejected: string;
  reward: number;
}

export interface CandidateSynthesizerContext {
  spawnOracle: (params: SpawnParams) => Promise<string>;
  spawnedBy: string;
}

export async function synthesizeCandidate(
  attributed: AttributedFeedback,
  analysis: AnalysisResult,
  context: CandidateSynthesizerContext,
): Promise<DPOCandidate> {
  const { spawnOracle, spawnedBy } = context;

  const lastAssistantTurn = findLastAssistantTurn(attributed);
  const prompt = buildPrompt(attributed, lastAssistantTurn);

  const isNegative = analysis.sentiment < 0;

  const oracleInstruction = isNegative
    ? `Given this conversation, provide a correct and complete response to the user's message. The agent's previous response was flawed: "${lastAssistantTurn}". Hypothesis: ${analysis.hypothesis}`
    : `Given this conversation and the agent's good response "${lastAssistantTurn}", produce a clearly inferior or incorrect alternative response to the same user message.`;

  const oracleCompletion = await spawnOracle({
    message: `${prompt}\n\n${oracleInstruction}`,
    extraSystemPrompt: isNegative
      ? "You are a high-quality oracle. Produce the best possible response."
      : "You are generating a deliberately degraded response for training contrast. Make it clearly worse.",
    idempotencyKey: `oracle-${attributed.sessionKey}-${attributed.feedbackEvent.timestamp}`,
  });

  const agentOutput = lastAssistantTurn;
  const chosen = isNegative ? oracleCompletion : agentOutput;
  const rejected = isNegative ? agentOutput : oracleCompletion;
  const reward = analysis.sentiment * analysis.magnitude;

  return { prompt, chosen, rejected, reward };
}

function findLastAssistantTurn(attributed: AttributedFeedback): string {
  const turns = [...attributed.contextWindow].reverse();
  const assistantTurn = turns.find((t) => t.message.role === "assistant");
  if (!assistantTurn) {
    throw new ValidationError(
      "Cannot synthesize candidate: no assistant turn found in context window",
    );
  }
  return typeof assistantTurn.message.content === "string"
    ? assistantTurn.message.content
    : JSON.stringify(assistantTurn.message.content);
}

function buildPrompt(attributed: AttributedFeedback, lastAssistantTurn: string): string {
  const turns = attributed.contextWindow
    .filter((t) => {
      if (t.message.role !== "assistant") return true;
      const content = typeof t.message.content === "string"
        ? t.message.content
        : JSON.stringify(t.message.content);
      return content !== lastAssistantTurn;
    })
    .map((t) => `${t.message.role}: ${t.message.content}`)
    .join("\n");
  return turns;
}
