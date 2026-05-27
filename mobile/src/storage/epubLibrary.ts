import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";

// Local library of compiled EPUB3 books — the authoring app's "finished shelf".
// EPUBs are multi-MB binaries, so AsyncStorage/localStorage won't do:
//   web    → IndexedDB (blob-capable)
//   native → a file per book in documentDirectory/epubs/ + a small index in
//            AsyncStorage (metadata only).
// One book id maps to one library entry (re-saving replaces it), so the shelf
// tracks the latest compiled artifact per book.

export interface EpubMeta {
  id: string; // == source book id (one entry per book)
  title: string;
  sizeBytes: number;
  compiledAt: string; // ISO
}

export interface SaveEpubInput {
  bookId: string;
  title: string;
  bytes: ArrayBuffer;
}

const isWeb = Platform.OS === "web";

// ── public API (delegates to the platform impl) ──────────────────────────────
export function saveEpub(input: SaveEpubInput): Promise<EpubMeta> {
  return isWeb ? webSave(input) : nativeSave(input);
}
export function listEpubs(): Promise<EpubMeta[]> {
  return isWeb ? webList() : nativeList();
}
export function deleteEpub(id: string): Promise<void> {
  return isWeb ? webDelete(id) : nativeDelete(id);
}
/** Open the EPUB: a browser download on web, a share sheet on native. */
export function openEpub(id: string, title: string): Promise<void> {
  return isWeb ? webOpen(id, title) : nativeOpen(id);
}

function epubFilename(title: string): string {
  const slug = title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${slug.slice(0, 60) || "book"}.epub`;
}

// Deliver freshly-fetched artifact bytes (e.g. an on-demand PDF) to the user:
// a browser download on web; a saved file on native (returns the path).
export async function downloadArtifact(
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<{ savedPath?: string }> {
  if (isWeb) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return {};
  }
  const path = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, toBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { savedPath: path };
}

// ── web: IndexedDB ────────────────────────────────────────────────────────────
const DB_NAME = "sbq";
const STORE = "epubs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

interface WebRecord extends EpubMeta {
  blob: Blob;
}

async function webSave({ bookId, title, bytes }: SaveEpubInput): Promise<EpubMeta> {
  const meta: EpubMeta = {
    id: bookId,
    title,
    sizeBytes: bytes.byteLength,
    compiledAt: new Date().toISOString(),
  };
  const blob = new Blob([bytes], { type: "application/epub+zip" });
  await tx("readwrite", (s) => s.put({ ...meta, blob } satisfies WebRecord));
  return meta;
}

async function webList(): Promise<EpubMeta[]> {
  const records = (await tx<WebRecord[]>("readonly", (s) => s.getAll())) ?? [];
  return records
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => b.compiledAt.localeCompare(a.compiledAt));
}

async function webDelete(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

async function webOpen(id: string, title: string): Promise<void> {
  const record = await tx<WebRecord | undefined>("readonly", (s) => s.get(id));
  if (!record) throw new Error("EPUB not found in library.");
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = epubFilename(title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── native: expo-file-system + AsyncStorage index ────────────────────────────
const INDEX_KEY = "sbq_epub_index";
const epubDir = () => `${FileSystem.documentDirectory}epubs/`;
const epubPath = (id: string) => `${epubDir()}${id}.epub`;

async function ensureDir(): Promise<void> {
  const dir = epubDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

async function readIndex(): Promise<EpubMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as EpubMeta[];
  } catch {
    return [];
  }
}

async function writeIndex(index: EpubMeta[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

// Minimal ArrayBuffer → base64 (Hermes has no Buffer/btoa); expo-file-system
// writes binary only via a base64 string.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

async function nativeSave({ bookId, title, bytes }: SaveEpubInput): Promise<EpubMeta> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(epubPath(bookId), toBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  const meta: EpubMeta = {
    id: bookId,
    title,
    sizeBytes: bytes.byteLength,
    compiledAt: new Date().toISOString(),
  };
  const index = (await readIndex()).filter((m) => m.id !== bookId);
  await writeIndex([meta, ...index]);
  return meta;
}

async function nativeList(): Promise<EpubMeta[]> {
  return (await readIndex()).sort((a, b) => b.compiledAt.localeCompare(a.compiledAt));
}

async function nativeDelete(id: string): Promise<void> {
  await FileSystem.deleteAsync(epubPath(id), { idempotent: true });
  await writeIndex((await readIndex()).filter((m) => m.id !== id));
}

async function nativeOpen(id: string): Promise<void> {
  // The EPUB is saved on device; sharing it to a reader app comes with the
  // reader integration (would use expo-sharing). For now, surface its location.
  throw new Error(`Saved on device at ${epubPath(id)} — opening in a reader is coming soon.`);
}
