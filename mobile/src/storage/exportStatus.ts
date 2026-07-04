import AsyncStorage from "@react-native-async-storage/async-storage";

// Per-book EPUB/PDF export status, shown as coloured indicators on the Books and
// Library surfaces. This tracks STATUS only (not the artifact bytes — the EPUB
// blob lives in epubLibrary). One small AsyncStorage blob, same local-first
// pattern as settingsStore/bookStore.
//
// Five UI states per format, but only three are stored — `none` and `stale` are
// DERIVED (see deriveState):
//   none        → no stored entry (grey)
//   generating  → an async export job is running (pulsing); reconciled on focus
//   done        → an artifact was produced (green) …
//   stale       → …but the book was edited since (amber) — derived from timestamps
//   failed      → the compile failed (red)

const KEY = "sbq_export_status";

export type ExportFormat = "epub" | "pdf";
export type ExportUiState = "none" | "generating" | "done" | "stale" | "failed";

// The persisted per-format record.
export interface FormatStatus {
  state: "generating" | "done" | "failed";
  // The async export job, kept while `generating` so a list can reconcile it
  // (poll once) after the author navigated away mid-compile.
  jobId?: string;
  // ISO time the artifact finished compiling (when `done`).
  compiledAt?: string;
  // Book.updatedAt captured at export time — compared against the live book to
  // decide staleness (an export made before a later edit no longer matches).
  sourceUpdatedAt?: string;
  sizeBytes?: number;
  // Safe, client-facing failure message (when `failed`).
  error?: string;
}

export type BookExportStatus = Partial<Record<ExportFormat, FormatStatus>>;

type Index = Record<string, BookExportStatus>;

async function readIndex(): Promise<Index> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Index;
  } catch {
    return {};
  }
}

async function writeIndex(index: Index): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(index));
}

export async function getExportStatus(bookId: string): Promise<BookExportStatus> {
  const index = await readIndex();
  return index[bookId] ?? {};
}

export async function getAllExportStatus(): Promise<Index> {
  return readIndex();
}

// Merge a patch into one book+format's status (creating entries as needed).
export async function setFormatStatus(
  bookId: string,
  fmt: ExportFormat,
  patch: FormatStatus,
): Promise<void> {
  const index = await readIndex();
  const book = index[bookId] ?? {};
  book[fmt] = patch;
  index[bookId] = book;
  await writeIndex(index);
}

// Derive the UI state for a format, folding in staleness. `bookUpdatedAt` is the
// live Book.updatedAt; a `done` export whose source predates it renders `stale`.
export function deriveState(
  fmtStatus: FormatStatus | undefined,
  bookUpdatedAt: string | undefined,
): ExportUiState {
  if (!fmtStatus) return "none";
  if (fmtStatus.state !== "done") return fmtStatus.state; // generating | failed
  if (
    bookUpdatedAt &&
    fmtStatus.sourceUpdatedAt &&
    new Date(bookUpdatedAt).getTime() > new Date(fmtStatus.sourceUpdatedAt).getTime()
  ) {
    return "stale";
  }
  return "done";
}
