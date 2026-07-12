import math
from scripts.perf.stats import Row, percentile, summarize


def _row(elapsed, status="done", band="heavy", error=None):
    return Row(band=band, format="lesson", depth="deep", level="expert",
               target_pages=8, status=status, elapsed_s=elapsed,
               output_chars=(100 if elapsed else None), error=error)


def test_sample_errors_captured_and_deduped_in_reason():
    rows = ([_row(10.0) for _ in range(5)]
            + [_row(None, status="failed", error="format 'quiz' not yet supported in this MVP")
               for _ in range(3)]
            + [_row(None, status="failed", error="invalid token")])
    s = summarize(rows, budget_s=90.0)
    assert s.passed is False
    # distinct, order-preserving
    assert s.sample_errors == ["format 'quiz' not yet supported in this MVP", "invalid token"]
    assert "format 'quiz'" in s.verdict_reason and "invalid token" in s.verdict_reason


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
    assert s.p95 == 38.0 and s.max == 39.0
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
