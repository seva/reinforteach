import { describe, it, expect, vi } from "vitest";
import { spawnTrainAndDeploy, type TrainingRunConfig, type SubprocessResult } from "../../src/training_scheduler.js";

const baseConfig: TrainingRunConfig = {
  bufferPath: "training.jsonl",
  heldOutPath: "held_out.jsonl",
  outputDir: "output",
  modelPath: "model.gguf",
  minCandidates: 10,
};

function makeSpawn(exitCode: number, stdout = ""): (args: string[]) => Promise<SubprocessResult> {
  return vi.fn().mockResolvedValue({ exitCode, stdout });
}

describe("spawnTrainAndDeploy — subprocess args", () => {
  it("calls python with train_and_deploy.py and required flags", async () => {
    const spawn = makeSpawn(0);
    await spawnTrainAndDeploy(baseConfig, spawn);

    const [args] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toBe("python");
    expect(args).toContain("src/train_and_deploy.py");
    expect(args).toContain("--buffer");
    expect(args).toContain("training.jsonl");
    expect(args).toContain("--held-out");
    expect(args).toContain("held_out.jsonl");
    expect(args).toContain("--output-dir");
    expect(args).toContain("output");
    expect(args).toContain("--model");
    expect(args).toContain("model.gguf");
    expect(args).toContain("--min-candidates");
    expect(args).toContain("10");
  });

  it("uses custom scriptPath when provided", async () => {
    const spawn = makeSpawn(0);
    await spawnTrainAndDeploy({ ...baseConfig, scriptPath: "scripts/train.py" }, spawn);

    const [args] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toContain("scripts/train.py");
    expect(args).not.toContain("src/train_and_deploy.py");
  });

  it("includes --convert-script when provided", async () => {
    const spawn = makeSpawn(0);
    await spawnTrainAndDeploy({ ...baseConfig, convertScript: "/llama.cpp/convert-lora-to-gguf.py" }, spawn);

    const [args] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toContain("--convert-script");
    expect(args).toContain("/llama.cpp/convert-lora-to-gguf.py");
  });
});

describe("spawnTrainAndDeploy — exit code handling", () => {
  it("resolves on exit code 0 (deploy)", async () => {
    const spawn = makeSpawn(0, JSON.stringify({ adapter_path: "out/adapter.gguf", delta: 0.1, deploy: true }));
    await expect(spawnTrainAndDeploy(baseConfig, spawn)).resolves.not.toThrow();
  });

  it("resolves on exit code 1 (block or training skipped)", async () => {
    const spawn = makeSpawn(1, JSON.stringify({ deploy: false, reason: "training_skipped" }));
    await expect(spawnTrainAndDeploy(baseConfig, spawn)).resolves.not.toThrow();
  });

  it("rejects on exit code 2 (pipeline error)", async () => {
    const spawn = makeSpawn(2, JSON.stringify({ error: "conversion failed" }));
    await expect(spawnTrainAndDeploy(baseConfig, spawn)).rejects.toThrow("conversion failed");
  });

  it("rejects with generic message on exit code 2 with no stdout", async () => {
    const spawn = makeSpawn(2, "");
    await expect(spawnTrainAndDeploy(baseConfig, spawn)).rejects.toThrow();
  });
});
