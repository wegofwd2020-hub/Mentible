// Free-form book tags (ADR-027 D7). App-only today — NOT emitted to EPUB and
// distinct from BookMetadata.subjects / dc:subject. Used for in-app organisation
// now and search/discovery when the library grows.

/** Parse a comma-separated tag string into a clean list, or undefined if empty.
 * Trims, drops blanks, de-dupes case-insensitively (keeps the first spelling). */
export function parseTags(input: string): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/** Inverse of parseTags for seeding a text input from stored tags. */
export function formatTags(tags?: string[]): string {
  return (tags ?? []).join(", ");
}
