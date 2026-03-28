export interface TrainingSchedulerContext {
  getTrainingCount: () => Promise<number>;
  runTraining: () => Promise<void>;
  getNow: () => number;
  minCandidates: number;
  maxIntervalMs: number;
}

export function createScheduler(context: TrainingSchedulerContext): { tick: () => Promise<void> } {
  const { getTrainingCount, runTraining, getNow, minCandidates, maxIntervalMs } = context;
  let isTraining = false;
  let lastTrainedAt = getNow();

  return {
    async tick(): Promise<void> {
      if (isTraining) return;
      isTraining = true;
      try {
        const count = await getTrainingCount();
        const now = getNow();
        const byCount = count >= minCandidates;
        const byInterval = now - lastTrainedAt >= maxIntervalMs;
        if (!byCount && !byInterval) return;
        await runTraining();
        lastTrainedAt = getNow();
      } finally {
        isTraining = false;
      }
    },
  };
}

// Untestable path — cron registration. Acceptable gap (see ARCHITECTURE.md Coverage Notes).
export function startCron(context: TrainingSchedulerContext, pollIntervalMs: number): () => void {
  const scheduler = createScheduler(context);
  const id = setInterval(() => { void scheduler.tick(); }, pollIntervalMs);
  return () => clearInterval(id);
}
