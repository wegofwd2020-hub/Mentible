import { strFromU8, unzipSync } from "fflate";

// The EPUB container primitive, shared by the cover extractor and the reader.
//
// This logic used to live inside `extractEpubCover`. It is factored out rather
// than duplicated so the two can never disagree about what a book's OPF says —
// the same rule the reader applies to sanitizers and renderers.
//
// Pure and DOM-free: runs on Hermes and on web.

export class EpubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubError";
  }
}

export const MAX_ZIP_ENTRIES = 5000;
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

export interface UnzippedEpub {
  files: Record<string, Uint8Array>;
  find: (path: string) => string | undefined;
}

export interface EpubZip extends UnzippedEpub {
  opf: string;
  opfPath: string;
  opfDir: string;
}

/**
 * Unzip an EPUB's bytes, enforcing the entry-count and inflated-size caps
 * (ADR-028: an EPUB is hostile input).
 *
 * The caps are enforced from inside fflate's `unzipSync` `filter` callback,
 * NOT by summing `Object.values(files).byteLength` after the fact. fflate's
 * central-directory loop calls `filter({ name, size, originalSize, ... })`
 * for each entry using ONLY the zip's declared metadata, and only inflates
 * that entry afterwards if the filter returns true — so throwing inside the
 * filter aborts before that entry (or any entry after it) is ever inflated.
 * A post-hoc sum of decoded byte lengths runs too late: fflate has already
 * called `inflateSync(..., { out: new Uint8Array(declaredOriginalSize) })`
 * for every entry by the time such a loop could look at the result, so a
 * bomb entry (or one whose header simply lies about its size) has already
 * forced a large allocation — and if the real decoded output is small, the
 * post-hoc sum wouldn't even notice, since it only sees the small decoded
 * length, not the size fflate had to provision for.
 */
export function unzipEpub(bytes: Uint8Array): UnzippedEpub {
  let entryCount = 0;
  let inflated = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        entryCount++;
        if (entryCount > MAX_ZIP_ENTRIES) {
          throw new EpubError(`This EPUB has too many files (over ${MAX_ZIP_ENTRIES}).`);
        }
        inflated += entry.originalSize;
        if (inflated > MAX_INFLATED_BYTES) {
          throw new EpubError("This EPUB is too large to open.");
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof EpubError) throw e;
    throw new EpubError("This file isn't a readable EPUB.");
  }

  const keys = Object.keys(files);
  const find = (path: string) => keys.find((k) => k.toLowerCase() === path.toLowerCase());
  return { files, find };
}

/**
 * Resolve an EPUB's OPF via META-INF/container.xml → the package file it
 * names. LENIENT: returns null (never throws) when the container or OPF
 * can't be resolved, so lenient callers (the cover extractor's filename
 * fallback) can still do something useful with a malformed book.
 */
export function resolveOpf(
  zip: UnzippedEpub,
): { opf: string; opfPath: string; opfDir: string } | null {
  const { files, find } = zip;
  const containerKey = find("META-INF/container.xml");
  if (!containerKey) return null;
  const opfPath = /full-path="([^"]+)"/.exec(strFromU8(files[containerKey]))?.[1];
  if (!opfPath) return null;
  const opfKey = find(opfPath);
  if (!opfKey) return null;
  return {
    opf: strFromU8(files[opfKey]),
    opfPath,
    opfDir: opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "",
  };
}

/**
 * The strict reader path: unzip + caps, resolve the OPF, and refuse DRM.
 * Throws `EpubError` on anything it can't safely open — a missing/unresolvable
 * container.xml or OPF, or a copy-protected book. Used by the reader, which
 * must not silently show a mangled or DRM'd book.
 *
 * `extractEpubCover` deliberately does NOT use this function — it is lenient
 * where this is strict (see `unzipEpub`/`resolveOpf` docs above).
 */
export function openEpub(bytes: Uint8Array): EpubZip {
  const zip = unzipEpub(bytes);

  // Refuse DRM rather than rendering garbage (spec: "detected and refused
  // with a clear message").
  if (zip.find("META-INF/encryption.xml")) {
    throw new EpubError("This book is copy-protected (DRM), so it can't be opened here.");
  }

  const resolved = resolveOpf(zip);
  if (!resolved) throw new EpubError("This EPUB is missing META-INF/container.xml.");

  return { ...zip, ...resolved };
}
