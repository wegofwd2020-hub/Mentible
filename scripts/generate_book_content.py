#!/usr/bin/env python3
"""Headless book-content generator (ADR-018 #113).

Fill a `.book.json`'s per-topic lesson content via the *real* Mentible pipeline —
the same prompt builder, provider seam, schema validation and repair loop that
`backend/src/generate/tasks.run_generation` uses, minus the Redis/job envelope.
The Anthropic key is read locally, used in-process, and NEVER printed or logged
(ADR-001 discipline).

Resumable: content is checkpointed to disk after every topic, and topics that
already have content are skipped — so a rate-limit/interrupt mid-run is safe to
re-run.

Provider is chosen by --provider, else book.generationParams.provider, else
anthropic. The key is read from the provider's env var (ANTHROPIC_API_KEY,
GEMINI_API_KEY, …) or a gitignored --key-file.

Usage:
    # Anthropic (default) — key from a gitignored file (keeps it out of shell history/logs)
    python scripts/generate_book_content.py library/books/<book>.book.json --key-file .anthropic_key.local
    # Gemini (or any registry provider) — provider override + its own key file
    python scripts/generate_book_content.py library/books/<book>.book.json \
        --provider gemini --key-file .gemini_key.local
    # or from the environment (env var name depends on the provider)
    ANTHROPIC_API_KEY=sk-ant-... python scripts/generate_book_content.py library/books/<book>.book.json

Then publish with the owner CLI:
    python -m backend.src.core.owner_cli publish <book-id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# backend.config validates these at import; this runner never uses them (it talks
# to the provider directly), so set harmless placeholders before importing.
os.environ.setdefault("BYOK_MASTER_KEY", "0" * 64)
os.environ.setdefault("SYSTEM_OWNER_SECRET", "0" * 64)

import time  # noqa: E402

from wegofwd_llm.conformance import generate_validated  # noqa: E402
from wegofwd_llm.contract import LLMRequest  # noqa: E402
from wegofwd_llm.errors import (  # noqa: E402
    LLMAuthError,
    LLMConfigurationError,
    LLMError,
    LLMNotAllowedError,
    LLMSchemaError,
)
from wegofwd_llm.registry import PROVIDER_REGISTRY, build_provider, provenance  # noqa: E402

from backend.src.generate.anthropic_caller import parse_json_response  # noqa: E402
from backend.src.generate.lesson_schema import LessonOutput  # noqa: E402
from backend.src.generate.prompt_builder import build_lesson_prompt  # noqa: E402

_MAX_TOKENS = 16384  # matches tasks._DEFAULT_MAX_TOKENS for a no-page-target lesson
_MAX_REPAIRS = 2  # matches tasks._MAX_REPAIRS (1 call + 2 targeted repairs)
# Seconds to wait before each retry of a transient provider error (429/529/timeout).
# The native adapter collapses all transients to a bare LLMError, and a 30-call
# batch will hit at least one — so unlike the single-shot backend path (which
# fails fast), the batch runner retries with backoff.
_RETRY_BACKOFFS = (5, 15, 45)

# Errors a re-roll can't fix: a bad/blocked key, an unknown provider, or a response
# that failed schema validation after the repair budget. Retrying these just burns
# the backoff (a 401 has no business waiting 5+15+45s) and, for auth, the tokens.
# Anything else — rate-limit, timeout, 5xx, or a bare LLMError from an older seam
# build that can't classify — stays retryable, so this is safe against wegofwd-llm
# versions predating the typed-error mapping.
_NON_RETRYABLE = (LLMSchemaError, LLMAuthError, LLMConfigurationError, LLMNotAllowedError)


def _generate_one(provider, req, validate):
    """generate_validated with backoff on transient provider errors. Auth/config
    and schema failures are not retried — a re-roll can't fix them."""
    for attempt in range(len(_RETRY_BACKOFFS) + 1):
        try:
            return generate_validated(provider, req, validate, max_repairs=_MAX_REPAIRS)
        except _NON_RETRYABLE:
            raise
        except LLMError as err:
            if attempt == len(_RETRY_BACKOFFS):
                raise
            wait = _RETRY_BACKOFFS[attempt]
            print(
                f"  transient {type(err).__name__}; retry {attempt + 1}/{len(_RETRY_BACKOFFS)} in {wait}s",
                flush=True,
            )
            time.sleep(wait)


def _read_key(key_file: str | None, env_var: str) -> str:
    """Provider key from env (`env_var`, e.g. ANTHROPIC_API_KEY / GEMINI_API_KEY)
    or a gitignored file. Never echoed."""
    env_key = os.environ.get(env_var)
    if env_key:
        return env_key.strip()
    if key_file:
        p = Path(key_file)
        if p.is_file():
            return p.read_text(encoding="utf-8").strip()
    raise SystemExit(
        f"no key found — set {env_var} or pass --key-file <gitignored file>"
    )


def _topic_prompt(title: str, subtopics: list[str]) -> str:
    # Mirrors mobile buildTopicPrompt: fold subtopics into the topic so the lesson
    # stays scoped to its place in the book.
    if not subtopics:
        return title
    return f"{title} — covering: {', '.join(subtopics)}"


def _iter_units(book: dict):
    for subject in book.get("toc", {}).get("subjects", []):
        yield from subject.get("units", [])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate per-topic lesson content for a book.json")
    ap.add_argument("book", help="path to the .book.json to fill")
    ap.add_argument(
        "--provider",
        default=None,
        help="provider id (e.g. anthropic, gemini). Default: book.generationParams.provider, else anthropic",
    )
    ap.add_argument("--key-file", default=None, help="file containing the provider key (gitignored)")
    ap.add_argument("--limit", type=int, default=0, help="generate at most N topics this run (0 = all)")
    ap.add_argument(
        "--no-svg",
        action="store_true",
        help="forbid raw SVG (Mermaid-only). Use for models that loop on SVG path data, e.g. gemini-2.5-flash",
    )
    args = ap.parse_args(argv)

    book_path = Path(args.book)
    book = json.loads(book_path.read_text(encoding="utf-8"))
    params = book.get("generationParams", {})
    level = params.get("level", "professional")
    language = params.get("language", "en")
    depth = params.get("depth", "deep")
    diagram_register = params.get("diagramRegister", "technical")
    model = params.get("model")  # None → provider default (the spec's default_model)

    # Provider: CLI flag wins, else the book's saved provider, else anthropic.
    provider_id = args.provider or params.get("provider") or "anthropic"
    spec = PROVIDER_REGISTRY.get(provider_id)
    if spec is None:
        raise SystemExit(
            f"unknown provider {provider_id!r}; known: {', '.join(sorted(PROVIDER_REGISTRY))}"
        )
    api_key = _read_key(args.key_file, spec.managed_env_key or "ANTHROPIC_API_KEY")
    content: dict = book.setdefault("content", {})

    todo = [u for u in _iter_units(book) if u.get("id") and u["id"] not in content]
    if args.limit > 0:
        todo = todo[: args.limit]

    total = sum(1 for _ in _iter_units(book))
    print(f"{len(content)}/{total} topics already have content; generating {len(todo)} now")
    if not todo:
        return 0

    provider = build_provider(provider_id, api_key=api_key, model=model)
    print(f"provider: {provider_id} / {provider.model}", flush=True)

    def _validate(text: str) -> LessonOutput:
        return LessonOutput.model_validate(parse_json_response(text))

    failures: list[tuple[str, str, str]] = []
    for i, unit in enumerate(todo, 1):
        tid, title = unit["id"], unit["title"]
        print(f"[{i}/{len(todo)}] {title[:70]}", flush=True)
        prompt = build_lesson_prompt(
            topic=_topic_prompt(title, unit.get("subtopics", [])),
            level=level,
            language=language,
            depth=depth,
            target_pages=0,
            diagram_register=diagram_register,
            prior_knowledge=None,
            framing=None,
            instructions=unit.get("enhancementInstructions"),
            include_svg=not args.no_svg,
        )
        req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")
        try:
            result = _generate_one(provider, req, _validate)
        except (LLMError, ValueError) as err:  # never print the key; type only
            # One topic's exhausted retries/validation shouldn't kill the batch —
            # record it and move on. A later re-run retries only the unfilled ones.
            print(f"  giving up on this topic: {type(err).__name__}", file=sys.stderr, flush=True)
            failures.append((tid, title, type(err).__name__))
            continue
        content[tid] = {
            "topicId": tid,
            "title": title,
            "lesson": result.parsed.model_dump(),
            "generatedAt": _now(),
            "provenance": provenance(provider_id, provider.model),
        }
        book["updatedAt"] = _now()
        # Checkpoint after every topic so an interrupt loses at most one lesson.
        book_path.write_text(json.dumps(book, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"done — {len(content)}/{total} topics now have content; {len(failures)} failed this run")
    for tid, title, err in failures:
        print(f"  FAILED {tid}: {title[:50]} ({err}) — re-run to retry", file=sys.stderr)
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
