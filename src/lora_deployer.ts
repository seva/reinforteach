export interface LoraDeployerLog {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export interface LoraDeployerContext {
  llamaCppBaseUrl: string;
  fetch: typeof globalThis.fetch;
  log: LoraDeployerLog;
}

export interface DeployParams {
  adapterId: number;
  scale: number;
}

export async function deployAdapter(params: DeployParams, context: LoraDeployerContext): Promise<void> {
  const { llamaCppBaseUrl, fetch, log } = context;
  const url = `${llamaCppBaseUrl}/lora-adapters`;
  const body = JSON.stringify([{ id: params.adapterId, scale: params.scale }]);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(
        "LoRA adapter swap failed: HTTP %d — %s",
        response.status,
        text,
      );
      return;
    }

    log.info(
      "LoRA adapter %d deployed at scale %f via %s",
      params.adapterId,
      params.scale,
      url,
    );
  } catch (err) {
    log.error("LoRA adapter swap failed (network error): %s", String(err));
  }
}
