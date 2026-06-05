import { strFromU8, unzipSync } from "fflate";

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
export function extractEpubCover(bytes: ArrayBuffer): EpubCover | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    return null;
  }
  const keys = Object.keys(files);
  const find = (path: string) => keys.find((k) => k.toLowerCase() === path.toLowerCase());

  let coverHref: string | undefined;
  let coverMime: string | undefined;

  const containerKey = find("META-INF/container.xml");
  const opfPath = containerKey
    ? /full-path="([^"]+)"/.exec(strFromU8(files[containerKey]))?.[1]
    : undefined;
  const opfKey = opfPath ? find(opfPath) : undefined;
  if (opfKey && opfPath) {
    const opf = strFromU8(files[opfKey]);
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
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
