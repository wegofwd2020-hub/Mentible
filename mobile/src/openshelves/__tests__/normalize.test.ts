import { toPlainText, mediaTypeFromMime, MAX_FIELD_LEN } from "../normalize";

test("strips tags and decodes entities to inert plaintext", () => {
  expect(toPlainText("<b>Moby&nbsp;Dick</b>")).toBe("Moby Dick");
  expect(toPlainText("Tom &amp; Jerry")).toBe("Tom & Jerry");
  expect(toPlainText("caf&#233;")).toBe("café");
});

test("hostile markup renders inert (no tag survives)", () => {
  const out = toPlainText('<img src=x onerror="alert(1)"><script>alert(2)</script>hi');
  expect(out).not.toMatch(/[<>]/);
  expect(out).not.toMatch(/onerror|script/i);
  expect(out).toContain("hi");
});

test("collapses whitespace and clamps to MAX_FIELD_LEN", () => {
  expect(toPlainText("a\n\n   b\t c")).toBe("a b c");
  expect(toPlainText("x".repeat(MAX_FIELD_LEN + 500)).length).toBe(MAX_FIELD_LEN);
});

test("nullish → empty string", () => {
  expect(toPlainText(null)).toBe("");
  expect(toPlainText(undefined)).toBe("");
});

test("hostile numeric entities do not throw and are dropped", () => {
  expect(() => toPlainText("&#99999999;x")).not.toThrow();
  expect(() => toPlainText("&#x110000;y")).not.toThrow();
  expect(toPlainText("&#99999999;x")).toBe("x");
  expect(toPlainText("&#x110000;y")).toBe("y");
});

test("entity-encoded tags do not survive as markup", () => {
  const out = toPlainText("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(out).not.toMatch(/<script|<\/script/i);
});

test("media type maps from MIME", () => {
  expect(mediaTypeFromMime("application/epub+zip")).toBe("book");
  expect(mediaTypeFromMime("application/pdf")).toBe("book");
  expect(mediaTypeFromMime("audio/mpeg")).toBe("audio");
  expect(mediaTypeFromMime("video/mp4")).toBe("video");
  expect(mediaTypeFromMime("application/octet-stream")).toBe("other");
  expect(mediaTypeFromMime(null)).toBe("other");
});
