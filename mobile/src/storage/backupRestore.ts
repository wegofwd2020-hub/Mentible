import AsyncStorage from "@react-native-async-storage/async-storage";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { loadBookIndex, loadBook, saveBook } from "@/storage/bookStore";
import { listEpubs, getEpubBytes, saveEpub, type EpubMeta } from "@/storage/epubLibrary";

// Settings keys carried in a backup — raw AsyncStorage values, restored wholesale.
// DELIBERATELY EXCLUDES sbq_byok_key (API key), sbq_seeded_*, sbq_usage_ledger,
// sbq_export_status, sbq_feed_entries_* (regenerable / secret / per-origin).
export const SETTINGS_KEYS = [
  "sbq_shelves", "sbq_shelf_assignments", "sbq_default_gen_params",
  "sbq_feed_sources", "sbq_open_shelves_prefs",
] as const;

export const BACKUP_FMT = "mentible-backup";

export async function buildBackup(): Promise<{ bytes: Uint8Array; filename: string; counts: { books: number; epubs: number } }> {
  const files: Record<string, Uint8Array> = {};

  const index = await loadBookIndex();
  let books = 0;
  for (const m of index) {
    const b = await loadBook(m.id);
    if (b) { files[`books/${m.id}.json`] = strToU8(JSON.stringify(b)); books++; }
  }

  const epubMetas = await listEpubs();
  const epubs: EpubMeta[] = [];
  for (const m of epubMetas) {
    const bytes = await getEpubBytes(m.id);
    if (bytes) { files[`epubs/${m.id}.epub`] = new Uint8Array(bytes); epubs.push(m); }
  }
  files["epubs/index.json"] = strToU8(JSON.stringify(epubs));

  const settings: Record<string, string> = {};
  for (const k of SETTINGS_KEYS) { const v = await AsyncStorage.getItem(k); if (v !== null) settings[k] = v; }
  files["settings.json"] = strToU8(JSON.stringify(settings));

  files["manifest.json"] = strToU8(JSON.stringify({
    _fmt: BACKUP_FMT, _v: 1, createdAt: new Date().toISOString(),
    counts: { books, epubs: epubs.length },
  }));

  const bytes = zipSync(files);
  const stamp = new Date().toISOString().slice(0, 10);
  return { bytes, filename: `mentible-backup-${stamp}.mentible-backup`, counts: { books, epubs: epubs.length } };
}

export async function restoreBackup(bytes: Uint8Array): Promise<{ books: number; epubs: number; overwritten: number; warnings: string[] }> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new Error("This file isn't a valid Mentible backup (couldn't unzip)."); }
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(entries["manifest.json"] ?? new Uint8Array())); } catch { manifest = null; }
  if (!manifest || manifest._fmt !== BACKUP_FMT) throw new Error("This file isn't a Mentible backup.");

  const warnings: string[] = [];
  let books = 0, epubs = 0, overwritten = 0;
  const existingBookIds = new Set((await loadBookIndex()).map((m) => m.id));
  const existingEpubIds = new Set((await listEpubs()).map((m) => m.id));

  // Books
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith("books/") || !name.endsWith(".json")) continue;
    try {
      const book = JSON.parse(strFromU8(data));
      if (!book || typeof book.id !== "string") { warnings.push(`Skipped ${name}: not a book.`); continue; }
      if (existingBookIds.has(book.id)) overwritten++;
      await saveBook(book);
      books++;
    } catch { warnings.push(`Skipped ${name}: unreadable.`); }
  }

  // EPUBs (from epubs/index.json + epubs/<id>.epub)
  let epubIndex: EpubMeta[] = [];
  try { epubIndex = JSON.parse(strFromU8(entries["epubs/index.json"] ?? strToU8("[]"))); } catch { epubIndex = []; }
  for (const m of epubIndex) {
    const f = entries[`epubs/${m.id}.epub`];
    if (!f) { warnings.push(`Skipped EPUB ${m.id}: bytes missing.`); continue; }
    try {
      if (existingEpubIds.has(m.id)) overwritten++;
      const buf = Uint8Array.from(f).buffer; // copy — unzipSync views may have a byteOffset
      await saveEpub({ bookId: m.id, title: m.title, bytes: buf, ...(m.coverSvg ? { coverSvg: m.coverSvg } : {}) });
      epubs++;
    } catch { warnings.push(`Skipped EPUB ${m.id}: write failed.`); }
  }

  // Settings — wholesale overwrite (backup wins)
  try {
    const settings = JSON.parse(strFromU8(entries["settings.json"] ?? strToU8("{}")));
    for (const [k, v] of Object.entries(settings)) {
      if (SETTINGS_KEYS.includes(k as any) && typeof v === "string") await AsyncStorage.setItem(k, v);
    }
  } catch { warnings.push("Settings block unreadable; shelves/prefs not restored."); }

  return { books, epubs, overwritten, warnings };
}
