# Latency Measurement Probe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a committed, re-runnable probe that measures per-topic generation latency (submit → `done`) against the production backend over BYOK and prints a p50/p90/p95/max report with a PASS/FAIL verdict vs the 90 s MVP budget (D12).

**Architecture:** A self-contained `scripts/perf/` package. Pure percentile/verdict logic lives in `stats.py` (unit-tested offline). `latency_probe.py` holds the fixed 30-topic corpus, the sequential async submit-and-poll loop (`httpx.AsyncClient`), env-only config, and the JSON+console reporter. No CI wiring — it hits a live provider.

**Tech Stack:** Python 3.12, `httpx` (async), stdlib `statistics`/`json`/`argparse`/`os`/`time`. pytest for the offline stats test.

## Global Constraints

- **Endpoints** (exact): `POST {base}/api/v1/generate` → `202 {job_id, status}`; `GET {base}/api/v1/jobs/{job_id}` → `{status, result, error, usage, ...}`. `status ∈ {queued, running, done, failed}`.
- **Base URL:** env `MENTIBLE_API_BASE`, default `https://mambakkam.net/mentible-api`. The script appends `/api/v1/...`.
- **Budget:** per-topic generation **p95 < 90 s**; per-job timeout **180 s**; poll interval **1.5 s**.
- **Corpus:** 30 topics — 12 heavy, 12 medium, 6 light (bands per spec §1). Fresh `request_id` (uuid4) per call. `provider_id="anthropic"`, default model, `language="en"`.
- **Security (ADR-001 / CLAUDE.md):** BYOK key only in the `/generate` request body; key + JWT **never** printed, logged, or written to any report; request bodies never dumped; on error log status + job_id only. Refuse a non-`https` base unless host is `localhost`/`127.0.0.1`.
- **Env (fail fast if missing):** `ANTHROPIC_API_KEY` (required), `MENTIBLE_TEST_JWT` (required), `MENTIBLE_API_BASE` (optional).
- **Percentile method:** nearest-rank on the sorted list of **successful** elapsed times: `index = ceil(q/100 * n) - 1`, clamped to `[0, n-1]`. Timeouts and `failed` jobs are excluded from the percentile pool and counted separately.

---

### Task 1: Pure stats + verdict module

**Files:**
- Create: `scripts/perf/__init__.py` (empty)
- Create: `scripts/perf/stats.py`
- Test: `scripts/perf/test_stats.py`

**Interfaces:**
- Produces:
  - `percentile(sorted_vals: list[float], q: float) -> float` — nearest-rank; caller passes an already-sorted non-empty list.
  - `@dataclass Row` with fields `band: str`, `format: str`, `depth: str`, `level: str`, `target_pages: int`, `status: str`, `elapsed_s: float | None`, `output_chars: int | None`.
  - `@dataclass Summary` with fields `n_total: int`, `n_success: int`, `n_timeout: int`, `n_failed: int`, `mean: float | None`, `p50: float | None`, `p90: float | None`, `p95: float | None`, `max: float | None`, `n_over_budget: int`, `pct_over_budget: float`, `passed: bool`, `verdict_reason: str`, `by_band: dict[str, dict[str, float | None]]`.
  - `summarize(rows: list[Row], budget_s: float = 90.0) -> Summary` — success = `status == "done"` with a non-None `elapsed_s`; percentile pool = success elapsed times only. `passed = p95 is not None and p95 < budget_s and n_timeout == 0 and n_failed == 0`. `by_band[band] = {"p50":..., "p95":..., "n":...}` over that band's successes (None if the band has no successes).

- [ ] **Step 1: Write the failing test**

```python
# scripts/perf/test_stats.py
import math
from scripts.perf.stats import Row, percentile, summarize


def _row(elapsed, status="done", band="heavy"):
    return Row(band=band, format="lesson", depth="deep", level="expert",
               target_pages=8, status=status, elapsed_s=elapsed,
               output_chars=(100 if elapsed else None))


def test_percentile_nearest_rank():
    vals = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    assert percentile(vals, 50) == 5.0   # ceil(0.5*10)-1 = 4 -> vals[4]
    assert percentile(vals, 95) == 10.0  # ceil(0.95*10)-1 = 9 -> vals[9]
    assert percentile(vals, 100) == 10.0
    assert percentile([42.0], 95) == 42.0


def test_summarize_pass():
    rows = [_row(float(x)) for x in range(10, 40)]  # 10..39s, 30 successes
    s = summarize(rows, budget_s=90.0)
    assert s.n_success == 30 and s.n_timeout == 0 and s.n_failed == 0
    assert s.p95 == 39.0 and s.max == 39.0
    assert s.n_over_budget == 0
    assert s.passed is True


def test_summarize_fail_on_p95():
    rows = [_row(float(x)) for x in range(80, 110)]  # 80..109s
    s = summarize(rows, budget_s=90.0)
    assert s.p95 is not None and s.p95 >= 90.0
    assert s.n_over_budget > 0
    assert s.passed is False


def test_timeouts_excluded_from_pool_and_fail_verdict():
    rows = [_row(10.0) for _ in range(29)] + [_row(None, status="timeout")]
    s = summarize(rows, budget_s=90.0)
    assert s.n_success == 29 and s.n_timeout == 1
    assert s.p95 == 10.0            # timeout NOT folded in as 180s
    assert s.passed is False        # any timeout fails the verdict


def test_failed_job_excluded_and_fails_verdict():
    rows = [_row(10.0) for _ in range(29)] + [_row(None, status="failed")]
    s = summarize(rows, budget_s=90.0)
    assert s.n_failed == 1 and s.n_success == 29
    assert s.passed is False


def test_by_band_only_counts_band_successes():
    rows = [_row(10.0, band="heavy"), _row(20.0, band="light")]
    s = summarize(rows, budget_s=90.0)
    assert s.by_band["heavy"]["n"] == 1 and s.by_band["heavy"]["p95"] == 10.0
    assert s.by_band["light"]["n"] == 1 and s.by_band["light"]["p95"] == 20.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/perf/test_stats.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.perf.stats'`.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/perf/stats.py
"""Pure percentile + PASS/FAIL logic for the latency probe. No I/O, no network."""
from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class Row:
    band: str
    format: str
    depth: str
    level: str
    target_pages: int
    status: str            # "done" | "failed" | "timeout"
    elapsed_s: float | None
    output_chars: int | None


@dataclass
class Summary:
    n_total: int
    n_success: int
    n_timeout: int
    n_failed: int
    mean: float | None
    p50: float | None
    p90: float | None
    p95: float | None
    max: float | None
    n_over_budget: int
    pct_over_budget: float
    passed: bool
    verdict_reason: str
    by_band: dict = field(default_factory=dict)


def percentile(sorted_vals: list[float], q: float) -> float:
    """Nearest-rank percentile. `sorted_vals` must be sorted ascending & non-empty."""
    n = len(sorted_vals)
    idx = math.ceil(q / 100.0 * n) - 1
    idx = max(0, min(idx, n - 1))
    return sorted_vals[idx]


def _band_stats(elapsed: list[float]) -> dict:
    if not elapsed:
        return {"n": 0, "p50": None, "p95": None}
    s = sorted(elapsed)
    return {"n": len(s), "p50": percentile(s, 50), "p95": percentile(s, 95)}


def summarize(rows: list[Row], budget_s: float = 90.0) -> Summary:
    successes = [r for r in rows if r.status == "done" and r.elapsed_s is not None]
    n_timeout = sum(1 for r in rows if r.status == "timeout")
    n_failed = sum(1 for r in rows if r.status == "failed")
    elapsed = sorted(float(r.elapsed_s) for r in successes)

    if elapsed:
        mean = sum(elapsed) / len(elapsed)
        p50 = percentile(elapsed, 50)
        p90 = percentile(elapsed, 90)
        p95 = percentile(elapsed, 95)
        mx = elapsed[-1]
        n_over = sum(1 for e in elapsed if e > budget_s)
        pct_over = 100.0 * n_over / len(elapsed)
    else:
        mean = p50 = p90 = p95 = mx = None
        n_over = 0
        pct_over = 0.0

    passed = p95 is not None and p95 < budget_s and n_timeout == 0 and n_failed == 0
    if p95 is None:
        reason = "no successful generations to measure"
    elif not passed:
        bits = []
        if p95 >= budget_s:
            bits.append(f"p95 {p95:.1f}s >= {budget_s:.0f}s")
        if n_timeout:
            bits.append(f"{n_timeout} timeout(s)")
        if n_failed:
            bits.append(f"{n_failed} failure(s)")
        reason = "; ".join(bits)
    else:
        reason = f"p95 {p95:.1f}s < {budget_s:.0f}s, 0 timeouts, 0 failures"

    bands = sorted({r.band for r in rows})
    by_band = {
        b: _band_stats([float(r.elapsed_s) for r in successes if r.band == b])
        for b in bands
    }

    return Summary(
        n_total=len(rows), n_success=len(successes), n_timeout=n_timeout,
        n_failed=n_failed, mean=mean, p50=p50, p90=p90, p95=p95, max=mx,
        n_over_budget=n_over, pct_over_budget=pct_over, passed=passed,
        verdict_reason=reason, by_band=by_band,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/perf/test_stats.py -v`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/perf/__init__.py scripts/perf/stats.py scripts/perf/test_stats.py
git commit -m "feat(perf): pure percentile + PASS/FAIL stats for latency probe"
```

---

### Task 2: Corpus definition

**Files:**
- Create: `scripts/perf/corpus.py`
- Test: `scripts/perf/test_corpus.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `@dataclass CorpusEntry` with `band: str`, `topic: str`, `level: str`, `format: str`, `depth: str`, `diagram_register: str`, `target_pages: int`.
  - `CORPUS: list[CorpusEntry]` — exactly 30 entries: 12 `band="heavy"`, 12 `band="medium"`, 6 `band="light"`, matching the spec §1 band params.

- [ ] **Step 1: Write the failing test**

```python
# scripts/perf/test_corpus.py
from collections import Counter
from scripts.perf.corpus import CORPUS, CorpusEntry

_LEVELS = {"student", "professional", "expert"}
_FORMATS = {"lesson", "explanation", "quiz"}
_DEPTHS = {"quick", "standard", "deep"}
_REGISTERS = {"conceptual", "balanced", "technical"}


def test_corpus_size_and_bands():
    assert len(CORPUS) == 30
    assert Counter(e.band for e in CORPUS) == {"heavy": 12, "medium": 12, "light": 6}


def test_corpus_entries_use_valid_enum_values():
    for e in CORPUS:
        assert isinstance(e, CorpusEntry)
        assert e.topic.strip()
        assert e.level in _LEVELS
        assert e.format in _FORMATS
        assert e.depth in _DEPTHS
        assert e.diagram_register in _REGISTERS
        assert 0 <= e.target_pages <= 100


def test_bands_have_expected_weighting():
    heavy = [e for e in CORPUS if e.band == "heavy"]
    assert all(e.depth == "deep" and e.level == "expert" for e in heavy)
    assert all(e.diagram_register == "technical" and e.target_pages >= 6 for e in heavy)
    light = [e for e in CORPUS if e.band == "light"]
    assert all(e.depth == "quick" and e.level == "student" for e in light)
    assert all(e.target_pages == 0 for e in light)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/perf/test_corpus.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.perf.corpus'`.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/perf/corpus.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/perf/test_corpus.py -v`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/perf/corpus.py scripts/perf/test_corpus.py
git commit -m "feat(perf): fixed 30-topic 3-band corpus for latency probe"
```

---

### Task 3: HTTP probe loop + config + reporter + CLI

**Files:**
- Create: `scripts/perf/latency_probe.py`

**Interfaces:**
- Consumes: `scripts.perf.stats` (`Row`, `summarize`, `Summary`), `scripts.perf.corpus` (`CORPUS`, `CorpusEntry`).
- Produces: an executable `python3 -m scripts.perf.latency_probe` that reads env config, runs the sequential loop, writes `docs/perf/latency-YYYY-MM-DD.json`, prints a table, and exits `0` on PASS / `1` on FAIL / `2` on config error.

**Notes for the implementer:**
- Use `time.perf_counter()` for elapsed; `time.strftime("%Y-%m-%d")` for the report date (the script may use the real clock — it is not a workflow script).
- One shared `httpx.AsyncClient(timeout=30.0)` for all requests; loop is sequential (`await` each job before the next) — no `gather`.
- `output_chars = len(json.dumps(result))` when `status == "done"` and `result` is present, else `None`.
- Poll: sleep 1.5 s between `GET /jobs/{id}` calls; break on `done`/`failed`; if `perf_counter() - t_submit > 180`, record `status="timeout"` and move on.
- **Never** log/print `api_key` or the JWT. On a non-2xx submit, print `f"submit failed: HTTP {resp.status_code}"` (no body — the body echoes nothing sensitive but keep the habit) and record `status="failed"`.

- [ ] **Step 1: Write the implementation**

```python
# scripts/perf/latency_probe.py
"""Per-topic generation latency probe (D12 / MVP p95 < 90s).

Fires the fixed corpus at the production backend over BYOK, sequentially,
timing submit -> done. Prints p50/p90/p95/max + a PASS/FAIL verdict and writes
a dated JSON report. See scripts/perf/README.md.

Security (ADR-001): the BYOK key travels only in the /generate body; the key and
the JWT are never printed, logged, or written to the report.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlparse

import httpx

from scripts.perf.corpus import CORPUS, CorpusEntry
from scripts.perf.stats import Row, Summary, summarize

BUDGET_S = 90.0
JOB_TIMEOUT_S = 180.0
POLL_INTERVAL_S = 1.5
DEFAULT_BASE = "https://mambakkam.net/mentible-api"
_REPO_ROOT = Path(__file__).resolve().parents[2]


class ConfigError(Exception):
    pass


def _load_config() -> tuple[str, str, str]:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    jwt = os.environ.get("MENTIBLE_TEST_JWT", "").strip()
    base = os.environ.get("MENTIBLE_API_BASE", DEFAULT_BASE).strip().rstrip("/")
    if not key:
        raise ConfigError("ANTHROPIC_API_KEY is not set")
    if not jwt:
        raise ConfigError("MENTIBLE_TEST_JWT is not set")
    host = urlparse(base).hostname or ""
    if not base.startswith("https://") and host not in ("localhost", "127.0.0.1"):
        raise ConfigError(f"refusing non-https base {base!r} (TLS required)")
    return key, jwt, base


def _build_body(entry: CorpusEntry, key: str) -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "topic": entry.topic,
        "level": entry.level,
        "language": "en",
        "format": entry.format,
        "depth": entry.depth,
        "diagram_register": entry.diagram_register,
        "target_pages": entry.target_pages,
        "provider_id": "anthropic",
        "api_key": key,
    }


async def _run_one(client: httpx.AsyncClient, base: str, jwt: str,
                   entry: CorpusEntry, key: str) -> Row:
    headers = {"Authorization": f"Bearer {jwt}"}
    base_row = dict(band=entry.band, format=entry.format, depth=entry.depth,
                    level=entry.level, target_pages=entry.target_pages)
    t0 = time.perf_counter()
    try:
        resp = await client.post(f"{base}/api/v1/generate",
                                 json=_build_body(entry, key), headers=headers)
    except httpx.HTTPError as exc:
        print(f"  submit error: {type(exc).__name__}")
        return Row(**base_row, status="failed", elapsed_s=None, output_chars=None)
    if resp.status_code != 202:
        print(f"  submit failed: HTTP {resp.status_code}")
        return Row(**base_row, status="failed", elapsed_s=None, output_chars=None)
    job_id = resp.json()["job_id"]

    while True:
        await asyncio.sleep(POLL_INTERVAL_S)
        elapsed = time.perf_counter() - t0
        if elapsed > JOB_TIMEOUT_S:
            print(f"  timeout after {elapsed:.0f}s")
            return Row(**base_row, status="timeout", elapsed_s=None, output_chars=None)
        try:
            jr = await client.get(f"{base}/api/v1/jobs/{job_id}", headers=headers)
        except httpx.HTTPError:
            continue  # transient — keep polling until the job timeout
        if jr.status_code != 200:
            continue
        payload = jr.json()
        status = payload.get("status")
        if status == "done":
            elapsed = time.perf_counter() - t0
            result = payload.get("result")
            chars = len(json.dumps(result)) if result is not None else None
            print(f"  done in {elapsed:.1f}s ({chars} chars)")
            return Row(**base_row, status="done", elapsed_s=elapsed, output_chars=chars)
        if status == "failed":
            print(f"  job failed: {payload.get('error')}")
            return Row(**base_row, status="failed", elapsed_s=None, output_chars=None)


async def _run_all(base: str, jwt: str, key: str) -> list[Row]:
    rows: list[Row] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for i, entry in enumerate(CORPUS, 1):
            print(f"[{i}/{len(CORPUS)}] {entry.band:6} {entry.format:11} {entry.topic}")
            rows.append(await _run_one(client, base, jwt, entry, key))
    return rows


def _fmt(v: float | None) -> str:
    return f"{v:.1f}s" if v is not None else "  n/a"


def _print_report(summary: Summary) -> None:
    print("\n" + "=" * 60)
    print("LATENCY REPORT — per-topic generation (submit -> done)")
    print("=" * 60)
    print(f"jobs: {summary.n_total}  ok: {summary.n_success}  "
          f"timeout: {summary.n_timeout}  failed: {summary.n_failed}")
    print(f"mean {_fmt(summary.mean)}  p50 {_fmt(summary.p50)}  "
          f"p90 {_fmt(summary.p90)}  p95 {_fmt(summary.p95)}  max {_fmt(summary.max)}")
    print(f"over {BUDGET_S:.0f}s: {summary.n_over_budget} "
          f"({summary.pct_over_budget:.0f}% of successes)")
    print("by band:")
    for band, st in summary.by_band.items():
        print(f"  {band:6}  n={st['n']:2}  p50 {_fmt(st['p50'])}  p95 {_fmt(st['p95'])}")
    verdict = "PASS" if summary.passed else "FAIL"
    print("-" * 60)
    print(f"VERDICT: {verdict} — {summary.verdict_reason}")
    print("=" * 60)


def _write_json(rows: list[Row], summary: Summary) -> Path:
    out_dir = _REPO_ROOT / "docs" / "perf"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"latency-{time.strftime('%Y-%m-%d')}.json"
    path.write_text(json.dumps(
        {"budget_s": BUDGET_S, "rows": [asdict(r) for r in rows],
         "summary": asdict(summary)}, indent=2))
    return path


def main() -> int:
    try:
        key, jwt, base = _load_config()
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2
    print(f"probing {base} — {len(CORPUS)} jobs, sequential, budget {BUDGET_S:.0f}s\n")
    rows = asyncio.run(_run_all(base, jwt, key))
    summary = summarize(rows, budget_s=BUDGET_S)
    _print_report(summary)
    path = _write_json(rows, summary)
    print(f"report: {path.relative_to(_REPO_ROOT)}")
    return 0 if summary.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Verify it imports and fails fast without env**

Run: `env -u ANTHROPIC_API_KEY -u MENTIBLE_TEST_JWT python3 -m scripts.perf.latency_probe; echo "exit=$?"`
Expected: prints `config error: ANTHROPIC_API_KEY is not set` and `exit=2` (no network attempted).

- [ ] **Step 3: Verify the non-https guard**

Run: `ANTHROPIC_API_KEY=sk-ant-x MENTIBLE_TEST_JWT=y MENTIBLE_API_BASE=http://example.com python3 -m scripts.perf.latency_probe; echo "exit=$?"`
Expected: `config error: refusing non-https base 'http://example.com' (TLS required)` and `exit=2`.

- [ ] **Step 4: Commit**

```bash
git add scripts/perf/latency_probe.py
git commit -m "feat(perf): sequential BYOK latency probe loop + reporter"
```

---

### Task 4: Operator README

**Files:**
- Create: `scripts/perf/README.md`

- [ ] **Step 1: Write the README**

````markdown
# Latency probe — per-topic generation p95

Measures per-topic generation latency (submit → `done`) against a running backend
over BYOK, sequentially, and reports p50/p90/p95/max with a PASS/FAIL verdict vs
the 90 s MVP budget (D12). Design: `docs/superpowers/specs/2026-07-12-latency-measurement-design.md`.

## What it does NOT do
- No CI (hits a live LLM provider — never wire into CI).
- No concurrency (sequential — measures per-job latency, not load).
- No book-generate-all, no compile latency.

## Setup

Three env vars (the script fails fast — exit 2 — if a required one is missing):

| Env | Meaning | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your BYOK key (`sk-ant-…`). Sent only in the `/generate` body; never printed or written to the report. | yes |
| `MENTIBLE_TEST_JWT` | A valid IdP session JWT (mint a test token for a test account). | yes |
| `MENTIBLE_API_BASE` | Backend base URL. Default `https://mambakkam.net/mentible-api`. Non-https is refused unless localhost. | no |

In this Claude Code session, set the key yourself so the harness never handles it:

```
! export ANTHROPIC_API_KEY=sk-ant-...
! export MENTIBLE_TEST_JWT=<your test jwt>
```

## Run

From the repo root:

```bash
python3 -m scripts.perf.latency_probe
```

Runs 30 jobs (~a few minutes, one at a time). Prints a per-job line, then the
report. Exit code: `0` PASS, `1` FAIL, `2` config error.

## Output

- Console: per-job timing + a summary table + `VERDICT: PASS/FAIL — <reason>`.
- File: `docs/perf/latency-YYYY-MM-DD.json` — raw rows + computed summary, for
  diffing across runs when the model or prompts change.

## Reading the verdict

PASS iff **p95 < 90 s AND zero timeouts AND zero failures**. Timeouts (>180 s) and
`failed` jobs are counted separately and kept **out** of the percentile pool — a
non-completion is not a slow success. If the tail is all in the `heavy` band, the
`by band` breakdown shows it.

## Unit tests (offline, no network)

```bash
python3 -m pytest scripts/perf/test_stats.py scripts/perf/test_corpus.py -v
```
````

- [ ] **Step 2: Commit**

```bash
git add scripts/perf/README.md
git commit -m "docs(perf): operator README for the latency probe"
```

---

### Task 5: Live run + commit the first report (OPERATOR — needs the user's key + JWT)

> This task is **not** a coding task and cannot be run by a subagent — it needs the user's BYOK key and a freshly minted test JWT, which only the user supplies. Run it interactively with the user.

- [ ] **Step 1: User sets env in the session**

The user runs (so the harness never sees the secrets):

```
! export ANTHROPIC_API_KEY=sk-ant-...
! export MENTIBLE_TEST_JWT=<freshly minted test jwt>
```

- [ ] **Step 2: Run the probe**

Run: `python3 -m scripts.perf.latency_probe`
Expected: 30 per-job lines, a summary table, a `VERDICT` line, and a written
`docs/perf/latency-<date>.json`.

- [ ] **Step 3: Commit the report**

```bash
git add docs/perf/latency-*.json
git commit -m "perf: first per-topic generation latency measurement (p95 vs 90s budget)"
```

- [ ] **Step 4: Record the outcome**

- If **PASS**: the last unproven MVP criterion is now proven — note the p95 in the resume pin / STATUS.
- If **FAIL**: open a follow-up issue to attribute the time (queue vs LLM vs validation via server-side timing), citing the report. That attribution work is a *separate* project.

---

## Self-Review

**Spec coverage:**
- Corpus (spec §1) → Task 2. ✓
- Per-job loop, 1.5 s poll, 180 s timeout (§2) → Task 3 `_run_one`. ✓
- Metrics p50/p90/p95/max, %-over-90s, per-band, timeouts/failures separate (§3) → Task 1 `summarize` + Task 3 `_print_report`/`_write_json`. ✓
- Env-only config, key discipline, TLS-only (§4) → Task 3 `_load_config`/`_build_body`, Global Constraints. ✓
- Verdict exit codes (§5) → Task 3 `main`. ✓
- Offline-unit-testable stats piece (Testing) → Task 1. ✓
- Deliverables 1–4 → Tasks 3, 4, 1, 5. ✓

**Placeholder scan:** none — all steps carry real code/commands.

**Type consistency:** `Row`/`Summary` fields and `summarize(rows, budget_s)` signature are identical across Task 1 (def), Task 3 (use). `CorpusEntry` fields match between Task 2 (def) and Task 3 `_build_body`. Endpoint paths match Global Constraints. `status` values `{done, failed, timeout}` are consistent between `_run_one` (producer) and `summarize` (consumer).
