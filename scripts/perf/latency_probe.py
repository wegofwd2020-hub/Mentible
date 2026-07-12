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
