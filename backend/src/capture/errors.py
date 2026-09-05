from __future__ import annotations


class STTError(Exception):
    """Base for all speech-to-text seam failures."""


class STTConfigurationError(STTError):
    """Unknown provider / no constructor wired."""


class STTAuthError(STTError):
    """Provider rejected the API key (401/403)."""


class STTRateLimitError(STTError):
    """Provider rate-limited the request (429)."""
