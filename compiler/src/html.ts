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
