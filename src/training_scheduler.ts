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

// --- Real runTraining wiring ---

export interface TrainingRunConfig {
  bufferPath: string;
  heldOutPath: string;
  outputDir: string;
  modelPath: string;
  minCandidates: number;
  convertScript?: string;
  scriptPath?: string;
  deploy?: (adapterPath: string) => Promise<void>;
}

export interface SubprocessResult {
  exitCode: number;
  stdout: string;
}

export async function spawnTrainAndDeploy(
  config: TrainingRunConfig,
  spawnProcess?: (args: string[]) => Promise<SubprocessResult>,
): Promise<void> {
  if (spawnProcess === undefined) {
    // Untestable path — real subprocess. Acceptable gap (see ARCHITECTURE.md Coverage Notes).
    const { spawn } = await import("node:child_process");
    spawnProcess = (args) =>
      new Promise((resolve, reject) => {
        let stdout = "";
        const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "inherit"] });
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.on("close", (code) => resolve({ exitCode: code ?? 2, stdout }));
        child.on("error", reject);
      });
  }

  const script = config.scriptPath ?? "src/train_and_deploy.py";
  const args = [
    "python", script,
    "--buffer", config.bufferPath,
    "--held-out", config.heldOutPath,
    "--output-dir", config.outputDir,
    "--model", config.modelPath,
    "--min-candidates", String(config.minCandidates),
  ];
  if (config.convertScript) args.push("--convert-script", config.convertScript);

  const { exitCode, stdout } = await spawnProcess(args);

  if (exitCode === 0) {
    if (config.deploy) {
      try {
        const result = JSON.parse(stdout) as { adapter_path?: string };
        if (result.adapter_path) await config.deploy(result.adapter_path);
      } catch { /* stdout not JSON or no adapter_path */ }
    }
    return;
  }
  if (exitCode === 1) return; // gate blocked — not an error

  // exit code 2: pipeline error
  let message = `train_and_deploy.py exited ${exitCode}`;
  try {
    const parsed = JSON.parse(stdout) as { error?: string };
    if (parsed.error) message = parsed.error;
  } catch { /* stdout not JSON */ }
  throw new Error(message);
}
