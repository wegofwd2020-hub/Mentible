// Orchestrates a download behind an injectable I/O seam (so it's unit-testable):
// resolve link → download to a .part → verify bytes → move to final → record.
// A failed/empty download leaves NO record and NO stray file (quarantine). The
// real native/web I/O impls live in downloadIO.ts and are NOT unit-tested here.
import type { FeedEntry } from "./types";
import { FeedSourceError } from "./errors";
import { pickDownloadLink } from "./downloadTarget";
import { deleteDownloadRecord, getDownload, putDownload, type DownloadRecord } from "./downloadsStore";

export interface Downloader {
  dir: string;
  ensureDir(dir: string): Promise<void>;
  download(url: string, destPath: string): Promise<{ bytes: number; status?: number }>;
  move(fromPath: string, toPath: string): Promise<void>;
  remove(path: string): Promise<void>;
}

function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "application/epub+zip") return "epub";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("audio/")) return "audio";
  return "bin";
}

function safeName(entryId: string, mime: string): string {
  const slug = entryId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${slug}.${extFor(mime)}`;
}

export async function downloadEntry(
  entry: FeedEntry,
  sourceId: string,
  baseFeedUrl: string,
  io: Downloader,
  now: () => string = () => new Date().toISOString(),
): Promise<DownloadRecord> {
  const target = pickDownloadLink(entry, baseFeedUrl);
  if (!target) throw new FeedSourceError("Nothing downloadable for this entry.");

  await io.ensureDir(io.dir);
  const finalName = safeName(entry.id, target.mimeType);
  const finalPath = `${io.dir}${finalName}`;
  const partPath = `${finalPath}.part`;

  let bytes = 0;
  let status: number | undefined;
  try {
    ({ bytes, status } = await io.download(target.url, partPath));
  } catch (err) {
    await io.remove(partPath).catch(() => {});
    throw new FeedSourceError(`Download failed: ${(err as Error).message}`);
  }
  if (status !== undefined && status !== 0 && (status < 200 || status >= 300)) {
    await io.remove(partPath).catch(() => {});
    throw new FeedSourceError(`Download failed: HTTP ${status}.`);
  }
  if (!bytes || bytes <= 0) {
    await io.remove(partPath).catch(() => {});
    throw new FeedSourceError("Download was empty.");
  }

  await io.move(partPath, finalPath);
  const rec: DownloadRecord = {
    entryId: entry.id,
    sourceId,
    title: entry.title,
    path: finalPath,
    mimeType: target.mimeType,
    bytes,
    downloadedAt: now(),
  };
  await putDownload(rec);
  return rec;
}

export async function removeDownload(entryId: string, io: Downloader): Promise<void> {
  const rec = await getDownload(entryId);
  if (rec) await io.remove(rec.path).catch(() => {});
  await deleteDownloadRecord(entryId);
}
