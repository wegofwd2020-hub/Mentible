import {
  exportBook,
  getExportJob,
  getPublishedArtifacts,
  type ExportedArtifact,
} from "@/api/client";
import { buildCompilePayload } from "@/lib/compilePayload";
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
//
// The compiler is a remote HTTP service with no media channel: attached images
// only reach it as data: URIs already inline in the markdown. So the stored
// book is inflated (buildCompilePayload — a deep copy, never mutates `book`)
// before it's POSTed. `fmt` is always "epub" | "pdf" here (ExportFormat has no
// "cover" member — the cover thumbnail always goes through a raw exportBook
// call instead, see SaveToLibraryButton), so both tracked formats get the
// Figures section and cover never does.
export async function trackedExport(
  book: Book,
  fmt: ExportFormat,
  opts: { diagrams?: boolean } = {},
): Promise<ExportedArtifact> {
  const sourceUpdatedAt = book.updatedAt;
  try {
    const payload = await buildCompilePayload(book);
    const result = await exportBook(payload, {
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

// Which formats are published to the Open Library (reader-visible availability),
// shared by the Library screen and the shelf/pill components that render it.
export type PublishedFormats = { epub?: boolean; pdf?: boolean };

// Which formats each book has published to the Open Library (reader-visible).
// Best-effort per book so one failure doesn't blank the whole shelf; a book with
// no publish (or an unreachable backend) simply maps to {}.
export async function loadPublishedMap(
  bookIds: string[],
): Promise<Record<string, PublishedFormats>> {
  const entries = await Promise.all(
    bookIds.map(async (id): Promise<[string, PublishedFormats]> => {
      try {
        const a = await getPublishedArtifacts(id);
        return [id, { epub: !!a.epub, pdf: !!a.pdf }];
      } catch {
        return [id, {}];
      }
    }),
  );
  return Object.fromEntries(entries);
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
