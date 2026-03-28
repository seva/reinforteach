import json
import pathlib
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock
import pytest

from deployment_gate import GateConfig, evaluate_and_gate, GateResult


def make_candidates(n: int) -> list[dict]:
    return [
        {"prompt": f"p{i}", "chosen": f"c{i}", "rejected": f"r{i}", "reward": 0.8}
        for i in range(n)
    ]


def write_held_out(path: pathlib.Path, candidates: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(c) for c in candidates), encoding="utf-8")


def make_scorer(baseline_score: float, candidate_score: float):
    """Returns a scorer that returns different scores for baseline vs candidate adapter."""
    call_count = 0

    def scorer(adapter_path: str | None, held_out: list[dict]) -> float:
        nonlocal call_count
        call_count += 1
        return baseline_score if adapter_path is None else candidate_score

    return scorer


class TestDeploymentGate:
    def test_delta_eval_returns_float(self, tmp_path):
        held_out = tmp_path / "held_out.jsonl"
        write_held_out(held_out, make_candidates(5))

        scorer = make_scorer(baseline_score=0.5, candidate_score=0.7)
        result = evaluate_and_gate(
            GateConfig(
                held_out_path=str(held_out),
                adapter_path=str(tmp_path / "adapter.gguf"),
            ),
            scorer=scorer,
        )

        assert isinstance(result.delta, float)

    def test_gate_passes_when_delta_nonnegative(self, tmp_path):
        held_out = tmp_path / "held_out.jsonl"
        write_held_out(held_out, make_candidates(5))

        scorer = make_scorer(baseline_score=0.5, candidate_score=0.7)
        result = evaluate_and_gate(
            GateConfig(
                held_out_path=str(held_out),
                adapter_path=str(tmp_path / "adapter.gguf"),
            ),
            scorer=scorer,
        )

        assert result.deploy is True
        assert result.delta >= 0

    def test_gate_passes_on_exact_zero_delta(self, tmp_path):
        held_out = tmp_path / "held_out.jsonl"
        write_held_out(held_out, make_candidates(5))

        scorer = make_scorer(baseline_score=0.5, candidate_score=0.5)
        result = evaluate_and_gate(
            GateConfig(
                held_out_path=str(held_out),
                adapter_path=str(tmp_path / "adapter.gguf"),
            ),
            scorer=scorer,
        )

        assert result.deploy is True
        assert result.delta == pytest.approx(0.0)

    def test_gate_blocks_when_delta_negative(self, tmp_path, caplog):
        held_out = tmp_path / "held_out.jsonl"
        write_held_out(held_out, make_candidates(5))

        scorer = make_scorer(baseline_score=0.7, candidate_score=0.5)
        import logging
        with caplog.at_level(logging.WARNING, logger="deployment_gate"):
            result = evaluate_and_gate(
                GateConfig(
                    held_out_path=str(held_out),
                    adapter_path=str(tmp_path / "adapter.gguf"),
                ),
                scorer=scorer,
            )

        assert result.deploy is False
        assert result.delta < 0
        assert any("deploy" in r.message.lower() or "block" in r.message.lower()
                   for r in caplog.records)
