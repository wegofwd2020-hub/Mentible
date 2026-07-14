// Pure client-side content filter (ADR-028 §6b): a total function of device-local
// declared prefs × feed metadata. Unknown language/maturity is KEPT — never hide a
// book because its metadata is missing.
import type { FeedEntry } from "./types";

export interface ShelfPrefs {
  language: string; // a primary subtag ("en") or the literal "all"
  hideMature: boolean;
}

export function primarySubtag(lang: string): string {
  return (lang ?? "").split(/[-_]/)[0].trim().toLowerCase();
}

export function filterEntries(entries: FeedEntry[], prefs: ShelfPrefs): FeedEntry[] {
  return entries.filter((e) => {
    if (prefs.hideMature && e.mature === true) return false;
    if (prefs.language !== "all" && e.language) {
      if (primarySubtag(e.language) !== prefs.language) return false;
    }
    return true;
  });
}
