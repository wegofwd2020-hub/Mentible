from __future__ import annotations

from dataclasses import dataclass

from .errors import STTConfigurationError
from .providers import OpenAICompatibleSTTProvider


@dataclass(frozen=True)
class STTSpec:
    provider_id: str
    base_url: str
    default_model: str


STT_REGISTRY: dict[str, STTSpec] = {
    "groq": STTSpec("groq", "https://api.groq.com/openai/v1", "whisper-large-v3"),
    "openai": STTSpec("openai", "https://api.openai.com/v1", "whisper-1"),
}


def build_stt_provider(
    provider_id: str, *, api_key: str, model: str | None = None, http_client=None
) -> OpenAICompatibleSTTProvider:
    spec = STT_REGISTRY.get(provider_id)
    if spec is None:
        raise STTConfigurationError(f"unknown STT provider {provider_id!r}")
    return OpenAICompatibleSTTProvider(
        provider_id=spec.provider_id,
        base_url=spec.base_url,
        model=model or spec.default_model,
        api_key=api_key,
        http_client=http_client,
    )
