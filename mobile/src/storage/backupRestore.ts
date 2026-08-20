import AsyncStorage from "@react-native-async-storage/async-storage";
import { zipSync, strToU8 } from "fflate";
import { loadBookIndex, loadBook } from "@/storage/bookStore";
import { listEpubs, getEpubBytes, type EpubMeta } from "@/storage/epubLibrary";

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
