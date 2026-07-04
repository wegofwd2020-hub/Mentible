import { exportBook, getExportJob, type ExportedArtifact } from "@/api/client";
import {
  getAllExportStatus,
  setFormatStatus,
  type ExportFormat,
} from "@/storage/exportStatus";
import type { Book } from "@/types/book";

// Export a book to EPUB/PDF while recording its status in the exportStatus store,
// so the Books/Library indicators reflect generating → done/failed. Returns the
// artifact bytes (+ trust) exactly like exportBook, so callers use it in place of
// a raw exportBook call. `cover` is not tracked — keep using exportBook for it.
export async function trackedExport(
  book: Book,
  fmt: ExportFormat,
  opts: { diagrams?: boolean } = {},
): Promise<ExportedArtifact> {
  const sourceUpdatedAt = book.updatedAt;
  try {
    const result = await exportBook(book, {
      format: fmt,
      diagrams: opts.diagrams,
      onSubmitted: (jobId) => {
        // Fire-and-forget: a failed status write must not fail the export.
        void setFormatStatus(book.id, fmt, {
          state: "generating",
          jobId,
          sourceUpdatedAt,
        });
      },
    });
    await setFormatStatus(book.id, fmt, {
      state: "done",
      compiledAt: new Date().toISOString(),
      sourceUpdatedAt,
      sizeBytes: result.artifact.byteLength,
    });
    return result;
  } catch (err) {
    await setFormatStatus(book.id, fmt, {
      state: "failed",
      sourceUpdatedAt,
      error: err instanceof Error ? err.message : "Export failed.",
    });
    throw err;
  }
}

// Settle any lingering `generating` rows by polling their async job once. Call on
// list focus so an export the author started then navigated away from resolves to
// done/failed instead of spinning forever. Best-effort: network/parse errors are
// swallowed (the row stays `generating` and is retried next focus).
export async function reconcileGeneratingExports(): Promise<void> {
  const index = await getAllExportStatus();
  const pending: Array<{ bookId: string; fmt: ExportFormat; jobId: string }> = [];
  for (const [bookId, book] of Object.entries(index)) {
    for (const fmt of ["epub", "pdf"] as ExportFormat[]) {
      const s = book[fmt];
      if (s?.state === "generating" && s.jobId) pending.push({ bookId, fmt, jobId: s.jobId });
    }
  }
  await Promise.all(
    pending.map(async ({ bookId, fmt, jobId }) => {
      try {
        const job = await getExportJob(jobId);
        if (job.status === "done") {
          await setFormatStatus(bookId, fmt, {
            state: "done",
            jobId,
            compiledAt: new Date().toISOString(),
            sourceUpdatedAt: index[bookId]?.[fmt]?.sourceUpdatedAt,
            sizeBytes: job.size,
          });
        } else if (job.status === "failed") {
          await setFormatStatus(bookId, fmt, {
            state: "failed",
            sourceUpdatedAt: index[bookId]?.[fmt]?.sourceUpdatedAt,
            error: job.error ?? "Export failed.",
          });
        }
        // queued/running → leave as generating, retried next focus.
      } catch {
        /* swallow — retried next focus */
      }
    }),
  );
}
