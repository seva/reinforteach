"""DPO training runner.

Reads training_buffer.jsonl, runs Unsloth DPO training, writes LoRA adapter.
Invoked as a subprocess by training_scheduler.ts.

Usage:
  python src/dpo_runner.py \\
    --buffer training_buffer.jsonl \\
    --output-dir outputs/lora_adapter \\
    --model /path/to/base/model \\
    --min-candidates 10
"""

from __future__ import annotations

import argparse
import json
import logging
import pathlib
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass
class RunConfig:
    buffer_path: str
    output_dir: str
    model_path: str
    min_candidates: int
    beta: float = 0.1
    lora_rank: int = 64
    num_train_epochs: int = 3


def train(
    config: RunConfig,
    *,
    model_loader: Any = None,
    trainer_factory: Callable[..., Any] | None = None,
) -> None:
    """Core training logic. model_loader and trainer_factory are injectable for tests."""
    candidates: list[dict] = []
    buf = pathlib.Path(config.buffer_path)
    if buf.exists():
        for line in buf.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                candidates.append(json.loads(line))

    if len(candidates) < config.min_candidates:
        log.warning(
            "Buffer has %d candidates, need %d — skipping training run.",
            len(candidates),
            config.min_candidates,
        )
        return

    if model_loader is None:
        from unsloth import FastLanguageModel  # type: ignore[import]
        model_loader = FastLanguageModel

    model, tokenizer = model_loader.from_pretrained(
        config.model_path,
        load_in_4bit=True,
        max_seq_length=2048,
    )
    model = model_loader.get_peft_model(
        model,
        r=config.lora_rank,
        lora_alpha=config.lora_rank,
        target_modules=["q_proj", "v_proj"],
        use_gradient_checkpointing="unsloth",
    )

    if trainer_factory is None:
        from unsloth import PatchDPOTrainer  # type: ignore[import]
        from trl import DPOTrainer, DPOConfig as TRLDPOConfig  # type: ignore[import]
        from datasets import Dataset  # type: ignore[import]

        def trainer_factory(model, tokenizer, candidates, output_dir, beta, num_train_epochs):
            PatchDPOTrainer()
            dataset = Dataset.from_list(
                [{"prompt": c["prompt"], "chosen": c["chosen"], "rejected": c["rejected"]}
                 for c in candidates]
            )
            return DPOTrainer(
                model=model,
                ref_model=None,
                args=TRLDPOConfig(output_dir=output_dir, num_train_epochs=num_train_epochs),
                beta=beta,
                train_dataset=dataset,
                tokenizer=tokenizer,
            )

    trainer = trainer_factory(
        model, tokenizer, candidates, config.output_dir, config.beta, config.num_train_epochs
    )
    trainer.train()

    pathlib.Path(config.output_dir).mkdir(parents=True, exist_ok=True)
    model.save_lora(config.output_dir)
    log.info("LoRA adapter written to %s", config.output_dir)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Run DPO training on the training buffer.")
    parser.add_argument("--buffer", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--min-candidates", type=int, default=10)
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--lora-rank", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=3)
    args = parser.parse_args()

    train(RunConfig(
        buffer_path=args.buffer,
        output_dir=args.output_dir,
        model_path=args.model,
        min_candidates=args.min_candidates,
        beta=args.beta,
        lora_rank=args.lora_rank,
        num_train_epochs=args.epochs,
    ))


if __name__ == "__main__":
    main()
