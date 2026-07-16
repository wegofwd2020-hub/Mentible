import * as FileSystem from "expo-file-system";

export const MIME_ALLOWLIST = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMime = (typeof MIME_ALLOWLIST)[number];

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_TOPIC = 20;
export const MAX_MEDIA_PER_BOOK_BYTES = 100 * 1024 * 1024;

export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (MIME_ALLOWLIST as readonly string[]).includes(mime);
}

/** Device-relative media dir for a book, e.g. "media/<bookId>". */
export function mediaDirRel(bookId: string): string {
  return `media/${bookId}`;
}

/** Device-relative file path, e.g. "media/<bookId>/<id>.<ext>". */
export function mediaFileRel(bookId: string, id: string, ext: string): string {
  return `${mediaDirRel(bookId)}/${id}.${ext}`;
}

/** Absolute FS path for a device-relative ref (documentDirectory + rel). */
export function absPath(rel: string): string {
  return `${FileSystem.documentDirectory}${rel}`;
}
