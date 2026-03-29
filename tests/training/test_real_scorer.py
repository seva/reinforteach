"""Tests for make_llama_scorer — the real deployment gate scorer using llama-cpp-python."""

import pytest

from deployment_gate import make_llama_scorer


def make_mock_llama_factory(responses: dict[str, list[float]]):
    """
    responses: {full_text: token_logprobs_list}
    tokenize: one token per whitespace-separated word (matches test data design).
    """
    class MockLlama:
        def __init__(self, **kwargs):
            self.init_kwargs = kwargs

        def tokenize(self, text: bytes) -> list[int]:
            return list(range(len(text.decode("utf-8").split())))

        def create_completion(self, prompt: str, **kwargs) -> dict:
            return {"choices": [{"logprobs": {"token_logprobs": responses[prompt]}}]}

    return MockLlama


class TestMakeLlamaScorer:
    def test_baseline_scorer_loads_without_lora_path(self):
        # scorer(None, ...) → Llama constructor must NOT receive lora_path
        candidates = [{"prompt": "A", "chosen": " C", "rejected": " R", "reward": 0.5}]
        responses = {"A C": [-0.1, -0.5], "A R": [-0.1, -0.3]}

        instances = []

        class TrackingLlama:
            def __init__(self, **kwargs):
                instances.append(kwargs)

            def tokenize(self, text):
                return list(range(len(text.decode().split())))

            def create_completion(self, prompt, **kwargs):
                return {"choices": [{"logprobs": {"token_logprobs": responses[prompt]}}]}

        scorer = make_llama_scorer("/base.gguf", llama_factory=TrackingLlama)
        scorer(None, candidates)

        assert len(instances) == 1
        assert "lora_path" not in instances[0]

    def test_candidate_scorer_passes_lora_path(self):
        # scorer("/adapter.gguf", ...) → Llama constructor receives lora_path="/adapter.gguf"
        candidates = [{"prompt": "A", "chosen": " C", "rejected": " R", "reward": 0.5}]
        responses = {"A C": [-0.1, -0.5], "A R": [-0.1, -0.3]}

        instances = []

        class TrackingLlama:
            def __init__(self, **kwargs):
                instances.append(kwargs)

            def tokenize(self, text):
                return list(range(len(text.decode().split())))

            def create_completion(self, prompt, **kwargs):
                return {"choices": [{"logprobs": {"token_logprobs": responses[prompt]}}]}

        scorer = make_llama_scorer("/base.gguf", llama_factory=TrackingLlama)
        scorer("/adapter.gguf", candidates)

        assert instances[0].get("lora_path") == "/adapter.gguf"

    def test_model_path_passed_to_llama_factory(self):
        candidates = [{"prompt": "A", "chosen": " C", "rejected": " R", "reward": 0.5}]
        responses = {"A C": [-0.1, -0.5], "A R": [-0.1, -0.3]}

        instances = []

        class TrackingLlama:
            def __init__(self, **kwargs):
                instances.append(kwargs)

            def tokenize(self, text):
                return list(range(len(text.decode().split())))

            def create_completion(self, prompt, **kwargs):
                return {"choices": [{"logprobs": {"token_logprobs": responses[prompt]}}]}

        scorer = make_llama_scorer("/my/base.gguf", llama_factory=TrackingLlama)
        scorer(None, candidates)

        assert instances[0].get("model_path") == "/my/base.gguf"

    def test_scorer_computes_correct_mean_margin(self):
        # Candidate 0: prompt="A B" (2 tokens), chosen=" C" (1), rejected=" D" (1)
        #   "A B C" logprobs=[-0.1, -0.2, -0.6] → chosen_score = mean([-0.6]) = -0.6
        #   "A B D" logprobs=[-0.1, -0.2, -0.4] → rejected_score = mean([-0.4]) = -0.4
        #   margin_0 = -0.6 - (-0.4) = -0.2
        # Candidate 1: prompt="E" (1 token), chosen=" F G" (2), rejected=" H" (1)
        #   "E F G" logprobs=[-0.5, -0.3, -0.2] → chosen_score = mean([-0.3, -0.2]) = -0.25
        #   "E H"   logprobs=[-0.5, -0.9]        → rejected_score = mean([-0.9]) = -0.9
        #   margin_1 = -0.25 - (-0.9) = 0.65
        # Result = mean([-0.2, 0.65]) = 0.225

        candidates = [
            {"prompt": "A B", "chosen": " C", "rejected": " D", "reward": 0.5},
            {"prompt": "E", "chosen": " F G", "rejected": " H", "reward": 0.5},
        ]
        responses = {
            "A B C": [-0.1, -0.2, -0.6],
            "A B D": [-0.1, -0.2, -0.4],
            "E F G": [-0.5, -0.3, -0.2],
            "E H":   [-0.5, -0.9],
        }

        factory = make_mock_llama_factory(responses)
        scorer = make_llama_scorer("/base.gguf", llama_factory=factory)
        result = scorer(None, candidates)

        assert result == pytest.approx(0.225)

    def test_scorer_slices_response_tokens_from_prompt_boundary(self):
        # prompt="X Y Z" (3 tokens) → slice at index 3
        # "X Y Z W" → response logprob = all_logprobs[3:] = [-0.8], mean = -0.8
        # "X Y Z Q" → response logprob = [-0.2], mean = -0.2
        # margin = -0.8 - (-0.2) = -0.6

        candidates = [{"prompt": "X Y Z", "chosen": " W", "rejected": " Q", "reward": 0.5}]
        responses = {
            "X Y Z W": [-0.1, -0.1, -0.1, -0.8],
            "X Y Z Q": [-0.1, -0.1, -0.1, -0.2],
        }

        factory = make_mock_llama_factory(responses)
        scorer = make_llama_scorer("/base.gguf", llama_factory=factory)
        result = scorer(None, candidates)

        assert result == pytest.approx(-0.6)

    def test_scorer_returns_zero_for_empty_held_out(self):
        factory = make_mock_llama_factory({})
        scorer = make_llama_scorer("/base.gguf", llama_factory=factory)
        result = scorer(None, [])

        assert result == pytest.approx(0.0)

    def test_mean_response_logprob_returns_zero_when_response_has_no_tokens(self):
        # If prompt+response tokenizes to exactly prompt_len tokens, response slice is empty → 0.0
        # prompt="A B" (2 tokens), chosen="" → "A B" tokenizes to 2 tokens
        # all_logprobs[2:] = [] → chosen_score = 0.0
        # rejected="" same → rejected_score = 0.0; margin = 0.0
        candidates = [{"prompt": "A B", "chosen": "", "rejected": "", "reward": 0.5}]
        responses = {"A B": [-0.1, -0.2]}  # only prompt tokens

        factory = make_mock_llama_factory(responses)
        scorer = make_llama_scorer("/base.gguf", llama_factory=factory)
        result = scorer(None, candidates)

        assert result == pytest.approx(0.0)
