// Rasterise a cover SVG to a PNG via headless Chromium (same engine as the
// diagram renderer). Used to produce a small cover thumbnail the mobile Library
// can display as the book's real cover (the EPUB itself carries the vector
// cover.svg, but the app has no on-device SVG/zip support). Heavy + optional —
// only the export path that wants a thumbnail pulls this in.

import { rasterizeToPng, rasterizeToJpeg } from "./rasterize";

// Render `svg` (a full cover SVG) to a PNG Buffer at `width` px (cover aspect
// preserved). 420px is plenty for a Library thumbnail and keeps the payload
// small. Throws if puppeteer isn't installed.
export async function renderCoverPng(svg: string, width = 420): Promise<Buffer> {
  return rasterizeToPng({ svg, width });
}

// KDP profile (D5, docs/specs/kdp-clean-export-profile.md): a raster JPEG
// cover at KDP's full recommended size — 1600×2560 matches cover.ts's own
// viewBox and KDP's ideal 1.6:1 portrait ratio. Amazon wants a raster
// cover-image, not the app's vector SVG. Throws if puppeteer isn't installed.
export async function renderCoverJpeg(svg: string, width = 1600, quality = 90): Promise<Buffer> {
  return rasterizeToJpeg({ svg, width, quality });
}
