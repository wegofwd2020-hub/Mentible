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

Needs `httpx` on the path — a clean system `python3` will `ModuleNotFoundError`.
Use the backend venv (which already has it), from the repo root:

```bash
.venv/bin/python3 -m scripts.perf.latency_probe
# or: source .venv/bin/activate && python3 -m scripts.perf.latency_probe
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
