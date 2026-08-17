"""Render a CardInput JSON to a PNG via the Node compiler (`--format card`).

Mirrors export/compiler.py's subprocess discipline: nothing hits disk, and the
card's headline/subtext/source_label content is never logged.
"""

from __future__ import annotations

import asyncio
import base64
import json

from backend.config import settings
from backend.src.core.log_redaction import get_logger

log = get_logger("derivatives.render")


class CardRenderError(RuntimeError):
    """The compiler subprocess failed to render the card PNG."""


async def compile_card_png(card_input: dict) -> bytes:
    """Compile a CardInput dict (`{headline, subtext, source_label?, size}`)
    into PNG bytes via the Node compiler's `--format card` mode.

    Raises `CardRenderError` if the compiler runtime is unavailable, the
    render times out, or the subprocess exits non-zero.
    """
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "card"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise CardRenderError("compiler runtime unavailable") from exc
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=json.dumps(card_input).encode()),
            timeout=settings.export_timeout_seconds,
        )
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise CardRenderError("card render timed out") from exc
    if proc.returncode != 0:
        # Log only length/shape, never the card's headline/subtext/source_label
        # content — stderr is the compiler's own diagnostic text, not ours.
        log.error(
            "card_render_failed",
            returncode=proc.returncode,
            stderr_len=len(stderr),
        )
        raise CardRenderError("card render failed")
    return stdout


async def compile_animated_gif(card_input: dict) -> bytes:
    """Compile an AnimatedInput dict (`{headline, subtext, source_label?,
    preset, size}`) into animated GIF bytes via the Node compiler's
    `--format animated` mode.

    Raises `CardRenderError` if the compiler runtime is unavailable, the
    render times out, or the subprocess exits non-zero.
    """
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "animated"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise CardRenderError("compiler runtime unavailable") from exc
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=json.dumps(card_input).encode()),
            timeout=settings.export_timeout_seconds,
        )
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise CardRenderError("animated render timed out") from exc
    if proc.returncode != 0:
        # Log only length/shape, never the card's headline/subtext/source_label
        # content — stderr is the compiler's own diagnostic text, not ours.
        log.error(
            "animated_render_failed",
            returncode=proc.returncode,
            stderr_len=len(stderr),
        )
        raise CardRenderError("animated render failed")
    return stdout


async def compile_carousel_png(frames: list[dict]) -> list[bytes]:
    """Compile a list of CardInput dicts into PNG bytes (one per frame) via the
    Node compiler's `--format carousel` mode.

    Unlike `compile_card_png` (raw PNG bytes on stdout), the batch compiler
    emits a JSON envelope — `{"png_base64": [...]}`, one base64 string per
    frame, in the same order as `frames`. Raises `CardRenderError` if the
    compiler runtime is unavailable, the render times out, the subprocess
    exits non-zero, or stdout isn't the expected shape.
    """
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "carousel"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise CardRenderError("compiler runtime unavailable") from exc
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=json.dumps({"frames": frames}).encode()),
            timeout=settings.export_timeout_seconds,
        )
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise CardRenderError("carousel render timed out") from exc
    if proc.returncode != 0:
        # Log only length/shape, never the frames' headline/subtext/source_label
        # content — stderr is the compiler's own diagnostic text, not ours.
        log.error(
            "carousel_render_failed",
            returncode=proc.returncode,
            stderr_len=len(stderr),
        )
        raise CardRenderError("carousel render failed")
    try:
        payload = json.loads(stdout)
        pngs = [base64.b64decode(s) for s in payload["png_base64"]]
    except (ValueError, KeyError, TypeError) as exc:
        log.error("carousel_render_bad_output")
        raise CardRenderError("carousel render produced bad output") from exc
    if len(pngs) != len(frames):
        # Never let a frame-count mismatch reach the router's zip(strict=True)
        # as an uncaught ValueError — fold it into the CardRenderError->502 path.
        log.error("carousel_render_count_mismatch", sent=len(frames), got=len(pngs))
        raise CardRenderError("carousel render returned the wrong number of frames")
    return pngs
