"""Fixed 30-topic generation corpus for the latency probe.

Three weight bands so p50 (body) and p95 (tail) are both meaningful. Real STEM
topics — not degenerate prompts — so token counts are realistic. Keep this list
STABLE across runs so results are comparable over time.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CorpusEntry:
    band: str
    topic: str
    level: str
    format: str
    depth: str
    diagram_register: str
    target_pages: int


def _heavy(topic: str, fmt: str, pages: int) -> CorpusEntry:
    return CorpusEntry("heavy", topic, "expert", fmt, "deep", "technical", pages)


def _medium(topic: str, fmt: str) -> CorpusEntry:
    return CorpusEntry("medium", topic, "professional", fmt, "standard", "balanced", 3)


def _light(topic: str, fmt: str) -> CorpusEntry:
    return CorpusEntry("light", topic, "student", fmt, "quick", "conceptual", 0)


CORPUS: list[CorpusEntry] = [
    # ── Heavy (12): deep + expert + technical diagrams + long ──────────────
    _heavy("Backpropagation through a multi-layer perceptron", "lesson", 10),
    _heavy("The CAP theorem and consensus in distributed databases", "lesson", 9),
    _heavy("Fourier transforms and the frequency domain", "lesson", 9),
    _heavy("TCP congestion control (slow start, AIMD, BBR)", "lesson", 8),
    _heavy("Eigenvalues, eigenvectors, and diagonalization", "lesson", 8),
    _heavy("The transformer attention mechanism, step by step", "lesson", 10),
    _heavy("RSA and elliptic-curve public-key cryptography", "lesson", 8),
    _heavy("Thermodynamic entropy and the second law", "lesson", 7),
    _heavy("Database transaction isolation levels and MVCC", "quiz", 7),
    _heavy("Kubernetes scheduling and the control loop", "quiz", 7),
    _heavy("The mathematics of gradient descent optimizers", "quiz", 8),
    _heavy("Special relativity: time dilation and length contraction", "quiz", 8),
    # ── Medium (12): standard + professional + balanced ────────────────────
    _medium("How DNS resolution works end to end", "lesson"),
    _medium("REST vs GraphQL API design trade-offs", "lesson"),
    _medium("Git branching and merge strategies", "lesson"),
    _medium("The photosynthesis light and dark reactions", "lesson"),
    _medium("Supply and demand and market equilibrium", "lesson"),
    _medium("Object-oriented vs functional programming", "lesson"),
    _medium("How vaccines train the immune system", "quiz"),
    _medium("Big-O notation and algorithmic complexity", "quiz"),
    _medium("The water cycle and weather systems", "quiz"),
    _medium("Basics of double-entry bookkeeping", "quiz"),
    _medium("How a CPU pipeline executes instructions", "lesson"),
    _medium("Acids, bases, and the pH scale", "quiz"),
    # ── Light (6): quick + student + conceptual + no page target ───────────
    _light("What is a variable in programming?", "lesson"),
    _light("Why is the sky blue?", "explanation"),
    _light("What is a fraction?", "lesson"),
    _light("The three states of matter", "explanation"),
    _light("What does a web browser do?", "lesson"),
    _light("What is gravity?", "explanation"),
]
