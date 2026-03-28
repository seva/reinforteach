import dataclasses
import json
import pathlib
import pytest

from train_and_deploy import PipelineConfig, PipelineResult, run_pipeline


def make_candidates(n: int) -> list[dict]:
    return [
        {"prompt": f"p{i}", "chosen": f"c{i}", "rejected": f"r{i}", "reward": 0.8}
        for i in range(n)
    ]


def write_jsonl(path: pathlib.Path, records: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")


def make_config(tmp_path: pathlib.Path) -> PipelineConfig:
    buffer = tmp_path / "training.jsonl"
    held_out = tmp_path / "held_out.jsonl"
    write_jsonl(buffer, make_candidates(15))
    write_jsonl(held_out, make_candidates(5))
    return PipelineConfig(
        buffer_path=str(buffer),
        held_out_path=str(held_out),
        output_dir=str(tmp_path / "output"),
        model_path="dummy",
        min_candidates=10,
    )


def make_mock_trainer(creates_output: bool):
    def trainer(config: PipelineConfig) -> None:
        if creates_output:
            pathlib.Path(config.output_dir).mkdir(parents=True, exist_ok=True)
            (pathlib.Path(config.output_dir) / "adapter_model.safetensors").write_bytes(b"stub")
    return trainer


def make_mock_converter():
    def converter(adapter_dir: str, gguf_path: str) -> str:
        pathlib.Path(gguf_path).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(gguf_path).write_bytes(b"GGUF" + b"\x00" * 8)
        return gguf_path
    return converter


@dataclasses.dataclass
class MockGateResult:
    delta: float
    deploy: bool
    baseline_score: float = 0.5
    candidate_score: float = 0.7


def make_mock_gater(delta: float, deploy: bool):
    def gater(adapter_path: str, held_out_path: str) -> MockGateResult:
        return MockGateResult(delta=delta, deploy=deploy)
    return gater


class TestTrainAndDeploy:
    def test_full_chain_produces_gguf_and_deploy_decision(self, tmp_path):
        config = make_config(tmp_path)

        result = run_pipeline(
            config,
            trainer=make_mock_trainer(creates_output=True),
            converter=make_mock_converter(),
            gater=make_mock_gater(delta=0.2, deploy=True),
        )

        assert result is not None
        assert result.deploy is True
        assert result.delta == pytest.approx(0.2)
        assert pathlib.Path(result.adapter_path).name == "adapter.gguf"
        assert pathlib.Path(result.adapter_path).exists()

    def test_blocks_when_gate_delta_negative(self, tmp_path):
        config = make_config(tmp_path)

        result = run_pipeline(
            config,
            trainer=make_mock_trainer(creates_output=True),
            converter=make_mock_converter(),
            gater=make_mock_gater(delta=-0.1, deploy=False),
        )

        assert result is not None
        assert result.deploy is False
        assert result.delta < 0

    def test_returns_none_when_training_skipped(self, tmp_path):
        """dpo_runner silently skips when buffer is too small — no safetensors produced."""
        config = make_config(tmp_path)

        result = run_pipeline(
            config,
            trainer=make_mock_trainer(creates_output=False),
            converter=make_mock_converter(),
            gater=make_mock_gater(delta=0.2, deploy=True),
        )

        assert result is None

    def test_converter_called_with_output_dir_and_gguf_path(self, tmp_path):
        config = make_config(tmp_path)
        converter_calls: list[tuple[str, str]] = []

        def tracking_converter(adapter_dir: str, gguf_path: str) -> str:
            converter_calls.append((adapter_dir, gguf_path))
            return make_mock_converter()(adapter_dir, gguf_path)

        run_pipeline(
            config,
            trainer=make_mock_trainer(creates_output=True),
            converter=tracking_converter,
            gater=make_mock_gater(delta=0.1, deploy=True),
        )

        assert len(converter_calls) == 1
        assert converter_calls[0][0] == config.output_dir
        assert converter_calls[0][1].endswith("adapter.gguf")

    def test_gater_called_with_gguf_path_and_held_out(self, tmp_path):
        config = make_config(tmp_path)
        gater_calls: list[tuple[str, str]] = []

        def tracking_gater(adapter_path: str, held_out_path: str) -> MockGateResult:
            gater_calls.append((adapter_path, held_out_path))
            return MockGateResult(delta=0.1, deploy=True)

        run_pipeline(
            config,
            trainer=make_mock_trainer(creates_output=True),
            converter=make_mock_converter(),
            gater=tracking_gater,
        )

        assert len(gater_calls) == 1
        assert gater_calls[0][0].endswith("adapter.gguf")
        assert gater_calls[0][1] == config.held_out_path
