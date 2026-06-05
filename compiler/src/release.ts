// Release-lifecycle helpers (ADR-008). The draft/release state lives in
// book.json metadata; these derive the watermark text and the edition label the
// cover/colophon stamp, shared by the PDF and EPUB builders so the two agree.

import type { BookMetadata } from "./types";

// Watermark text for a draft (or any explicit override). Empty string = none.
export function watermarkText(m: BookMetadata | undefined): string {
  const explicit = m?.watermark?.trim();
  if (explicit) return explicit;
  return m?.status === "draft" ? "DRAFT" : "";
}

// Short edition label for the cover/colophon. "DRAFT" while drafting; otherwise
// "v1.0 · First Edition" (whichever of version/edition is present). Empty = omit.
export function editionLabel(m: BookMetadata | undefined): string {
  if (m?.status === "draft") return "DRAFT";
  const parts: string[] = [];
  if (m?.version) parts.push(`v${m.version}`);
  if (m?.edition) parts.push(m.edition);
  return parts.join(" · ");
}

export function isDraft(m: BookMetadata | undefined): boolean {
  return watermarkText(m) !== "";
}
