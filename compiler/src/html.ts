// Tiny HTML helpers shared by the render core. Pure string functions — no DOM.

/** Escape text for safe inclusion in element content / attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render an array of strings as escaped <li> items (no wrapping <ul>). */
export function li(items: readonly string[] | null | undefined): string {
  return (items ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
}

function normalizeHeading(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The model frequently repeats a section's heading as a leading "## Heading"
 * line inside body_markdown. Since the renderer already emits the heading from
 * the `heading` field, that leading line renders as a duplicate. Strip it when
 * it matches the section heading; leave the body untouched otherwise.
 */
export function stripDuplicateHeading(body: string, heading: string): string {
  const text = body ?? "";
  const m = text.match(/^\s*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (m && normalizeHeading(m[1]) === normalizeHeading(heading)) {
    return text.slice(m[0].length);
  }
  return text;
}
