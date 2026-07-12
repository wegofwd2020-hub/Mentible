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

test("media type maps from MIME", () => {
  expect(mediaTypeFromMime("application/epub+zip")).toBe("book");
  expect(mediaTypeFromMime("application/pdf")).toBe("book");
  expect(mediaTypeFromMime("audio/mpeg")).toBe("audio");
  expect(mediaTypeFromMime("video/mp4")).toBe("video");
  expect(mediaTypeFromMime("application/octet-stream")).toBe("other");
  expect(mediaTypeFromMime(null)).toBe("other");
});
