import json
import pathlib
from unittest.mock import MagicMock
import pytest

from dpo_runner import RunConfig, train


def make_candidates(n: int) -> list[dict]:
    return [
        {"prompt": f"prompt_{i}", "chosen": f"chosen_{i}", "rejected": f"rejected_{i}", "reward": 0.8}
        for i in range(n)
    ]


def write_buffer(path: pathlib.Path, candidates: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(c) for c in candidates), encoding="utf-8")


def make_mock_loader(output_dir: str):
    """Mock model_loader whose save_lora side-effect creates adapter_model.safetensors."""
    mock_model = MagicMock()

    def save_lora(path: str) -> None:
        pathlib.Path(path).mkdir(parents=True, exist_ok=True)
        (pathlib.Path(path) / "adapter_model.safetensors").write_bytes(b"stub")

    mock_model.save_lora.side_effect = save_lora

    mock_loader = MagicMock()
    mock_loader.from_pretrained.return_value = (mock_model, MagicMock())
    mock_loader.get_peft_model.return_value = mock_model
    return mock_loader, mock_model


def make_mock_trainer_factory():
    mock_trainer = MagicMock()

    def trainer_factory(model, tokenizer, candidates, output_dir, beta, num_train_epochs):
        mock_trainer.assigned_model = model
        return mock_trainer

    return trainer_factory, mock_trainer


class TestDpoRunner:
    def test_training_produces_safetensors(self, tmp_path):
        buffer = tmp_path / "training_buffer.jsonl"
        write_buffer(buffer, make_candidates(10))
        output_dir = tmp_path / "output"

        mock_loader, _ = make_mock_loader(str(output_dir))
        trainer_factory, _ = make_mock_trainer_factory()

        train(
            RunConfig(
                buffer_path=str(buffer),
                output_dir=str(output_dir),
                model_path="dummy-model",
                min_candidates=10,
            ),
            model_loader=mock_loader,
            trainer_factory=trainer_factory,
        )

        assert (output_dir / "adapter_model.safetensors").exists()

    def test_fails_cleanly_below_min_candidates(self, tmp_path, caplog):
        buffer = tmp_path / "training_buffer.jsonl"
        write_buffer(buffer, make_candidates(5))
        output_dir = tmp_path / "output"

        mock_loader, _ = make_mock_loader(str(output_dir))
        trainer_factory, mock_trainer = make_mock_trainer_factory()

        import logging
        with caplog.at_level(logging.WARNING, logger="dpo_runner"):
            train(
                RunConfig(
                    buffer_path=str(buffer),
                    output_dir=str(output_dir),
                    model_path="dummy-model",
                    min_candidates=10,
                ),
                model_loader=mock_loader,
                trainer_factory=trainer_factory,
            )

        mock_loader.from_pretrained.assert_not_called()
        mock_trainer.train.assert_not_called()
        assert not (output_dir / "adapter_model.safetensors").exists()
        assert any("5" in r.message and "10" in r.message for r in caplog.records)
