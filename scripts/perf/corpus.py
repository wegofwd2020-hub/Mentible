"""Fixed 30-topic generation corpus for the latency probe.

Three weight bands so p50 (body) and p95 (tail) are both meaningful. Real STEM
topics — not degenerate prompts — so token counts are realistic. Keep this list
STABLE across runs so results are comparable over time.

FORMAT: every entry is "lesson". At MVP only the `lesson` format is wired in the
backend worker — `explanation` and `quiz` are rejected with
"format 'X' not yet supported in this MVP" (D13). The p95 tail is driven by
depth/level/target_pages/diagram_register, not by format. Re-add other formats
here only once the worker supports them.
"""
from __future__ import annotations

from dataclasses import dataclass

_FORMAT = "lesson"  # only wired format at MVP (D13)


@dataclass(frozen=True)
class CorpusEntry:
    band: str
    topic: str
    level: str
    format: str
    depth: str
    diagram_register: str
    target_pages: int


def _heavy(topic: str, pages: int) -> CorpusEntry:
    return CorpusEntry("heavy", topic, "expert", _FORMAT, "deep", "technical", pages)


def _medium(topic: str) -> CorpusEntry:
    return CorpusEntry("medium", topic, "professional", _FORMAT, "standard", "balanced", 3)


def _light(topic: str) -> CorpusEntry:
    return CorpusEntry("light", topic, "student", _FORMAT, "quick", "conceptual", 0)


CORPUS: list[CorpusEntry] = [
    # ── Heavy (12): deep + expert + technical diagrams + long ──────────────
    _heavy("Backpropagation through a multi-layer perceptron", 10),
    _heavy("The CAP theorem and consensus in distributed databases", 9),
    _heavy("Fourier transforms and the frequency domain", 9),
    _heavy("TCP congestion control (slow start, AIMD, BBR)", 8),
    _heavy("Eigenvalues, eigenvectors, and diagonalization", 8),
    _heavy("The transformer attention mechanism, step by step", 10),
    _heavy("RSA and elliptic-curve public-key cryptography", 8),
    _heavy("Thermodynamic entropy and the second law", 7),
    _heavy("Database transaction isolation levels and MVCC", 7),
    _heavy("Kubernetes scheduling and the control loop", 7),
    _heavy("The mathematics of gradient descent optimizers", 8),
    _heavy("Special relativity: time dilation and length contraction", 8),
    # ── Medium (12): standard + professional + balanced ────────────────────
    _medium("How DNS resolution works end to end"),
    _medium("REST vs GraphQL API design trade-offs"),
    _medium("Git branching and merge strategies"),
    _medium("The photosynthesis light and dark reactions"),
    _medium("Supply and demand and market equilibrium"),
    _medium("Object-oriented vs functional programming"),
    _medium("How vaccines train the immune system"),
    _medium("Big-O notation and algorithmic complexity"),
    _medium("The water cycle and weather systems"),
    _medium("Basics of double-entry bookkeeping"),
    _medium("How a CPU pipeline executes instructions"),
    _medium("Acids, bases, and the pH scale"),
    # ── Light (6): quick + student + conceptual + no page target ───────────
    _light("What is a variable in programming?"),
    _light("Why is the sky blue?"),
    _light("What is a fraction?"),
    _light("The three states of matter"),
    _light("What does a web browser do?"),
    _light("What is gravity?"),
]
