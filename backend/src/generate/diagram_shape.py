"""Post-generation diagram shape check.

The model draws most diagrams as Mermaid flowcharts, even when the content has
no order (a hub with partners, a list of layers). The prompt asks for a mindmap
in those cases, but the model does not reliably follow it.

This pass runs on a validated lesson. It rewrites a ```mermaid flowchart as a
native mindmap when it has no decision diamonds, subgraphs or inline edge
labels and it branches (it is not a straight chain). Merged arrows are resolved
to a spanning tree, so some relationships are dropped. Straight chains, decisions and anything it cannot parse are left unchanged.
"""

from __future__ import annotations

import re
from itertools import pairwise
from typing import Any

_FENCE = re.compile(r"```mermaid[ \t]*\n(.*?)```", re.DOTALL)
# Arrow tokens, with an optional |label| after the arrow. No capture groups.
_ARROW = re.compile(r"\s*(?:-\.->|-->|==>|---)\s*(?:\|[^|]*\|\s*)?")
_SHAPE = re.compile(r"\[\"(.*)\"\]|\[(.*)\]|\(\((.*)\)\)|\((.*)\)")
_ID = re.compile(r"[A-Za-z_][\w-]*")
_CLASS_SUFFIX = re.compile(r":::[\w-]+\s*$")


class _Unsupported(Exception):
    """The diagram uses syntax this pass does not convert."""


def _clean(label: str) -> str:
    """Make a label safe inside a mindmap node: no brackets, quotes or breaks."""
    text = re.sub(r"<br\s*/?>", " - ", label)
    text = re.sub(r"[\"\[\]\(\)\{\}]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _node(part: str, labels: dict[str, str], order: list[str]) -> str:
    part = _CLASS_SUFFIX.sub("", part.strip()).strip()
    match = _ID.match(part)
    if not match:
        raise _Unsupported
    node_id = match.group(0)
    rest = part[len(node_id) :].strip()
    label = node_id
    if rest:
        if rest.startswith("{"):
            raise _Unsupported  # decision diamond
        shape = _SHAPE.fullmatch(rest)
        if not shape:
            raise _Unsupported
        label = next(g for g in shape.groups() if g is not None)
    label = _clean(label) or node_id
    if node_id not in labels:
        labels[node_id] = label
        order.append(node_id)
    return node_id


def _parse(source: str) -> tuple[dict[str, str], list[str], list[tuple[str, str]]]:
    lines = [line.strip() for line in source.strip().splitlines()]
    if not lines or not re.match(r"(flowchart|graph)\b", lines[0]):
        raise _Unsupported
    labels: dict[str, str] = {}
    order: list[str] = []
    edges: list[tuple[str, str]] = []
    for raw in lines[1:]:
        if not raw or raw.startswith("%%"):
            continue
        if re.match(r"(classDef|class|style|linkStyle)\b", raw):
            continue  # styling only; no effect on structure
        if re.match(r"(subgraph|end|direction)\b", raw):
            raise _Unsupported
        parts = _ARROW.split(raw)
        if len(parts) == 1:
            _node(raw, labels, order)  # a standalone node declaration
            continue
        ids = [_node(p, labels, order) for p in parts]
        edges.extend(pairwise(ids))
    return labels, order, edges


def _reach(start: str, children: dict[str, list[str]]) -> set[str]:
    seen = {start}
    stack = [start]
    while stack:
        for child in children[stack.pop()]:
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def mindmap_for(source: str) -> str | None:
    """Return a mindmap for a flowchart with no decisions, or None to leave it alone.

    Merged arrows are resolved to a spanning tree: each node keeps its first
    incoming edge, so some relationships are dropped. Nodes not reachable from
    the chosen root are attached to the root as extra branches.
    """
    try:
        labels, order, edges = _parse(source)
    except _Unsupported:
        return None
    if len(order) < 4 or not edges:
        return None

    children: dict[str, list[str]] = {n: [] for n in order}
    indegree = dict.fromkeys(order, 0)
    for parent, child in edges:
        children[parent].append(child)
        indegree[child] += 1

    if max(len(children[n]) for n in order) < 2:
        return None  # a straight chain is an ordered process

    # Root: prefer nodes with no incoming arrows, then the one reaching the most nodes.
    root = max(order, key=lambda n: (indegree[n] == 0, len(_reach(n, children))))

    tree: dict[str, list[str]] = {n: [] for n in order}
    placed = {root}
    queue = [root]
    while queue:
        node = queue.pop(0)
        for child in children[node]:
            if child not in placed:
                placed.add(child)
                tree[node].append(child)
                queue.append(child)
    for node in order:  # unreachable from the root: attach as extra branches
        if node not in placed:
            placed.add(node)
            tree[root].append(node)
            queue = [node]
            while queue:
                current = queue.pop(0)
                for child in children[current]:
                    if child not in placed:
                        placed.add(child)
                        tree[current].append(child)
                        queue.append(child)

    out = ["mindmap", f"  root(({labels[root]}))"]

    def walk(node: str, indent: int) -> None:
        for child in tree[node]:
            out.append(" " * indent + f'{child}["{labels[child]}"]')
            walk(child, indent + 2)

    walk(root, 4)
    return "\n".join(out)


def rewrite_markdown(markdown: str) -> tuple[str, int]:
    """Rewrite each convertible mermaid fence in a markdown body. Returns (text, count)."""
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        new = mindmap_for(match.group(1))
        if new is None:
            return match.group(0)
        count += 1
        return f"```mermaid\n{new}\n```"

    return _FENCE.sub(replace, markdown), count


def _shape_model(model: Any, body_key: str) -> tuple[Any, int]:
    """Rewrite convertible mermaid fences in each section's `body_key` text."""
    data = model.model_dump()
    total = 0
    for section in data.get("sections", []):
        body = section.get(body_key)
        if isinstance(body, str) and "```mermaid" in body:
            section[body_key], changed = rewrite_markdown(body)
            total += changed
    if total == 0:
        return model, 0
    return type(model).model_validate(data), total


def shape_lesson(lesson: Any) -> tuple[Any, int]:
    """Rewrite convertible flowcharts in a lesson's `body_markdown` sections.

    Returns (lesson, count). The lesson is re-validated only when something changed,
    so an unchanged lesson is returned as the same object.
    """
    return _shape_model(lesson, "body_markdown")


def shape_topic_draft(draft: Any) -> tuple[Any, int]:
    """Same as shape_lesson, for trust topic drafts (sections use `body`)."""
    return _shape_model(draft, "body")
