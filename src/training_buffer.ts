import type { DPOCandidate } from "./candidate_synthesizer.js";

export interface BufferStore {
  append: (path: string, line: string) => Promise<void>;
  lineCount: (path: string) => Promise<number>;
  readLines: (path: string) => Promise<string[]>;
}

export interface TrainingBufferContext {
  store: BufferStore;
  trainingFile: string;
  heldOutFile: string;
  confidenceThreshold: number;
  heldOutSize: number;
}

export type BufferWriteResult =
  | { status: "appended"; destination: "training" | "held_out" }
  | { status: "rejected"; reason: "below_confidence_threshold" };

export async function appendToBuffer(
  candidate: DPOCandidate,
  context: TrainingBufferContext,
): Promise<BufferWriteResult> {
  const { store, trainingFile, heldOutFile, confidenceThreshold, heldOutSize } = context;

  if (Math.abs(candidate.reward) < confidenceThreshold) {
    return { status: "rejected", reason: "below_confidence_threshold" };
  }

  const heldOutCount = await store.lineCount(heldOutFile);
  const line = JSON.stringify(candidate);

  if (heldOutCount < heldOutSize) {
    await store.append(heldOutFile, line);
    return { status: "appended", destination: "held_out" };
  }

  await store.append(trainingFile, line);
  return { status: "appended", destination: "training" };
}

export async function readTrainingSet(context: TrainingBufferContext): Promise<DPOCandidate[]> {
  const lines = await context.store.readLines(context.trainingFile);
  return lines.map((line) => JSON.parse(line) as DPOCandidate);
}
