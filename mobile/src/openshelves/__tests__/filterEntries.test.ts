import { filterEntries, primarySubtag, type ShelfPrefs } from "../filterEntries";
import { deviceLocale } from "../deviceLocale";
import type { FeedEntry } from "../types";

const e = (over: Partial<FeedEntry>): FeedEntry => ({
  id: Math.random().toString(), title: "t", authors: [], summary: "", coverUrl: null,
  language: null, categories: [], mediaType: "book", rightsText: null, mature: null,
  links: [], canonicalUrl: null, navigationUrl: null, ...over,
});
const prefs = (over: Partial<ShelfPrefs> = {}): ShelfPrefs => ({ language: "all", hideMature: true, ...over });

test("primarySubtag lowercases and strips region", () => {
  expect(primarySubtag("en-US")).toBe("en");
  expect(primarySubtag("FR")).toBe("fr");
});

test("language filter keeps matches and unknown-language entries, drops mismatches", () => {
  const list = [e({ id: "en", language: "en" }), e({ id: "fr", language: "fr-FR" }), e({ id: "unk", language: null })];
  const kept = filterEntries(list, prefs({ language: "en" })).map((x) => x.id);
  expect(kept).toEqual(["en", "unk"]); // fr dropped, unknown kept
});

test("language 'all' disables the language filter", () => {
  const list = [e({ language: "en" }), e({ language: "fr" })];
  expect(filterEntries(list, prefs({ language: "all" }))).toHaveLength(2);
});

test("hideMature drops only mature===true; keeps false and null", () => {
  const list = [e({ id: "m", mature: true }), e({ id: "ok", mature: false }), e({ id: "unk", mature: null })];
  expect(filterEntries(list, prefs({ hideMature: true })).map((x) => x.id)).toEqual(["ok", "unk"]);
  expect(filterEntries(list, prefs({ hideMature: false }))).toHaveLength(3);
});

test("language + maturity compose", () => {
  const list = [e({ id: "keep", language: "en", mature: false }), e({ id: "mat", language: "en", mature: true }), e({ id: "fr", language: "fr" })];
  expect(filterEntries(list, prefs({ language: "en", hideMature: true })).map((x) => x.id)).toEqual(["keep"]);
});

test("deviceLocale reduces a raw locale to its primary subtag", () => {
  expect(deviceLocale("en-GB")).toBe("en");
  expect(deviceLocale("")).toBe("en"); // fallback
});

test("non-string language values never throw and the entry is kept (unknown => keep)", () => {
  const list = [
    e({ id: "num", language: 5 as any }),
    e({ id: "obj", language: {} as any }),
    e({ id: "arr", language: ["en"] as any }),
  ];
  expect(() => filterEntries(list, prefs({ language: "en" }))).not.toThrow();
  expect(filterEntries(list, prefs({ language: "en" })).map((x) => x.id)).toEqual(["num", "obj", "arr"]);
});

test("empty-string language is the unknown-=>-keep boundary", () => {
  const list = [e({ id: "empty", language: "" })];
  expect(filterEntries(list, prefs({ language: "en" })).map((x) => x.id)).toEqual(["empty"]);
});

test("pref language is normalized: 'EN' and 'en-US' still match an 'en' entry", () => {
  const list = [e({ id: "en", language: "en" })];
  expect(filterEntries(list, prefs({ language: "EN" })).map((x) => x.id)).toEqual(["en"]);
  expect(filterEntries(list, prefs({ language: "en-US" })).map((x) => x.id)).toEqual(["en"]);
});

test("prefs missing language falls back to 'all' (nothing dropped by language)", () => {
  const list = [e({ id: "en", language: "en" }), e({ id: "fr", language: "fr" })];
  const legacyPrefs = { hideMature: true } as any as ShelfPrefs; // simulates an older persisted shape
  expect(filterEntries(list, legacyPrefs).map((x) => x.id)).toEqual(["en", "fr"]);
});

test("prefs missing hideMature falls back to true (a mature:true entry is hidden)", () => {
  const list = [e({ id: "mat", mature: true }), e({ id: "ok", mature: false })];
  const legacyPrefs = { language: "all" } as any as ShelfPrefs; // simulates an older persisted shape
  expect(filterEntries(list, legacyPrefs).map((x) => x.id)).toEqual(["ok"]);
});

test("filterEntries never throws and returns [] for an empty entry list", () => {
  expect(() => filterEntries([], prefs())).not.toThrow();
  expect(filterEntries([], prefs())).toEqual([]);
});
