#!/usr/bin/env python3
"""Rebuild the lesson prompts a book's topics were generated with.

Prompts are never stored (the generation task records prompts_stored=false), so
this reconstructs them from the book's saved settings. It mirrors, step by step:

  mobile/src/hooks/useGenerateAll.ts   per-topic targets + pages split
  mobile/src/hooks/topicPrompt.ts      topic line + instructions text
  mobile/src/lib/buildGenerateRequest.ts  request fields
  backend/src/generate/tasks.py        build_lesson_prompt(...) call

Caveats:
  * This is a faithful rebuild, not a copy of what was sent. If the app or the
    prompt builder changed after generation, the output reflects today's code.
  * Only the FIRST attempt is rebuilt. Schema-repair retries add text that is
    not reconstructed here.
  * Length limits use Python code-point counts; the app uses UTF-16 units.
    They only differ for text with characters outside the Basic Multilingual Plane.

Usage (from the repo root, with the backend venv so pipeline/ imports resolve):

  backend/.venv/bin/python scripts/rebuild_generation_prompts.py BOOK.json \
      [--out DIR] [--topic SUBSTRING]

BOOK.json is a plain .book.json export (the Book object, with toc and
generationParams). Output: one .txt per topic in DIR, plus a summary on stdout.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.src.generate.prompt_builder import build_lesson_prompt  # noqa: E402

# Mirrors mobile/src/hooks/topicPrompt.ts and backend/src/generate/schemas.py.
TOPIC_MAX = 500
INSTRUCTIONS_MAX = 2000

# Mirrors DEFAULT_GENERATION_PARAMS in mobile/src/types/generationParams.ts.
DEFAULT_PARAMS = {
    "level": "student",
    "depth": "standard",
    "pages": 0,
    "language": "en",
    "diagramRegister": "balanced",
}


def subtopic_label(s) -> str:
    return s if isinstance(s, str) else s.get("label", "")


def subtopic_detail(s) -> str | None:
    return None if isinstance(s, str) else s.get("detail")


def build_topic_prompt(title: str, subtopics: list) -> str:
    if not subtopics:
        return title
    folded = f"{title} — covering: {', '.join(subtopic_label(s) for s in subtopics)}"
    return folded[:TOPIC_MAX]


def build_topic_instructions(subtopics: list, enhancement: str | None) -> str | None:
    details = []
    for s in subtopics:
        d = (subtopic_detail(s) or "").strip()
        if d:
            details.append(f"- {subtopic_label(s)}: {d}")
    parts = []
    if details:
        parts.append("Make sure to cover these subtopics:\n" + "\n".join(details))
    extra = (enhancement or "").strip()
    if extra:
        parts.append(extra)
    if not parts:
        return None
    return "\n\n".join(parts)[:INSTRUCTIONS_MAX]


def js_round(x: float) -> int:
    # JavaScript Math.round rounds halves up; Python's round() rounds to even.
    return int(math.floor(x + 0.5))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "topic"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book", type=Path, help="path to a .book.json export")
    ap.add_argument("--out", type=Path, default=Path("rebuilt-prompts"), help="output directory")
    ap.add_argument("--topic", default=None, help="only topics whose title contains this (case-insensitive)")
    args = ap.parse_args()

    book = json.loads(args.book.read_text(encoding="utf-8"))
    toc = book.get("toc") or {}
    if not toc.get("subjects"):
        print("error: no toc.subjects in this file. Is it a .book.json export?", file=sys.stderr)
        return 1

    params = {**DEFAULT_PARAMS, **(book.get("generationParams") or {})}

    # Same target rule as useGenerateAll: every unit that has an id, in TOC order.
    targets = []
    for subject in toc["subjects"]:
        for unit in subject.get("units", []):
            if unit.get("id"):
                targets.append((subject.get("subject_label", ""), unit))

    # Whole-book page target divided evenly across topics (useGenerateAll).
    per_topic_pages = (
        max(1, js_round(params["pages"] / len(targets)))
        if params["pages"] > 0 and targets
        else 0
    )

    if args.topic:
        needle = args.topic.lower()
        targets = [t for t in targets if needle in t[1].get("title", "").lower()]
    if not targets:
        print("no matching topics", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    print(f"Book: {book.get('title', '(untitled)')}")
    print(f"Settings: level={params['level']} depth={params['depth']} "
          f"pages={params['pages']} (per topic: {per_topic_pages or 'no limit'}) "
          f"diagram={params['diagramRegister']} language={params['language']}")
    print(f"Writing {len(targets)} prompt(s) to {args.out}\n")

    for index, (subject_label, unit) in enumerate(targets, start=1):
        title = unit.get("title", "")
        subtopics = unit.get("subtopics") or []
        topic = build_topic_prompt(title, subtopics)
        instructions = build_topic_instructions(subtopics, unit.get("enhancementInstructions"))
        if instructions is not None:
            instructions = instructions.strip() or None

        # Same kwargs the worker passes (generate/tasks.py). prior_knowledge and
        # framing are never sent by the app, so they stay None.
        prompt = build_lesson_prompt(
            topic=topic,
            level=params["level"],
            language=params["language"],
            depth=params["depth"],
            target_pages=per_topic_pages,
            diagram_register=params["diagramRegister"],
            prior_knowledge=None,
            framing=None,
            instructions=instructions,
        )

        header = (
            f"# {title}\n"
            f"# subject: {subject_label}\n"
            f"# unit id: {unit['id']}\n"
            f"# (reconstructed; first attempt only; see scripts/rebuild_generation_prompts.py)\n\n"
        )
        path = args.out / f"{index:02d}-{slugify(title)}.txt"
        path.write_text(header + prompt + "\n", encoding="utf-8")
        print(f"  {index:02d}. {title}  ->  {path.name}  ({len(prompt)} chars)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
