import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { Book, GeneratedTopic, TopicImage } from "@/types/book";
import { ImportError, parseBook } from "@/storage/importBook";
import { pruneOrphanMedia } from "@/storage/mediaStore";
import { fromBase64 } from "@/storage/pickBookFile";
import { toBase64 } from "@/storage/epubLibrary";
import { randomUUID } from "@/lib/uuid";
import {
  absPath,
  extForMime,
  isAllowedMime,
  mediaDirRel,
  mediaFileRel,
  MAX_IMAGE_BYTES,
} from "@/storage/mediaPaths";

// A book's exportable/importable "bundle": book.json plus every still-referenced
// media file, zipped with fflate. Only needed once a book has attached images —
// an image-less book stays on the plain .book.json text path (see
// ExportBookJsonButton.tsx). Import always assigns a fresh book id so a bundle
// can be re-imported (or shared) without colliding with the original on-device
// copy — this mirrors importBook()'s "distinct copy" behaviour for JSON imports
// of a book that still carries its original id, but here it's unconditional
// because the bundle also lays down new on-device media files that must live
// under the new id's media/<id>/ directory (mediaStore's dir-per-book model).

const SAVE_FORMAT: Record<string, ImageManipulator.SaveFormat> = {
  "image/jpeg": ImageManipulator.SaveFormat.JPEG,
  "image/png": ImageManipulator.SaveFormat.PNG,
  "image/webp": ImageManipulator.SaveFormat.WEBP,
};

function u8ToBase64(data: Uint8Array): string {
  // Slice to a fresh, zero-offset buffer before handing to the ArrayBuffer-typed
  // encoder — a Uint8Array view (as produced by unzipSync) may not start at
  // byte 0 of its underlying buffer.
  const copy = data.slice();
  return toBase64(copy.buffer);
}

function basenameOf(rel: string): string {
  return rel.split("/").pop()!;
}

/**
 * Build a zip bundle (`book.json` + `media/<basename>` per referenced image)
 * for the given book. Orphaned media (files no longer referenced by any topic)
 * is pruned first. A media ref whose on-disk file can't be read is silently
 * dropped from the exported copy rather than bundling a dangling reference.
 */
export async function exportBookBundle(book: Book): Promise<Uint8Array> {
  await pruneOrphanMedia(book);

  const mediaFiles: Record<string, Uint8Array> = {};
  const nextContent: Record<string, GeneratedTopic> = {};

  for (const [topicId, gen] of Object.entries(book.content ?? {})) {
    const images = gen.images ?? [];
    if (images.length === 0) {
      nextContent[topicId] = gen;
      continue;
    }
    const nextImages: TopicImage[] = [];
    for (const img of images) {
      const basename = basenameOf(img.file);
      const entryKey = `media/${basename}`;
      try {
        const b64 = await FileSystem.readAsStringAsync(absPath(img.file), {
          encoding: FileSystem.EncodingType.Base64,
        });
        mediaFiles[entryKey] = new Uint8Array(fromBase64(b64));
        nextImages.push({ ...img, file: entryKey });
      } catch {
        // File missing on disk — drop the ref rather than bundle a dangling one,
        // but warn so an export losing an image isn't silent (symmetric with
        // the collected warnings on import, below).
        console.warn(`[bookBundle] could not read media file for image ${img.id} (${img.file}); dropped from export.`);
      }
    }
    nextContent[topicId] = { ...gen, images: nextImages };
  }

  const bookCopy: Book = { ...book, content: nextContent };
  const json = JSON.stringify(bookCopy, null, 2);
  return zipSync({ "book.json": strToU8(json), ...mediaFiles });
}

// Re-strip EXIF from imported bytes (defence in depth — the exporting device
// already stripped it, but we don't trust bundles from elsewhere) and land the
// file under the new book id's media dir. Mirrors mediaStore.attachImage's
// pipeline, but starting from raw bytes instead of a picked file uri.
async function writeImportedMedia(
  newBookId: string,
  imageId: string,
  ext: string,
  mime: string,
  data: Uint8Array,
): Promise<string> {
  const tmpUri = `${FileSystem.cacheDirectory}bundle-import-${imageId}.${ext}`;
  await FileSystem.writeAsStringAsync(tmpUri, u8ToBase64(data), {
    encoding: FileSystem.EncodingType.Base64,
  });
  const stripped = await ImageManipulator.manipulateAsync(tmpUri, [], {
    compress: 0.9,
    format: SAVE_FORMAT[mime],
  });
  const rel = mediaFileRel(newBookId, imageId, ext);
  await FileSystem.makeDirectoryAsync(absPath(mediaDirRel(newBookId)), { intermediates: true });
  await FileSystem.copyAsync({ from: stripped.uri, to: absPath(rel) });
  await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  return rel;
}

/**
 * Parse a `.book.zip` bundle back into a `Book`: validates + structurally
 * parses `book.json` (via `parseBook`), assigns it a FRESH id (so re-importing
 * a bundle never collides with the original on-device copy), then restores
 * each referenced media file — re-stripping EXIF — under the new id's media
 * dir. A ref whose bundled file is absent, structurally malformed, disallowed,
 * or oversize is dropped (with a collected warning) rather than left dangling
 * or aborting the whole import.
 */
export async function parseBookBundle(bytes: Uint8Array): Promise<Book> {
  const entries = unzipSync(bytes);
  const bookEntry = entries["book.json"];
  if (!bookEntry) {
    throw new ImportError("This bundle is missing book.json.");
  }
  const parsed = parseBook(strFromU8(bookEntry));
  const newId = randomUUID();
  const warnings: string[] = [];
  const nextContent: Record<string, GeneratedTopic> = {};

  for (const [topicId, gen] of Object.entries(parsed.content ?? {})) {
    const images = gen.images ?? [];
    if (images.length === 0) {
      nextContent[topicId] = gen;
      continue;
    }
    const nextImages: TopicImage[] = [];
    for (const img of images) {
      // parseBook does not deep-validate content[topicId].images[] — this bundle
      // came from parseBook's structural-only pass, so `img` may not actually be
      // a well-formed TopicImage. Guard before touching img.file (basenameOf
      // calls .split on it): a missing/non-string file must be dropped with a
      // warning like any other bad ref, never thrown — a single malformed image
      // entry must not abort the whole import.
      if (!img || typeof img !== "object" || typeof img.file !== "string" || img.file.length === 0) {
        const label = img && typeof (img as { id?: unknown }).id === "string" ? (img as { id: string }).id : "?";
        warnings.push(`Image ${label} has a missing/invalid file path; dropped.`);
        continue;
      }
      const entryKey = `media/${basenameOf(img.file)}`;
      const data = entries[entryKey];
      if (!data) {
        warnings.push(`Missing media file for image ${img.id} (${entryKey}); dropped.`);
        continue;
      }
      if (!isAllowedMime(img.mime)) {
        warnings.push(`Disallowed mime "${img.mime}" for image ${img.id}; dropped.`);
        continue;
      }
      if (data.byteLength > MAX_IMAGE_BYTES) {
        warnings.push(`Image ${img.id} exceeds the size limit; dropped.`);
        continue;
      }
      const ext = extForMime(img.mime);
      if (!ext) {
        warnings.push(`No file extension for mime "${img.mime}" (image ${img.id}); dropped.`);
        continue;
      }
      // The incoming img.id is attacker-controlled (parseBook is structural-only,
      // so it never validated this bundle's contents) and must never reach the
      // on-disk filename — a crafted id like "../../../../evil" would otherwise
      // let copyAsync write outside media/<newId>/. Import already reassigns the
      // book's own identity (newId, above); do the same per-image by minting a
      // fresh, generator-controlled id and using it for BOTH the filename and the
      // image's id in the resulting schema. This also sidesteps object-prototype
      // key hazards further downstream (e.g. "__proto__" as a lookup key).
      const freshImageId = randomUUID();
      try {
        const rel = await writeImportedMedia(newId, freshImageId, ext, img.mime, data);
        nextImages.push({ ...img, id: freshImageId, file: rel });
      } catch {
        warnings.push(`Failed to write image ${img.id}; dropped.`);
      }
    }
    nextContent[topicId] = { ...gen, images: nextImages };
  }

  if (warnings.length > 0) {
    // Collected rather than thrown — a partial import (book intact, minus a
    // few bad media refs) is more useful than failing the whole import.
    console.warn(`[bookBundle] dropped ${warnings.length} media ref(s) on import:\n${warnings.join("\n")}`);
  }

  return { ...parsed, id: newId, content: nextContent };
}
