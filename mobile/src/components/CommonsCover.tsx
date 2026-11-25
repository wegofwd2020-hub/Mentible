import React from "react";
import { BookCover } from "@/components/BookCover";
import { sanitizeCoverSvg } from "@/reader/sanitizeCover";

// Author Commons covers are server-supplied SVG from other users — hostile input
// (ADR-028). This is the single place both the list row and the detail view pass
// through; BookCover itself is unchanged so locally-authored covers are unaffected.
export function CommonsCover({
  title,
  coverSvg,
  size,
}: {
  title: string;
  coverSvg?: string | null;
  size?: "thumb" | "large";
}) {
  const clean = React.useMemo(() => sanitizeCoverSvg(coverSvg), [coverSvg]);
  return <BookCover title={title} size={size} coverSvg={clean} />;
}
