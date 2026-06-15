import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BundledBook } from "@/storage/bundledLibrary";
import { parseBook, ImportError } from "@/storage/importBook";
import { loadBookIndex, saveBook } from "@/storage/bookStore";

// First-run seeder for the default shareable library (ADR-017, issue #111).
//
// On launch we import each *published* bundled book into the on-device Books
// store, tagged `source: "bundled"`. The work is keyed by book id + version so
// it is idempotent and respects the user:
//   • A book is seeded at most once per (id, version) — re-running does nothing.
//   • If the user later deletes a seeded book, it is NOT resurrected: the
//     (id, version) record persists, so we don't re-add it.
//   • A version bump in the manifest re-seeds the new version, but only if the
//     stored book is still bundled-owned (we never clobber a user's own book or
//     a copy they forked from a bundled one — copy-on-write, ADR-017 D3).
//   • `draft` books are skipped — they aren't shipped defaults yet (ADR-017 D4).
//
// Seeding must never crash app launch; callers swallow errors (see
// useSeedDefaultLibrary). The D18 fair-use cap isn't implemented yet, so there
// is nothing to exclude bundled books from today — when the cap lands it reads
// BookMeta.source to skip them (ADR-017 D3).

// Map of bundled-book id → the version we last seeded. Persisted so deletions
// aren't undone and version bumps are detected.
const SEEDED_KEY = "sbq_seeded_library";

export interface SeedResult {
  seeded: string[]; // ids imported this run
  skipped: string[]; // ids intentionally not imported (draft, already seeded, user-owned)
  failed: string[]; // ids whose JSON failed to parse
}

type SeededVersions = Record<string, string>;

async function loadSeeded(): Promise<SeededVersions> {
  const raw = await AsyncStorage.getItem(SEEDED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SeededVersions) : {};
  } catch {
    return {};
  }
}

async function saveSeeded(versions: SeededVersions): Promise<void> {
  await AsyncStorage.setItem(SEEDED_KEY, JSON.stringify(versions));
}

/**
 * Seed published bundled books into the local Books store. Idempotent and
 * deletion-safe. Returns a per-id breakdown of what happened.
 */
export async function seedDefaultLibrary(bundled: BundledBook[]): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [], failed: [] };
  const seededVersions = await loadSeeded();
  const index = await loadBookIndex();
  const existing = new Map(index.map((m) => [m.id, m]));

  for (const book of bundled) {
    // Only ship published books as defaults.
    if (book.status !== "published") {
      result.skipped.push(book.id);
      continue;
    }
    // Already seeded at this exact version — leave it (respects later deletes
    // and any edits the user made to their copy).
    if (seededVersions[book.id] === book.version) {
      result.skipped.push(book.id);
      continue;
    }
    // A book already in the store that we did NOT seed (user-authored, or a
    // copy forked from a bundled book) is never overwritten.
    const current = existing.get(book.id);
    if (current && current.source !== "bundled") {
      result.skipped.push(book.id);
      continue;
    }

    let parsed;
    try {
      parsed = parseBook(book.raw);
    } catch (err) {
      // A malformed bundled book is a build/packaging defect, not a user error;
      // record and move on rather than blocking the rest of the library.
      if (err instanceof ImportError) {
        result.failed.push(book.id);
        continue;
      }
      throw err;
    }

    await saveBook({ ...parsed, source: "bundled" });
    seededVersions[book.id] = book.version;
    result.seeded.push(book.id);
  }

  // Persist the high-water marks only if something changed, to avoid a needless
  // write on the common "nothing to do" launch.
  if (result.seeded.length > 0) {
    await saveSeeded(seededVersions);
  }
  return result;
}
