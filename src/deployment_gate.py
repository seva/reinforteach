"""Deployment gate.

Runs delta eval on the held-out buffer: compares new adapter vs baseline.
Blocks deployment if delta < 0 (regression). Returns GateResult with delta and decision.
"""

from __future__ import annotations

import json
import logging
import pathlib
from dataclasses import dataclass
from typing import Callable

log = logging.getLogger(__name__)


@dataclass
class GateConfig:
    held_out_path: str
    adapter_path: str


@dataclass
class GateResult:
    delta: float
    deploy: bool
    baseline_score: float
    candidate_score: float


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
        scorer = _default_scorer

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


def _default_scorer(adapter_path: str | None, held_out: list[dict]) -> float:
    """Real scorer: run llama.cpp inference on held-out prompts and measure chosen vs rejected preference.
    Deferred to integration phase — requires a live llama.cpp server."""
    raise NotImplementedError(
        "Real scorer not implemented. Inject a scorer for production use."
    )
