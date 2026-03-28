# Discovery: llama.cpp Server API

## Model Management (runtime swap)

llama.cpp supports runtime model swapping when launched in **router mode** (no `--model` flag at startup).

### Startup (router mode)

```
llama-server \
  --models-dir /path/to/gguf/dir \
  --models-max 4 \
  --no-models-autoload
```

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Readiness check. `{"status":"ok"}` when ready; 503 while loading |
| GET | `/models` | List discovered models with status: `loaded`, `loading`, `unloaded` |
| POST | `/models/load` | Load a model: `{"model": "path/to/model.gguf"}` |
| POST | `/models/unload` | Unload a model: `{"model": "path/to/model.gguf"}` |
| GET | `/v1/models` | OpenAI-compatible model list |
| GET | `/lora-adapters` | List loaded LoRA adapters |
| POST | `/lora-adapters` | Hot-swap LoRA adapters at runtime (no model reload) |

### LoRA adapter hot-swap (preferred deployment path)

```json
POST /lora-adapters
[{"id": 0, "scale": 1.0}]
```

Set `scale` to `0` to disable an adapter without unloading it. **This is lighter than a full model swap** — no model reload, instant effect.

### POST /completion (key fields)

```
prompt              string|array   REQUIRED
temperature         number         default: 0.8
n_predict           number         default: -1 (unlimited)
stream              boolean        default: false
stop                array          default: []
seed                number         default: -1
cache_prompt        boolean        default: true
lora                array          per-request LoRA override: [{"id": N, "scale": F}]
```

Response includes: `content`, `stop_type` (`none`|`eos`|`limit`|`word`), `timings`, `tokens_evaluated`, `tokens_cached`.

## Notes

- `POST /models/load` returns `{"error": {"code": 501}}` if the server was not started in router mode.
- LoRA adapters can also be overridden per-request via the `lora` field in `/completion` — useful for A/B testing before committing to a hot-swap.
- `save_pretrained_gguf()` from Unsloth produces `.gguf` files directly loadable here; `save_lora()` produces LoRA adapters usable via `/lora-adapters`.
