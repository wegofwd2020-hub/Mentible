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
