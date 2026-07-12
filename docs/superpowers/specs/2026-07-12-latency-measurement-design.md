# Latency Measurement — per-topic generation p95 probe

**Date:** 2026-07-12
**Author:** Siva Mambakkam (with Claude)
**Status:** Approved (design) — ready for implementation plan

## Problem

D12 (SCOPE §6.6) commits the product to a **"minutes, not seconds-with-stream"**
generation-latency posture. The concrete MVP acceptance line we track is
**per-topic generation p95 < 90 s**. It is the last unproven MVP criterion — we
have *never measured it*. The generation path stores no timestamps, so today the
number is unknown, and the resume pin flags a worry ("poll TTL is 600 s and some
runs feel slow — it may already be blown").

This project produces the number: a re-runnable probe that fires a fixed corpus of
real generations at the **production** backend over the **BYOK** path and reports
p50 / p90 / p95 / max plus a pass/fail verdict against the 90 s budget.

## Scope

**In:**
- A standalone, committed, re-runnable measurement script.
- Measures **per-topic generation** only: `POST /generate` (submit) → poll
  `GET /jobs/{id}` until `done`/`failed` (the D2 async path).
- Runs **sequentially** (one job in flight) against **prod** over **BYOK**.
- A dated JSON report + a console table with a PASS/FAIL verdict.

**Out (explicitly not this project):**
- Full book *generate-all* latency (N × per-topic — trivially over budget; a
  different UX metric).
- Compile / EPUB-PDF latency (separate puppeteer pipeline, separate budget).
- Concurrent / load testing (queue-contention under N users) — sequential only;
  the criterion is "does *a* generation finish under budget", not "under load".
  D7 is quality-first, not scale-first.
- Adding server-side timing instrumentation to the job model. Measurement is
  client-side wall-clock (submit → first `done` poll). Server instrumentation is
  a possible follow-up if the number is bad and we need to attribute the time
  (queue vs LLM vs validation).
- Any CI wiring. This hits a live provider; per CLAUDE.md it must never run in CI.

## Why client-side wall-clock is the right measure

The number a user feels is submit → result. Polling at 1.5 s adds at most 1.5 s of
quantization to each sample — negligible against a 90 s budget, and it errors on
the *slow* side (we can only over-report, never under-report, latency), so a PASS
is conservative. Server-side per-stage timing would attribute the time but not
change the pass/fail line; deferred.

## Approach

A standalone async Python script, `scripts/perf/latency_probe.py`, using
`httpx.AsyncClient`. Chosen over a pytest perf-test (which would sit in the test
tree and invite an accidental CI run against live Anthropic) and over a curl/shell
loop (no real percentile math, painful JSON polling).

The script is committed so the measurement is repeatable: when the model, prompt
templates, or infra change, re-run it and compare.

## Design

### 1. Corpus (30 fixed topics, three weight bands)

Hard-coded in the script — a fixed corpus makes runs comparable over time. Real
STEM topics (not degenerate one-word prompts) so token counts are realistic.
Three bands so both p50 and the p95 tail are meaningful:

| Band | Count | Params | Purpose |
|---|---|---|---|
| **Heavy** | 12 | `depth:deep`, `level:expert`, `diagram_register:technical`, `target_pages 6–10`, mix of `format:lesson` / `format:quiz` | Drives the p95 tail — most output tokens |
| **Medium** | 12 | `depth:standard`, `level:professional`, `diagram_register:balanced`, `target_pages 3–4` | The p50 body |
| **Light** | 6 | `depth:quick`, `level:student`, `diagram_register:conceptual`, `target_pages 0` | Floor / fast path |

Each request carries a fresh `request_id` (uuid4) — the idempotency key — so no
call collapses into another's cached job. All use `provider_id:"anthropic"`,
default model (prod `anthropic_default_model = claude-sonnet-4-6`), `language:"en"`.

### 2. Per-job loop (sequential)

For each corpus entry, in order:

1. Build `GenerateRequest` body (params from the entry + fresh uuid4 + the BYOK
   `api_key` from env).
2. `t_submit = perf_counter()`; `POST {base}/generate` with
   `Authorization: Bearer {jwt}`. Expect `202` + `job_id`.
3. Poll `GET {base}/jobs/{job_id}` every **1.5 s**.
4. Stop on `status in {"done","failed"}` or when elapsed exceeds the **180 s**
   per-job timeout (2× budget — a blown job becomes a recorded data point, not a
   crash).
5. Record a row: `band, format, depth, level, target_pages, status,
   elapsed_s, output_chars` (output_chars = length of the result payload when
   `done`, else null).

Sequential: the next job starts only after the current one settles. No
self-inflicted queue depth.

### 3. Metrics & report

Console table + `docs/perf/latency-YYYY-MM-DD.json`:

- **Overall:** count, mean, p50, p90, p95, max (over *successful* elapsed times).
- **Verdict line:** count and % of successes with `elapsed_s > 90`; PASS iff
  `p95 < 90` **and** timeouts == 0, else FAIL with the offending number.
- **Per-band** p50/p95 — shows whether the tail is all-heavy or mediums also blow
  it.
- **Failures/timeouts** listed separately from the percentile pool. A timeout or a
  `failed` job is **not** a slow success and must never be folded into the elapsed
  distribution (that would understate the tail — a 180 s timeout counted as "180 s
  latency" is wrong; it's a *non-completion*). Report them as their own count.

JSON report holds the raw rows (for later diffing) + the computed summary.

### 4. Configuration & security (ADR-001, CLAUDE.md non-negotiables)

Env only — the script fails fast if a required var is missing:

| Env | Meaning | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | BYOK key, `sk-ant-…` | yes |
| `MENTIBLE_TEST_JWT` | IdP session JWT (user mints a test token) | yes |
| `MENTIBLE_API_BASE` | Backend base URL; default `https://mambakkam.net/mentible-api` | no |

Key discipline:
- The BYOK key travels **only** in the `/generate` request body (never a header we
  own, never a query param).
- The key and the JWT are **never** printed, never written to the JSON report,
  never logged. Request bodies are never dumped. On error, log status + job_id
  only.
- TLS only (prod base is https). Refuse a non-https base unless it is localhost.

### 5. Verdict

Script exits `0` on PASS, non-zero on FAIL, and prints the decisive number, so the
run itself is the record of whether the MVP criterion is met.

## Testing

This is a measurement tool, not product code; its own "test" is a dry-run:
- **Offline unit-testable piece:** the stats/verdict function (given a list of
  elapsed times + statuses → summary + PASS/FAIL). Unit-test it with fixed inputs
  (known p95, a timeout that must be excluded, an empty-success edge). No network.
- The HTTP loop is exercised live by running the probe (the deliverable itself);
  not mocked in CI (never runs in CI).

## Deliverables

1. `scripts/perf/latency_probe.py` — the probe (corpus, loop, stats, report).
2. `scripts/perf/README.md` — how to set the three env vars, mint the JWT, run,
   and read the report.
3. Unit test for the pure stats/verdict function.
4. First real report committed at `docs/perf/latency-2026-07-12.json` **after** the
   live run (a real datapoint, or FAIL evidence).

## Open questions

None blocking. If the number FAILs, the follow-up (attribute queue vs LLM vs
validation via server-side timing) is a separate project, not this one.
