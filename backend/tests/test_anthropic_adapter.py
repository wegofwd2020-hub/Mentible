"""AnthropicAdapter maps SDK HTTP status to the typed, key-free error hierarchy
so callers can distinguish a rejected key (401/403) and rate limits (429) from a
generic failure — without ever stringifying the SDK exception (which can carry
the api_key)."""

import pytest
from pipeline.providers.anthropic_adapter import AnthropicAdapter
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.errors import LLMAuthError, LLMError, LLMRateLimitError


class _StatusError(Exception):
    """Stand-in for an Anthropic SDK APIStatusError, which carries .status_code
    and whose repr could include the api_key (so it must never be stringified)."""

    def __init__(self, status_code: int) -> None:
        super().__init__("sk-ant-SECRETKEY-should-never-surface")
        self.status_code = status_code


def _adapter_with_inner(side_effect: Exception) -> AnthropicAdapter:
    # Bypass __init__ (which would construct the real provider / need the SDK) and
    # inject a stub inner provider that raises on generate().
    adapter = object.__new__(AnthropicAdapter)
    adapter._model = "claude-sonnet-4-6"

    class _Inner:
        def generate(self, *_args, **_kwargs):
            raise side_effect

    adapter._inner = _Inner()
    return adapter


@pytest.mark.parametrize(
    "status, expected",
    [(401, LLMAuthError), (403, LLMAuthError), (429, LLMRateLimitError), (500, LLMError)],
)
def test_status_maps_to_typed_error(status, expected):
    adapter = _adapter_with_inner(_StatusError(status))
    with pytest.raises(expected) as exc_info:
        adapter.generate(LLMRequest(prompt="hi", max_tokens=16))
    # Message is key-free regardless of the underlying SDK exception's repr.
    assert "sk-ant-" not in str(exc_info.value)


def test_error_without_status_is_generic():
    adapter = _adapter_with_inner(RuntimeError("connection reset"))
    with pytest.raises(LLMError):
        adapter.generate(LLMRequest(prompt="hi", max_tokens=16))
