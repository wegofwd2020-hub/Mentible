import { strFromU8 } from "fflate";
import { resolveOpf, unzipEpub } from "@/storage/epubZip";

// The cover extracted from an EPUB: a vector SVG (our compiler emits cover.svg)
// or a raster image (most third-party EPUBs). Pure JS (fflate) — no native deps.
export interface EpubCover {
  svg?: string; // vector cover markup
  raster?: ArrayBuffer; // raster cover bytes
  ext?: string; // raster extension (png/jpg/…)
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Parse an EPUB's bytes and return its cover image, or null if none is found.
// Resolves the cover via META-INF/container.xml → OPF → the cover-image item
// (properties="cover-image" or <meta name="cover">), with a filename fallback.
//
// Deliberately lenient (unlike the reader's `openEpub`): cover extraction is
// best-effort against books already in a user's library, so an unresolvable
// container.xml/OPF or a DRM'd book (whose cover is commonly left unencrypted
// for storefront thumbnails) still falls through to the filename fallback
// below, rather than yielding nothing. Only a caps violation or an unreadable
// zip yields null outright.
export function extractEpubCover(bytes: ArrayBuffer): EpubCover | null {
  let files: Record<string, Uint8Array>;
  let find: (path: string) => string | undefined;
  try {
    ({ files, find } = unzipEpub(new Uint8Array(bytes)));
  } catch {
    return null; // cover extraction is best-effort; callers expect null, not a throw
  }
  const keys = Object.keys(files);
  const resolved = resolveOpf({ files, find });

  let coverHref: string | undefined;
  let coverMime: string | undefined;

  if (resolved) {
    const { opf, opfDir } = resolved;
    let item = /<item\b[^>]*\bproperties="[^"]*\bcover-image\b[^"]*"[^>]*>/.exec(opf)?.[0];
    if (!item) {
      const coverId = /<meta\b[^>]*\bname="cover"[^>]*\bcontent="([^"]+)"/.exec(opf)?.[1];
      if (coverId) {
        item = new RegExp(`<item\\b[^>]*\\bid="${escapeReg(coverId)}"[^>]*>`).exec(opf)?.[0];
      }
    }
    if (item) {
      const href = /\bhref="([^"]+)"/.exec(item)?.[1];
      coverMime = /\bmedia-type="([^"]+)"/.exec(item)?.[1];
      if (href) coverHref = opfDir + href;
    }
  }

  // Resolve the cover file (OPF reference, else a cover.* image anywhere).
  let coverKey = coverHref ? find(coverHref) : undefined;
  if (!coverKey) coverKey = keys.find((k) => /(^|\/)cover\.(svg|png|jpe?g|webp)$/i.test(k));
  if (!coverKey) return null;

  const data = files[coverKey];
  if (/\.svg$/i.test(coverKey) || coverMime === "image/svg+xml") {
    return { svg: strFromU8(data) };
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(coverKey)?.[1] ?? "png").toLowerCase();
  return { raster: data.slice().buffer, ext };
}
