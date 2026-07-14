// Pure client-side content filter (ADR-028 §6b): a total function of device-local
// declared prefs × feed metadata. Unknown language/maturity is KEPT — never hide a
// book because its metadata is missing.
import type { FeedEntry } from "./types";

export interface ShelfPrefs {
  language: string; // a primary subtag ("en") or the literal "all"
  hideMature: boolean;
}

// Total for ANY input, not just `string | null | undefined`: a corrupted or
// schema-drifted stored blob (feedEntriesStore does an unchecked
// `JSON.parse(raw) as FeedEntry[]` cast) can hand this a number, object, or
// array. `??` only substitutes for null/undefined, so anything else used to
// fall through to `.split` and throw. Guard on `typeof` instead — any
// non-string is "unknown" and normalizes to "", same as an absent language.
export function primarySubtag(lang: unknown): string {
  if (typeof lang !== "string") return "";
  return lang.split(/[-_]/)[0].trim().toLowerCase();
}

export function filterEntries(entries: FeedEntry[], prefs: ShelfPrefs): FeedEntry[] {
  // `prefs` may be a partial/legacy shape at runtime even though ShelfPrefs's
  // TS type claims both fields are required (an older persisted blob, or a
  // future field added without a migration). Judgment calls, documented:
  //
  // - Missing/empty/non-string `language` => treat as "all" (don't filter by
  //   language). This is the same "unknown metadata => keep" principle
  //   applied to the *pref* side: if we don't know what language the user
  //   wants, showing everything is safer than silently hiding everything.
  // - Missing/non-boolean `hideMature` => treat as `true`. This is the one
  //   case where "unknown => permissive" would be the WRONG default:
  //   defaultPrefs() ships `hideMature: true`, so a lost/corrupted pref
  //   should fail toward the safer (hiding) side rather than silently
  //   surfacing mature content the user never opted into.
  const rawLanguage = (prefs as { language?: unknown }).language;
  const language =
    typeof rawLanguage === "string" && rawLanguage.trim() !== "" ? primarySubtag(rawLanguage) : "all";
  const rawHideMature = (prefs as { hideMature?: unknown }).hideMature;
  const hideMature = typeof rawHideMature === "boolean" ? rawHideMature : true;

  return entries.filter((e) => {
    if (hideMature && e.mature === true) return false;
    const entryLanguage = primarySubtag(e.language);
    if (language !== "all" && entryLanguage !== "" && entryLanguage !== language) return false;
    return true;
  });
}
