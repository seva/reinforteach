import { describe, it, expect, vi } from "vitest";
import { deployAdapter, type LoraDeployerContext } from "../../src/lora_deployer.js";

describe("LoraDeployer", () => {
  function makeContext(overrides: Partial<LoraDeployerContext> = {}): LoraDeployerContext {
    return {
      llamaCppBaseUrl: "http://localhost:8080",
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    };
  }

  it("calls POST /lora-adapters with correct adapter id and scale", async () => {
    const ctx = makeContext();
    await deployAdapter({ adapterId: 0, scale: 1.0 }, ctx);

    expect(ctx.fetch).toHaveBeenCalledOnce();
    const [url, init] = (ctx.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8080/lora-adapters");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual([{ id: 0, scale: 1.0 }]);
  });

  it("uses the provided scale when deploying", async () => {
    const ctx = makeContext();
    await deployAdapter({ adapterId: 2, scale: 0.5 }, ctx);

    const [, init] = (ctx.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual([{ id: 2, scale: 0.5 }]);
  });

  it("logs success after successful swap", async () => {
    const ctx = makeContext();
    await deployAdapter({ adapterId: 0, scale: 1.0 }, ctx);
    expect(ctx.log.info).toHaveBeenCalled();
  });

  it("logs and does not crash when server returns error status", async () => {
    const ctx = makeContext({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      }),
    });

    await expect(deployAdapter({ adapterId: 0, scale: 1.0 }, ctx)).resolves.not.toThrow();
    expect(ctx.log.error).toHaveBeenCalled();
  });

  it("logs and does not crash when fetch throws (network error)", async () => {
    const ctx = makeContext({
      fetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    await expect(deployAdapter({ adapterId: 0, scale: 1.0 }, ctx)).resolves.not.toThrow();
    expect(ctx.log.error).toHaveBeenCalled();
  });
});
