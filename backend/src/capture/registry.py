from __future__ import annotations

from dataclasses import dataclass

from .errors import STTConfigurationError
from .providers import OpenAICompatibleSTTProvider, STTProvider, SarvamSTTProvider


@dataclass(frozen=True)
class STTSpec:
    provider_id: str
    base_url: str
    default_model: str
    # Which provider family builds this entry. "openai" = the OpenAI/Groq
    # multipart `/audio/transcriptions` shape; "sarvam" = Sarvam's own
    # `/speech-to-text` API (different auth header + response shape).
    kind: str = "openai"


STT_REGISTRY: dict[str, STTSpec] = {
    "groq": STTSpec("groq", "https://api.groq.com/openai/v1", "whisper-large-v3"),
    "openai": STTSpec("openai", "https://api.openai.com/v1", "whisper-1"),
    # Sarvam Saarika/Saaras — Indic-specialized STT (far stronger on Tamil than
    # Whisper). Base is the bare host; the provider appends /speech-to-text.
    "sarvam": STTSpec("sarvam", "https://api.sarvam.ai", "saaras:v3", kind="sarvam"),
}


def build_stt_provider(
    provider_id: str, *, api_key: str, model: str | None = None, http_client=None
) -> STTProvider:
    spec = STT_REGISTRY.get(provider_id)
    if spec is None:
        raise STTConfigurationError(f"unknown STT provider {provider_id!r}")
    if spec.kind == "sarvam":
        return SarvamSTTProvider(
            provider_id=spec.provider_id,
            base_url=spec.base_url,
            model=model or spec.default_model,
            api_key=api_key,
            http_client=http_client,
        )
    return OpenAICompatibleSTTProvider(
        provider_id=spec.provider_id,
        base_url=spec.base_url,
        model=model or spec.default_model,
        api_key=api_key,
        http_client=http_client,
    )
