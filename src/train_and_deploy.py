"""Training + deployment orchestration subprocess.

Chains: dpo_runner → gguf_converter → deployment_gate.
Called by training_scheduler.ts as a single subprocess.

Exit codes:
  0 — trained, converted, gate passed → deploy
  1 — training skipped (insufficient candidates) or gate blocked → no deploy
  2 — unhandled error (conversion failure, filesystem error, etc.)

Stdout: JSON  {adapter_path, delta, deploy}  on success/block;
              {error: "..."}                  on exit 2.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import pathlib
import sys
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclasses.dataclass
class PipelineConfig:
    buffer_path: str
    held_out_path: str
    output_dir: str
    model_path: str
    min_candidates: int
    convert_script: str | None = None
    beta: float = 0.1
    lora_rank: int = 64
    num_train_epochs: int = 3


@dataclasses.dataclass
class PipelineResult:
    adapter_path: str
    delta: float
    deploy: bool


def run_pipeline(
    config: PipelineConfig,
    *,
    trainer: Callable[[PipelineConfig], None] | None = None,
    converter: Callable[[str, str], str] | None = None,
    gater: Callable[[str, str], Any] | None = None,
) -> PipelineResult | None:
    """Run the full training + deployment pipeline.

    Returns PipelineResult on success or gate-block.
    Returns None if training was skipped (insufficient candidates — no safetensors produced).
    Raises on unhandled errors (propagates to main() which exits 2).
    """
    if trainer is None:
        from dpo_runner import train as _train, RunConfig  # type: ignore[import]

        def trainer(cfg: PipelineConfig) -> None:
            _train(RunConfig(
                buffer_path=cfg.buffer_path,
                output_dir=cfg.output_dir,
                model_path=cfg.model_path,
                min_candidates=cfg.min_candidates,
                beta=cfg.beta,
                lora_rank=cfg.lora_rank,
                num_train_epochs=cfg.num_train_epochs,
            ))

    if converter is None:
        from gguf_converter import convert as _convert  # type: ignore[import]

        def converter(adapter_dir: str, gguf_path: str) -> str:
            return _convert(adapter_dir, gguf_path, convert_script=config.convert_script)

    if gater is None:
        from deployment_gate import evaluate_and_gate as _gate, GateConfig  # type: ignore[import]

        def gater(adapter_path: str, held_out_path: str) -> Any:
            return _gate(GateConfig(held_out_path=held_out_path, adapter_path=adapter_path))

    # Step 1: Train
    trainer(config)

    # Step 2: Check training produced output
    safetensors = pathlib.Path(config.output_dir) / "adapter_model.safetensors"
    if not safetensors.exists():
        log.info("Training produced no adapter (insufficient candidates) — pipeline skipped.")
        return None

    # Step 3: Convert
    gguf_path = str(pathlib.Path(config.output_dir) / "adapter.gguf")
    converter(config.output_dir, gguf_path)

    # Step 4: Gate
    gate_result = gater(gguf_path, config.held_out_path)

    return PipelineResult(
        adapter_path=gguf_path,
        delta=gate_result.delta,
        deploy=gate_result.deploy,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Train and conditionally deploy a LoRA adapter.")
    parser.add_argument("--buffer", required=True)
    parser.add_argument("--held-out", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--min-candidates", type=int, default=10)
    parser.add_argument("--convert-script")
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--lora-rank", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=3)
    args = parser.parse_args()

    config = PipelineConfig(
        buffer_path=args.buffer,
        held_out_path=args.held_out,
        output_dir=args.output_dir,
        model_path=args.model,
        min_candidates=args.min_candidates,
        convert_script=args.convert_script,
        beta=args.beta,
        lora_rank=args.lora_rank,
        num_train_epochs=args.epochs,
    )

    try:
        result = run_pipeline(config)
    except Exception as e:
        log.error("Pipeline error: %s", e)
        print(json.dumps({"error": str(e)}))
        sys.exit(2)

    if result is None:
        print(json.dumps({"deploy": False, "reason": "training_skipped"}))
        sys.exit(1)

    print(json.dumps(dataclasses.asdict(result)))
    sys.exit(0 if result.deploy else 1)


if __name__ == "__main__":
    main()
