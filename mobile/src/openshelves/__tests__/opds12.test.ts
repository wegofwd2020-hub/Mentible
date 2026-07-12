// mobile/src/openshelves/__tests__/opds12.test.ts
import { parseOpds12, MAX_ENTRIES } from "../opds12";
import { FeedParseError } from "../errors";

const OPDS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <title>Test Library</title>
  <entry>
    <id>urn:x:1</id>
    <title>Moby&#32;Dick</title>
    <author><name>Herman Melville</name></author>
    <summary>A whale &amp; a man.</summary>
    <dc:language>en</dc:language>
    <category term="Fiction" label="Fiction"/>
    <link rel="http://opds-spec.org/image" href="https://ex.org/c.jpg" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition/open-access" href="https://ex.org/m.epub" type="application/epub+zip"/>
    <link rel="alternate" href="https://ex.org/moby"/>
  </entry>
  <entry>
    <title>No Id — skipped</title>
  </entry>
</feed>`;

test("parses OPDS 1.2 entries with normalized fields", () => {
  const { feedTitle, entries } = parseOpds12(OPDS);
  expect(feedTitle).toBe("Test Library");
  expect(entries).toHaveLength(1); // the id-less entry is skipped
  const e = entries[0];
  expect(e.id).toBe("urn:x:1");
  expect(e.title).toBe("Moby Dick");
  expect(e.authors).toEqual(["Herman Melville"]);
  expect(e.summary).toBe("A whale & a man.");
  expect(e.language).toBe("en");
  expect(e.categories).toEqual(["Fiction"]);
  expect(e.coverUrl).toBe("https://ex.org/c.jpg");
  expect(e.mediaType).toBe("book");
  expect(e.canonicalUrl).toBe("https://ex.org/moby");
  expect(e.links.some((l) => l.mimeType === "application/epub+zip")).toBe(true);
  expect(e.mature).toBeNull();
});

test("malformed XML throws FeedParseError", () => {
  expect(() => parseOpds12("<feed><entry><id>x</id")).toThrow(FeedParseError);
});

test("a non-Atom document throws FeedParseError naming OPDS", () => {
  expect(() => parseOpds12('<rss version="2.0"><channel/></rss>')).toThrow(/OPDS/);
});

test("XXE: entities are not expanded", () => {
  const xxe = `<?xml version="1.0"?>
  <!DOCTYPE feed [ <!ENTITY xxe "PWNED"> ]>
  <feed xmlns="http://www.w3.org/2005/Atom"><title>&xxe;</title>
    <entry><id>1</id><title>&xxe;</title></entry></feed>`;
  const { entries } = parseOpds12(xxe);
  // The entity must NOT resolve to "PWNED".
  expect(JSON.stringify(entries)).not.toContain("PWNED");
});

test("mature flag detected from a category scheme/term", () => {
  const m = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>m1</id><title>x</title><category term="mature"/></entry></feed>`;
  expect(parseOpds12(m).entries[0].mature).toBe(true);
});

test("entry count is capped at MAX_ENTRIES", () => {
  const many =
    `<feed xmlns="http://www.w3.org/2005/Atom">` +
    Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => `<entry><id>e${i}</id><title>t</title></entry>`).join("") +
    `</feed>`;
  expect(parseOpds12(many).entries.length).toBe(MAX_ENTRIES);
});

test("entity-encoded ampersands in URLs are decoded", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>u1</id><title>t</title>
    <link rel="http://opds-spec.org/acquisition" href="https://ex.org/m.epub?a=1&amp;b=2" type="application/epub+zip"/>
  </entry></feed>`;
  const e = parseOpds12(xml).entries[0];
  expect(e.links[0].href).toBe("https://ex.org/m.epub?a=1&b=2");
});

test("javascript: and data: URLs are rejected", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>u2</id><title>t</title>
    <link rel="http://opds-spec.org/image" href="javascript:alert(1)" type="image/png"/>
    <link rel="http://opds-spec.org/acquisition" href="data:text/html,x" type="application/epub+zip"/>
    <link rel="alternate" href="https://ex.org/ok"/>
  </entry></feed>`;
  const e = parseOpds12(xml).entries[0];
  expect(e.coverUrl).toBeNull();                 // javascript: image rejected
  expect(e.links.every((l) => !l.href.startsWith("data:"))).toBe(true); // data: acquisition dropped
  expect(e.canonicalUrl).toBe("https://ex.org/ok");
});

test("relative URLs are preserved (resolved against feed base later)", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>u3</id><title>t</title>
    <link rel="http://opds-spec.org/acquisition" href="/book/1.epub" type="application/epub+zip"/>
  </entry></feed>`;
  const e = parseOpds12(xml).entries[0];
  expect(e.links[0].href).toBe("/book/1.epub");
});

test("tab/newline-obfuscated javascript scheme is rejected", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>u4</id><title>t</title>
    <link rel="http://opds-spec.org/image" href="java&#9;script:alert(1)" type="image/png"/>
    <link rel="http://opds-spec.org/acquisition" href="java\nscript:alert(1)" type="application/epub+zip"/>
  </entry></feed>`;
  const e = parseOpds12(xml).entries[0];
  expect(e.coverUrl).toBeNull();
  expect(e.links.every((l) => !/javascript:/i.test(l.href))).toBe(true);
});

test("link rel and mimeType are plaintext-normalized (no markup survives)", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>n1</id><title>t</title>
    <link rel="acquisition&lt;img src=x onerror=1&gt;" href="https://ex.org/m.epub" type="application/epub+zip&lt;script&gt;"/>
  </entry></feed>`;
  const e = parseOpds12(xml).entries[0];
  const link = e.links[0];
  expect(link.rel).not.toMatch(/[<>]/);
  expect(link.mimeType).not.toMatch(/[<>]|script/i);
});

test("numeric-looking ids are preserved as strings, not coerced to NaN", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>e1</id><title>t</title></entry>
    <entry><id>e2</id><title>t</title></entry>
    <entry><id>12345</id><title>t</title></entry>
    <entry><id>007</id><title>t</title></entry>
  </feed>`;
  const { entries } = parseOpds12(xml);
  expect(entries.map((e) => e.id)).toEqual(["e1", "e2", "12345", "007"]);
});
