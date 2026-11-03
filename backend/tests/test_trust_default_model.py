from backend.config import settings
from backend.src.trust.generate import default_model_for


def test_groq_default_is_groq_model_not_claude():
    assert default_model_for("groq") == settings.groq_default_model
    assert default_model_for("groq") != settings.anthropic_default_model


def test_anthropic_default_unchanged():
    assert default_model_for("anthropic") == settings.anthropic_default_model
