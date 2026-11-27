import React from "react";
import { BookCover } from "@/components/BookCover";
import { sanitizeCoverSvg } from "@/reader/sanitizeCover";

// The only raster form a catalog thumbnail may take: a base64 JPEG data URI. The
// server enforces the same prefix on publish; this re-checks what we render, since
// the value comes from other users' catalog rows.
const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export function safeCoverThumb(thumb?: string | null): string | undefined {
  return thumb && JPEG_DATA_URI.test(thumb) ? thumb : undefined;
}

// Author Commons covers are server-supplied from other users — hostile input
// (ADR-028). The raster thumbnail (preferred, what the author chose) is validated
// as a JPEG data URI; the SVG fallback is sanitized. BookCover itself is unchanged
// so locally-authored covers are unaffected.
export function CommonsCover({
  title,
  coverSvg,
  coverThumb,
  size,
}: {
  title: string;
  coverSvg?: string | null;
  coverThumb?: string | null;
  size?: "thumb" | "large";
}) {
  const clean = React.useMemo(() => sanitizeCoverSvg(coverSvg), [coverSvg]);
  const thumb = React.useMemo(() => safeCoverThumb(coverThumb), [coverThumb]);
  return <BookCover title={title} size={size} coverUri={thumb} coverSvg={thumb ? undefined : clean} />;
}
