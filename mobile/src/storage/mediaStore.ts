import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { Book, GeneratedTopic, TopicAudio, TopicImage } from "@/types/book";
import { randomUUID } from "@/lib/uuid";
import {
  absPath, extForMime, extForAudioMime, isAllowedMime, isAllowedAudioMime,
  mediaDirRel, mediaFileRel,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC, MAX_MEDIA_PER_BOOK_BYTES,
  MAX_AUDIO_BYTES, MAX_AUDIO_PER_TOPIC,
} from "@/storage/mediaPaths";

export type PickedImage = {
  uri: string; mime: string; width?: number; height?: number; fileSize?: number;
};

export type PickedAudio = { uri: string; mime: string; fileSize?: number };

export interface AttachAudioMeta {
  title?: string;
  transcript?: string;
  durationMs?: number;
}

export class MediaCapError extends Error {}

const SAVE_FORMAT: Record<string, ImageManipulator.SaveFormat> = {
  "image/jpeg": ImageManipulator.SaveFormat.JPEG,
  "image/png": ImageManipulator.SaveFormat.PNG,
  "image/webp": ImageManipulator.SaveFormat.WEBP,
};

function topicImages(book: Book, topicId: string): TopicImage[] {
  return book.content?.[topicId]?.images ?? [];
}

function topicAudio(book: Book, topicId: string): TopicAudio[] {
  return book.content?.[topicId]?.audio ?? [];
}

async function bookMediaBytes(book: Book): Promise<number> {
  let total = 0;
  for (const gen of Object.values(book.content ?? {})) {
    for (const img of gen.images ?? []) {
      const info = await FileSystem.getInfoAsync(absPath(img.file));
      if (info.exists && typeof info.size === "number") total += info.size;
    }
    for (const aud of gen.audio ?? []) {
      const info = await FileSystem.getInfoAsync(absPath(aud.file));
      if (info.exists && typeof info.size === "number") total += info.size;
    }
  }
  return total;
}

/** Copy a picked image into the book's media dir, stripping EXIF, and append a ref. */
export async function attachImage(book: Book, topicId: string, src: PickedImage): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen) throw new MediaCapError("Add content to this topic before attaching a figure.");
  if (!isAllowedMime(src.mime)) throw new MediaCapError("Only JPEG, PNG or WebP images are supported.");
  if (topicImages(book, topicId).length >= MAX_IMAGES_PER_TOPIC) {
    throw new MediaCapError(`A topic can hold at most ${MAX_IMAGES_PER_TOPIC} figures.`);
  }
  // Cheap early-out: a known-oversize source can be rejected before the (costly)
  // EXIF strip. Not authoritative — `fileSize` is optional and may be absent
  // (e.g. expo-image-picker) — the real cap enforcement is below, against the
  // stripped file's actual on-disk size.
  if (typeof src.fileSize === "number" && src.fileSize > MAX_IMAGE_BYTES) {
    throw new MediaCapError("That image is too large (max 10 MB).");
  }

  // Re-encode to strip EXIF (incl. GPS). No transform ops = format/quality pass only.
  const stripped = await ImageManipulator.manipulateAsync(src.uri, [], {
    compress: 0.9,
    format: SAVE_FORMAT[src.mime],
  });

  // Enforce the size caps against the REAL on-disk size of the stripped file —
  // `src.fileSize` is optional and may be absent, so it must never be the sole
  // gate (that would let an oversize image bypass both caps).
  const info = await FileSystem.getInfoAsync(stripped.uri);
  const bytes = info.exists && typeof info.size === "number" ? info.size : (src.fileSize ?? 0);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new MediaCapError("That image is too large (max 10 MB).");
  }
  if ((await bookMediaBytes(book)) + bytes > MAX_MEDIA_PER_BOOK_BYTES) {
    throw new MediaCapError("This book has reached its image storage limit.");
  }

  const ext = extForMime(src.mime)!;
  const id = randomUUID();
  const rel = mediaFileRel(book.id, id, ext);
  await FileSystem.makeDirectoryAsync(absPath(mediaDirRel(book.id)), { intermediates: true });
  await FileSystem.copyAsync({ from: stripped.uri, to: absPath(rel) });

  const image: TopicImage = {
    id, file: rel, mime: src.mime, width: stripped.width, height: stripped.height,
    addedAt: new Date().toISOString(),
  };
  const nextGen: GeneratedTopic = { ...gen, images: [...(gen.images ?? []), image] };
  return { ...book, content: { ...book.content, [topicId]: nextGen }, updatedAt: new Date().toISOString() };
}

/**
 * Copy a generated/picked audio clip into the book's media dir and append a
 * ref. Mirrors attachImage's cap-and-copy shape, minus the EXIF-strip step
 * (N/A for audio — the file is copied byte-for-byte).
 */
export async function attachAudio(
  book: Book,
  topicId: string,
  src: PickedAudio,
  meta: AttachAudioMeta = {},
): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen) throw new MediaCapError("Add content to this topic before attaching narration.");
  if (!isAllowedAudioMime(src.mime)) throw new MediaCapError("Only MP3 audio is supported.");
  if (topicAudio(book, topicId).length >= MAX_AUDIO_PER_TOPIC) {
    throw new MediaCapError(`A topic can hold at most ${MAX_AUDIO_PER_TOPIC} narration clips.`);
  }
  // Cheap early-out on a known-oversize source; the real cap enforcement below
  // is against the file's actual on-disk size (fileSize is optional/may lie).
  if (typeof src.fileSize === "number" && src.fileSize > MAX_AUDIO_BYTES) {
    throw new MediaCapError("That audio clip is too large (max 15 MB).");
  }

  const info = await FileSystem.getInfoAsync(src.uri);
  const bytes = info.exists && typeof info.size === "number" ? info.size : (src.fileSize ?? 0);
  if (bytes > MAX_AUDIO_BYTES) {
    throw new MediaCapError("That audio clip is too large (max 15 MB).");
  }
  if ((await bookMediaBytes(book)) + bytes > MAX_MEDIA_PER_BOOK_BYTES) {
    throw new MediaCapError("This book has reached its media storage limit.");
  }

  const ext = extForAudioMime(src.mime)!;
  const id = randomUUID();
  const rel = mediaFileRel(book.id, id, ext);
  await FileSystem.makeDirectoryAsync(absPath(mediaDirRel(book.id)), { intermediates: true });
  await FileSystem.copyAsync({ from: src.uri, to: absPath(rel) });

  const audio: TopicAudio = {
    id, file: rel, mime: src.mime,
    title: meta.title, transcript: meta.transcript, durationMs: meta.durationMs,
  };
  const nextGen: GeneratedTopic = { ...gen, audio: [...(gen.audio ?? []), audio] };
  return { ...book, content: { ...book.content, [topicId]: nextGen }, updatedAt: new Date().toISOString() };
}

export async function deleteImage(book: Book, topicId: string, imageId: string): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen?.images) return book;
  const img = gen.images.find((i) => i.id === imageId);
  const nextGen: GeneratedTopic = { ...gen, images: gen.images.filter((i) => i.id !== imageId) };
  const next = { ...book, content: { ...book.content, [topicId]: nextGen }, updatedAt: new Date().toISOString() };
  if (img) await FileSystem.deleteAsync(absPath(img.file), { idempotent: true }).catch(() => {});
  return next;
}

/** Read each of a topic's images into a data: URL keyed by image id. */
export async function resolveFigureDataUrls(topic: GeneratedTopic): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const img of topic.images ?? []) {
    try {
      const b64 = await FileSystem.readAsStringAsync(absPath(img.file), {
        encoding: FileSystem.EncodingType.Base64,
      });
      out.set(img.id, `data:${img.mime};base64,${b64}`);
    } catch {
      // Missing file → skip (renderer omits that figure).
    }
  }
  return out;
}

/** Read each of a topic's audio clips into a data: URL keyed by audio id (for the compile payload). */
export async function resolveAudioDataUrls(topic: GeneratedTopic): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const aud of topic.audio ?? []) {
    try {
      const b64 = await FileSystem.readAsStringAsync(absPath(aud.file), {
        encoding: FileSystem.EncodingType.Base64,
      });
      out.set(aud.id, `data:${aud.mime};base64,${b64}`);
    } catch {
      // Missing file → skip (compile payload omits that clip).
    }
  }
  return out;
}

/**
 * Resolve each of a topic's audio clips to an absolute file:// URI keyed by
 * audio id, for native playback. Not consumed until rung 3 (the WebView-
 * external expo-audio player) — provided now so that surface has no schema
 * work left to do when it lands.
 */
export async function resolveAudioFileUris(topic: GeneratedTopic): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const aud of topic.audio ?? []) {
    const abs = absPath(aud.file);
    const info = await FileSystem.getInfoAsync(abs);
    if (info.exists) out.set(aud.id, abs);
  }
  return out;
}

/** Delete any file under media/<bookId>/ not referenced by a surviving ref. */
export async function pruneOrphanMedia(book: Book): Promise<void> {
  const dir = absPath(mediaDirRel(book.id));
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const referenced = new Set<string>();
  for (const gen of Object.values(book.content ?? {})) {
    for (const img of gen.images ?? []) referenced.add(img.file.split("/").pop()!);
    for (const aud of gen.audio ?? []) referenced.add(aud.file.split("/").pop()!);
  }
  const names = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(
    names.filter((n) => !referenced.has(n)).map((n) =>
      FileSystem.deleteAsync(`${dir}/${n}`, { idempotent: true }).catch(() => {}),
    ),
  );
}

// Deletes the whole media/<bookId>/ dir — already audio-inclusive by
// construction (attachAudio writes into the same directory attachImage does).
export async function deleteBookMedia(bookId: string): Promise<void> {
  await FileSystem.deleteAsync(absPath(mediaDirRel(bookId)), { idempotent: true }).catch(() => {});
}
