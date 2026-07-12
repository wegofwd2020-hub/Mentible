import { resolveUrl, pickDownloadLink } from "../downloadTarget";
import type { FeedEntry, AcquisitionLink } from "../types";

const BASE = "https://ex.org/catalog/index.atom";
const link = (href: string, mimeType: string, rel = "http://opds-spec.org/acquisition"): AcquisitionLink => ({ href, mimeType, rel });
const entry = (links: AcquisitionLink[], mediaType: FeedEntry["mediaType"] = "book"): FeedEntry => ({
  id: "e1", title: "t", authors: [], summary: "", coverUrl: null, language: null, categories: [],
  mediaType, rightsText: null, mature: null, links, canonicalUrl: null,
});

test("resolveUrl keeps absolute https, resolves relative against the feed, rejects non-http", () => {
  expect(resolveUrl(BASE, "https://cdn.org/a.epub")).toBe("https://cdn.org/a.epub");
  expect(resolveUrl(BASE, "/files/a.epub")).toBe("https://ex.org/files/a.epub");
  expect(resolveUrl(BASE, "../b.pdf")).toBe("https://ex.org/b.pdf");
  expect(resolveUrl(BASE, "javascript:alert(1)")).toBeNull();
  expect(resolveUrl(BASE, "")).toBeNull();
});

test("pickDownloadLink prefers epub, then pdf, then audio; never video", () => {
  const e = entry([link("/a.pdf", "application/pdf"), link("/a.epub", "application/epub+zip")]);
  expect(pickDownloadLink(e, BASE)).toEqual({ url: "https://ex.org/a.epub", mimeType: "application/epub+zip" });

  const audio = entry([link("/a.mp3", "audio/mpeg")], "audio");
  expect(pickDownloadLink(audio, BASE)).toEqual({ url: "https://ex.org/a.mp3", mimeType: "audio/mpeg" });
});

test("a video-only entry has nothing downloadable", () => {
  const v = entry([link("https://ex.org/v.mp4", "video/mp4")], "video");
  expect(pickDownloadLink(v, BASE)).toBeNull();
});

test("an entry whose only link resolves to a bad scheme yields null", () => {
  const bad = entry([link("javascript:x", "application/epub+zip")]);
  expect(pickDownloadLink(bad, BASE)).toBeNull();
});
