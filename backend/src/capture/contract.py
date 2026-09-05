from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptSegment:
    text: str
    start: float
    end: float
    confidence: float | None = None  # segment-level; None if the provider omits it


@dataclass(frozen=True)
class TranscriptionRequest:
    audio_path: str
    language: str
    model: str | None = None
