import manifest from "../../assets/library/manifest.json";
import certArchitectFoundations from "../../assets/library/books/claude-certified-architect-foundations.book.json";
import productSenseAndAi from "../../assets/library/books/product-sense-and-ai.book.json";

// Registry of the bundled default library (ADR-017). The book .json files live
// under assets/library/ so Expo/Metro bundles them; this module exposes them as
// a flat list the first-run seeder consumes (see seedLibrary.ts).
//
// Metro/TypeScript can't `require()` a runtime-computed path, so every book file
// is statically imported and mapped by its manifest `file` below. Both the
// asset copies (assets/library/) and the FILE_MODULES map here are currently
// hand-maintained; issue #112 (build step: library/ → mobile/assets/library/)
// will generate them from the canonical repo-root library/.

export interface BundledBook {
  id: string;
  version: string;
  status: "draft" | "published";
  // The book.json serialized as a string — parseBook (importBook.ts) takes a
  // raw string, matching the paste/import path exactly.
  raw: string;
}

interface ManifestEntry {
  id: string;
  title: string;
  file: string;
  version: string;
  status: string;
}

// manifest.file → imported JSON module. Keep in sync when adding a book.
const FILE_MODULES: Record<string, unknown> = {
  "books/claude-certified-architect-foundations.book.json": certArchitectFoundations,
  "books/product-sense-and-ai.book.json": productSenseAndAi,
};

function toBundled(entry: ManifestEntry): BundledBook | null {
  const mod = FILE_MODULES[entry.file];
  if (mod === undefined) return null; // manifest references a file we didn't bundle
  return {
    id: entry.id,
    version: entry.version,
    status: entry.status === "published" ? "published" : "draft",
    raw: JSON.stringify(mod),
  };
}

const entries = (manifest as { books: ManifestEntry[] }).books ?? [];

export const bundledBooks: BundledBook[] = entries
  .map(toBundled)
  .filter((b): b is BundledBook => b !== null);
