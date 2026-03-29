import pathlib
from dataclasses import dataclass
import pytest

from gguf_converter import convert, ConversionError

GGUF_MAGIC = b"GGUF"
GGUF_STUB = GGUF_MAGIC + b"\x03\x00\x00\x00" + b"\x00" * 8


@dataclass
class MockResult:
    returncode: int
    stderr: str = ""
    stdout: str = ""


class TestGgufConversion:
    def test_converts_lora_to_gguf(self, tmp_path):
        adapter_dir = str(tmp_path / "adapter")
        output_path = str(tmp_path / "adapter.gguf")

        def mock_run(cmd, **kwargs):
            assert adapter_dir in cmd
            assert "--outfile" in cmd
            assert output_path in cmd
            pathlib.Path(output_path).write_bytes(GGUF_STUB)
            return MockResult(returncode=0)

        result = convert(adapter_dir, output_path, convert_script="dummy.py", run_subprocess=mock_run)

        assert result == output_path
        assert pathlib.Path(result).exists()

    def test_output_is_valid_gguf_header(self, tmp_path):
        adapter_dir = str(tmp_path / "adapter")
        output_path = str(tmp_path / "adapter.gguf")

        def mock_run(cmd, **kwargs):
            pathlib.Path(output_path).write_bytes(GGUF_STUB)
            return MockResult(returncode=0)

        result = convert(adapter_dir, output_path, convert_script="dummy.py", run_subprocess=mock_run)

        assert pathlib.Path(result).read_bytes()[:4] == GGUF_MAGIC

    def test_raises_on_invalid_gguf_header(self, tmp_path):
        output_path = str(tmp_path / "adapter.gguf")

        def mock_run(cmd, **kwargs):
            pathlib.Path(output_path).write_bytes(b"NOT_A_GGUF_FILE")
            return MockResult(returncode=0)

        with pytest.raises(ConversionError, match="not a valid GGUF"):
            convert(str(tmp_path), output_path, convert_script="dummy.py", run_subprocess=mock_run)

    def test_raises_on_nonzero_exit(self, tmp_path):
        def mock_run(cmd, **kwargs):
            return MockResult(returncode=1, stderr="unsupported format")

        with pytest.raises(ConversionError, match="exited 1"):
            convert(str(tmp_path), str(tmp_path / "out.gguf"), convert_script="dummy.py", run_subprocess=mock_run)

    def test_raises_when_llamacpp_dir_not_set(self, tmp_path, monkeypatch):
        monkeypatch.delenv("LLAMACPP_DIR", raising=False)
        with pytest.raises(ConversionError, match="LLAMACPP_DIR"):
            convert(str(tmp_path), str(tmp_path / "out.gguf"))

    def test_builds_convert_script_from_llamacpp_dir(self, tmp_path, monkeypatch):
        monkeypatch.setenv("LLAMACPP_DIR", "/llama")
        output_path = str(tmp_path / "out.gguf")
        captured = {}

        def mock_run(cmd, **kwargs):
            captured["script"] = cmd[1]
            pathlib.Path(output_path).write_bytes(GGUF_STUB)
            return MockResult(returncode=0)

        convert(str(tmp_path), output_path, run_subprocess=mock_run)
        assert captured["script"] == str(pathlib.Path("/llama") / "convert-lora-to-gguf.py")

    def test_raises_when_output_file_unreadable(self, tmp_path):
        output_path = str(tmp_path / "out.gguf")

        def mock_run(cmd, **kwargs):
            # subprocess succeeds but writes nothing — file won't exist
            return MockResult(returncode=0)

        with pytest.raises(ConversionError, match="Could not read output file"):
            convert(str(tmp_path), output_path, convert_script="dummy.py", run_subprocess=mock_run)
