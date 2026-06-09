# Vendored Files

Files in this directory are copied from `StudyBuddy_OnDemand`. See
`../docs/adr/ADR-002-repo-structure-and-vendoring.md` for the rationale.

> **The active LLM provider seam is no longer here — it is the `wegofwd-llm`
> package (ADR-012).** The typed contract, registry, conformance loop, and the
> Anthropic-tool-use / OpenAI-compatible providers were extracted to
> `wegofwd-llm` and are consumed as a pinned dependency (see
> `backend/requirements.txt`). The legacy rows below (`base.py`, `anthropic.py`,
> `providers/__init__.py`) remain only as a **deprecated rollback path** behind
> `anthropic_adapter.py`, pending removal once the adapter is retired.
> `config.py` (author/book LLM config) stays Mentible-owned. Do **not** re-vendor
> the provider seam — change it in `wegofwd-llm` and bump the pin.

**Source repo:** https://github.com/wegofwd2020-hub/StudyBuddy_OnDemand
**Last sync:** 2026-04-25 from `0e7ebc06fdf6d14657ed201a1cb1d667fc7a0595`

## Sync table

| File | Source path | Source SHA | Synced at | Modified locally? |
|---|---|---|---|---|
| `prompts.py` | `pipeline/prompts.py` | `0e7ebc06` | 2026-04-25 | No |
| `content_format_validator.py` | `pipeline/content_format_validator.py` | `0e7ebc06` | 2026-04-25 | No |
| `providers/__init__.py` | `pipeline/providers/__init__.py` | `0e7ebc06` | 2026-04-25 | **Yes** — Q is single-provider; OnDemand registry intentionally not vendored |
| `providers/base.py` | `pipeline/providers/base.py` | `0e7ebc06` | 2026-04-25 | No |
| `providers/anthropic.py` | `pipeline/providers/anthropic.py` | `0e7ebc06` | 2026-04-25 | **Yes** — constructor takes `api_key` per call (BYOK), not from config/env. See ADR-001 |
| `toc_structurer.py` | `pipeline/toc_structurer.py` | `458287b` | 2026-05-26 | **Yes** — network wrapper `structure_toc(provider)` dropped (its error path could stringify the BYOK key); Q vendors only the models + `STRUCTURE_PROMPT_TEMPLATE` + new pure `parse_structured_toc()`, and drives the LLM call via the backend's key-safe `call_anthropic` seam. See ADR-001 / ADR-003 |

## Files explicitly NOT vendored

| File | Why not |
|---|---|
| `providers/openai.py`, `providers/google.py`, `providers/registry.py` | Q is single-provider (Anthropic only) — multi-provider registry adds no value, only attack surface |
| `build_grade.py`, `build_unit.py`, `seed_default.py` | Curriculum-build CLIs — not relevant to a per-request consumer client |
| `tts_worker.py`, `alex_runner.py` | Audio generation + AlexJS content moderation — v2+ concerns |
| `config.py` | Q-specific configuration (BYOK constraints, no Postgres at MVP) — written from scratch |
| `schemas.py`, `Dockerfile` | Q has its own deployment shape |

## Sync process

```bash
./scripts/sync-from-ondemand.sh /path/to/StudyBuddy_OnDemand
```

Updates this file with new SHAs, then opens a PR. Files marked "Modified
locally" require manual three-way merge — never let the script overwrite them
silently.
