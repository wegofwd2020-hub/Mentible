import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// The per-book JSON value. On web it can be many MB (F1 inlines images as data:
// URIs), which overflows localStorage — so web uses IndexedDB (blob-capable),
// mirroring @/storage/epubLibrary. Native keeps AsyncStorage at the same key.
//
// Read `Platform.OS` per call (not once at module load): in a real RN-web bundle
// it's static, but Jest sets it at runtime, so a module-load capture would freeze
// the branch and let the web tests silently exercise the native path.
const isWeb = (): boolean => Platform.OS === "web";
const nativeKey = (id: string) => `sbq_book_${id}`;

// Web: a dedicated DB (NOT epubLibrary's `sbq` — avoids a version conflict).
const DB_NAME = "sbq_books";
const STORE = "books";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const r = run(db.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export async function putBookValue(id: string, json: string): Promise<void> {
  if (isWeb()) { await tx("readwrite", (s) => s.put(json, id)); return; }
  await AsyncStorage.setItem(nativeKey(id), json);
}

export async function getBookValue(id: string): Promise<string | null> {
  if (isWeb()) { return (await tx<string | undefined>("readonly", (s) => s.get(id))) ?? null; }
  return AsyncStorage.getItem(nativeKey(id));
}

export async function delBookValue(id: string): Promise<void> {
  if (isWeb()) { await tx("readwrite", (s) => s.delete(id)); return; }
  await AsyncStorage.removeItem(nativeKey(id));
}
