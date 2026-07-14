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
