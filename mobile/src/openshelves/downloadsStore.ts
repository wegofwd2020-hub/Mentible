// Device-local index of downloaded entries (spec P0-10). Metadata only — the
// bytes live on disk at `path`. Per-device, never synced. Mirrors the house
// AsyncStorage index pattern (feedSourcesStore / shelfStore).
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface DownloadRecord {
  entryId: string;
  sourceId: string;
  title: string;
  path: string;
  mimeType: string;
  bytes: number;
  downloadedAt: string;
}

const KEY = "sbq_open_shelves_downloads";

export async function listDownloads(): Promise<DownloadRecord[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DownloadRecord[]) : [];
  } catch {
    return [];
  }
}

export async function getDownload(entryId: string): Promise<DownloadRecord | null> {
  return (await listDownloads()).find((d) => d.entryId === entryId) ?? null;
}

export async function putDownload(rec: DownloadRecord): Promise<void> {
  const all = await listDownloads();
  const idx = all.findIndex((d) => d.entryId === rec.entryId);
  if (idx >= 0) all[idx] = rec;
  else all.push(rec);
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function deleteDownloadRecord(entryId: string): Promise<void> {
  const all = await listDownloads();
  await AsyncStorage.setItem(KEY, JSON.stringify(all.filter((d) => d.entryId !== entryId)));
}

export function totalBytes(records: DownloadRecord[]): number {
  return records.reduce((n, d) => n + (d.bytes || 0), 0);
}
