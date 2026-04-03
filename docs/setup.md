# reinforteach — Dependency Setup

Pseudocode runbook. Execute step by step; abort on first failure.

## Args

| Arg | Description |
|---|---|
| `--agent-id` | Target agent ID in `openclaw.json` to configure |
| `--oracle-id` | Oracle subagent ID in `openclaw.json` |
| `--model-dir` | Directory to download the model into |
| `--install-dir` | Directory to clone and install llama.cpp into |
| `--config` | Path to `openclaw.json` (default: `~/.openclaw/openclaw.json`) |

---

## STEP 1 — Detect CUDA

```
run: nvidia-smi --query-gpu=driver_version --format=csv,noheader
  → parse driver version string (e.g. "560.70")

derive CUDA_VERSION from driver:
  driver >= 560 → CUDA 12.6
  driver >= 545 → CUDA 12.3
  driver >= 527 → CUDA 12.0
  else → abort "driver too old, CUDA 12.0 minimum required"

CUDA_SHORT = CUDA_VERSION with dot removed (e.g. "126")

validate:
  locate nvcc via $env:CUDA_PATH or default install paths
  if not found: print warning "nvcc not found; llama-cpp-python build may fail"

output: CUDA_VERSION, CUDA_SHORT
```

---

## STEP 2 — Install torch

```
TORCH_INDEX = "https://download.pytorch.org/whl/cu{CUDA_SHORT}"

if "import torch; torch.cuda.is_available()" passes → skip (already installed)

run: pip install torch torchvision torchaudio --index-url {TORCH_INDEX}

validate: python -c "import torch; assert torch.cuda.is_available(), 'CUDA not available'"
abort if validation fails
```

---

## STEP 3 — Install ML stack

```
for each of [unsloth, trl, datasets]:
  if importable → skip

run: pip install unsloth trl datasets

validate: python -c "import unsloth, trl, datasets"
abort if validation fails
```

---

## STEP 4 — Install llama-cpp-python (CUDA build)

```
if "from llama_cpp import Llama" passes → skip

set env: CMAKE_ARGS = "-DGGML_CUDA=ON"
set env: FORCE_CMAKE = "1"

run: pip install llama-cpp-python --no-cache-dir --force-reinstall

validate: python -c "from llama_cpp import Llama"
abort if validation fails
```

---

## STEP 5 — Install llama.cpp

```
LLAMA_DIR = {install_dir}/llama.cpp

if LLAMA_DIR exists and LLAMA_DIR/build/bin/llama-server.exe exists → skip binary download
if LLAMA_DIR does not exist:
  run: git clone https://github.com/ggerganov/llama.cpp {LLAMA_DIR}
else:
  run: git -C {LLAMA_DIR} pull (update source for convert-lora-to-gguf.py)

if LLAMA_DIR/build/bin/llama-server.exe not present:
  fetch latest release from https://api.github.com/repos/ggerganov/llama.cpp/releases/latest
  find asset matching: "llama-*-bin-win-cuda-{CUDA_VERSION}-x64.zip"
  download zip → temp dir
  extract contents → {LLAMA_DIR}/build/bin/

set user env var: LLAMACPP_DIR = {LLAMA_DIR} (persistent, survives shell restart)

validate:
  {LLAMA_DIR}/build/bin/llama-server.exe --version
  python {LLAMA_DIR}/convert-lora-to-gguf.py --help
abort if either fails
```

---

## STEP 6 — Download model

```
MODEL_FILE = "Qwen3.5-9B-Q4_K_M.gguf"
MODEL_PATH = {model_dir}/{MODEL_FILE}

if MODEL_PATH exists and size > 5_000_000_000 bytes → skip

if "huggingface_hub" not importable:
  run: pip install huggingface_hub

run: huggingface-cli download unsloth/Qwen3.5-9B-GGUF {MODEL_FILE} \
       --local-dir {model_dir}

validate: MODEL_PATH exists and size > 5_000_000_000 bytes
abort if validation fails
```

---

## STEP 7 — Update openclaw config

```
read {config} as JSON

assert agents list contains entry with id == {agent_id}
  abort "agent '{agent_id}' not found in {config}" if missing

assert agents list contains entry with id == {oracle_id}
  abort "oracle agent '{oracle_id}' not found in {config}" if missing

target_agent = agents[{agent_id}]

if target_agent already has adaptive_learning block → skip (idempotent)

inject into target_agent:
  adaptive_learning:
    feedback_window_turns: 10
    confidence_threshold: 0.6
    training_trigger:
      min_candidates: 10
      max_interval: "7d"
    model_path: {MODEL_PATH}
    oracle_subagent: {oracle_id}

write {config} back (preserve formatting where possible)
```

---

## STEP 8 — Validate all

```
assert: python -c "import torch; assert torch.cuda.is_available()"
assert: python -c "from llama_cpp import Llama"
assert: python -c "import unsloth, trl, datasets"
assert: {LLAMACPP_DIR}/build/bin/llama-server.exe exists
assert: {LLAMACPP_DIR}/convert-lora-to-gguf.py exists
assert: {MODEL_PATH} exists
assert: {config} agents[{agent_id}].adaptive_learning present

print: "reinforteach dependencies ready"
print: "  model:    {MODEL_PATH}"
print: "  llamacpp: {LLAMACPP_DIR}"
print: "  agent:    {agent_id} (oracle: {oracle_id})"
```
