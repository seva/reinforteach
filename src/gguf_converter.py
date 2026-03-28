"""GGUF conversion step.

Shells out to llama.cpp's convert-lora-to-gguf.py and validates the output header.
Sits between dpo_runner.py (produces adapter_model.safetensors) and
deployment_gate.py (evaluates adapter.gguf).
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
from typing import Any, Callable

GGUF_MAGIC = b"GGUF"


class ConversionError(Exception):
    pass


def convert(
    adapter_dir: str,
    output_path: str,
    convert_script: str | None = None,
    *,
    run_subprocess: Callable[..., Any] | None = None,
) -> str:
    """Convert adapter_dir to GGUF format.

    Shells out to convert-lora-to-gguf.py, then validates the GGUF magic header.
    Returns output_path on success. Raises ConversionError on failure.
    """
    if convert_script is None:
        llamacpp_dir = os.environ.get("LLAMACPP_DIR", "")
        if not llamacpp_dir:
            raise ConversionError(
                "convert_script not provided and LLAMACPP_DIR env var not set"
            )
        convert_script = str(pathlib.Path(llamacpp_dir) / "convert-lora-to-gguf.py")

    if run_subprocess is None:
        run_subprocess = subprocess.run

    result = run_subprocess(
        [sys.executable, convert_script, adapter_dir, "--outfile", output_path],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise ConversionError(
            f"convert-lora-to-gguf.py exited {result.returncode}: {result.stderr.strip()}"
        )

    _validate_gguf_header(output_path)
    return output_path


def _validate_gguf_header(path: str) -> None:
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
    except OSError as e:
        raise ConversionError(f"Could not read output file: {e}") from e

    if magic != GGUF_MAGIC:
        raise ConversionError(
            f"Output is not a valid GGUF file "
            f"(expected {GGUF_MAGIC!r}, got {magic!r}): {path}"
        )
