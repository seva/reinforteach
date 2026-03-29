"""Deployment gate.

Runs delta eval on the held-out buffer: compares new adapter vs baseline.
Blocks deployment if delta < 0 (regression). Returns GateResult with delta and decision.
"""

from __future__ import annotations

import json
import logging
import pathlib
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass
class GateConfig:
    held_out_path: str
    adapter_path: str
    model_path: str = ""


@dataclass
class GateResult:
    delta: float
    deploy: bool
    baseline_score: float
    candidate_score: float


def make_llama_scorer(
    model_path: str,
    llama_factory: Any = None,
) -> Callable[[str | None, list[dict]], float]:
    """Create a scorer using llama-cpp-python log-prob scoring.

    scorer(adapter_path, held_out) -> float
      adapter_path=None means baseline (no adapter).
      Returns mean(log_prob(chosen) - log_prob(rejected)) over held-out candidates.
    """
    if llama_factory is None:
        from llama_cpp import Llama  # type: ignore[import]  # lazy — requires llama-cpp-python
        llama_factory = Llama

    def scorer(adapter_path: str | None, held_out: list[dict]) -> float:
        kwargs: dict[str, Any] = {
            "model_path": model_path,
            "logits_all": True,
            "n_gpu_layers": -1,
            "n_ctx": 4096,
            "verbose": False,
        }
        if adapter_path is not None:
            kwargs["lora_path"] = adapter_path

        llm = llama_factory(**kwargs)

        margins = []
        for candidate in held_out:
            prompt: str = candidate["prompt"]
            chosen: str = candidate["chosen"]
            rejected: str = candidate["rejected"]

            prompt_len = len(llm.tokenize(prompt.encode("utf-8")))
            chosen_score = _mean_response_logprob(llm, prompt, chosen, prompt_len)
            rejected_score = _mean_response_logprob(llm, prompt, rejected, prompt_len)
            margins.append(chosen_score - rejected_score)

        return sum(margins) / len(margins) if margins else 0.0

    return scorer


def evaluate_and_gate(
    config: GateConfig,
    *,
    scorer: Callable[[str | None, list[dict]], float] | None = None,
) -> GateResult:
    """Eval new adapter against baseline on the held-out set; gate deployment.

    scorer(adapter_path, held_out) -> float
      adapter_path=None means baseline (no adapter).
    Returns GateResult with delta and deploy decision.
    """
    candidates = _load_held_out(config.held_out_path)

    if scorer is None:
        # Untestable path — requires live llama-cpp-python + model. Acceptable gap.
        scorer = make_llama_scorer(config.model_path)

    baseline_score = scorer(None, candidates)
    candidate_score = scorer(config.adapter_path, candidates)
    delta = candidate_score - baseline_score

    deploy = delta >= 0

    if deploy:
        log.info(
            "Deployment gate passed: delta=%.4f (baseline=%.4f, candidate=%.4f). Deploying %s.",
            delta, baseline_score, candidate_score, config.adapter_path,
        )
    else:
        log.warning(
            "Deployment gate blocked: delta=%.4f (baseline=%.4f, candidate=%.4f). Not deploying %s.",
            delta, baseline_score, candidate_score, config.adapter_path,
        )

    return GateResult(
        delta=delta,
        deploy=deploy,
        baseline_score=baseline_score,
        candidate_score=candidate_score,
    )


def _load_held_out(path: str) -> list[dict]:
    buf = pathlib.Path(path)
    candidates = []
    if buf.exists():
        for line in buf.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                candidates.append(json.loads(line))
    return candidates


def _mean_response_logprob(
    llm: Any,
    prompt: str,
    response: str,
    prompt_len: int,
) -> float:
    result = llm.create_completion(
        prompt + response,
        max_tokens=0,
        echo=True,
        logprobs=1,
        temperature=0,
    )
    all_logprobs: list[float] = result["choices"][0]["logprobs"]["token_logprobs"]
    response_logprobs = all_logprobs[prompt_len:]
    if not response_logprobs:
        return 0.0
    return sum(response_logprobs) / len(response_logprobs)
