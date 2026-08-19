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

export const AUDIO_MIME_ALLOWLIST = ["audio/mpeg"] as const;
export type AllowedAudioMime = (typeof AUDIO_MIME_ALLOWLIST)[number];

const AUDIO_MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
};

// A P4 narration clip runs ~60–90s (generate_narration's bound) — well under
// 1-2 MB at typical MP3 bitrates. The cap is set larger than MAX_IMAGE_BYTES
// (10 MB) to leave real headroom for longer clips without acting as a de
// facto duration limit; it shares the book-wide MAX_MEDIA_PER_BOOK_BYTES
// budget with images (bookMediaBytes counts both).
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_PER_TOPIC = 5;

export function extForAudioMime(mime: string): string | null {
  return AUDIO_MIME_EXT[mime] ?? null;
}

export function isAllowedAudioMime(mime: string): mime is AllowedAudioMime {
  return (AUDIO_MIME_ALLOWLIST as readonly string[]).includes(mime);
}
