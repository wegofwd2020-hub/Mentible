import { useEffect } from "react";
import { bundledBooks } from "@/storage/bundledLibrary";
import { seedDefaultLibrary } from "@/storage/seedLibrary";

// Seed the default shareable library once per app process, on mount (ADR-017,
// issue #111). seedDefaultLibrary is itself idempotent and deletion-safe, so a
// stray double-invoke is harmless. Failures must never break launch — the
// catch keeps a packaging defect in a bundled book from taking down the app.
export function useSeedDefaultLibrary(): void {
  useEffect(() => {
    void seedDefaultLibrary(bundledBooks).catch(() => {
      // Swallow: seeding is best-effort. A user can still author/import books.
    });
  }, []);
}
