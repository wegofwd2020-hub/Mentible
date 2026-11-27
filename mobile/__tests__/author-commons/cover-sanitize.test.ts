/**
 * @jest-environment jsdom
 */
import { sanitizeFragment } from "@/reader/sanitize";
import { sanitizeCoverWith, MAX_COVER_SVG_CHARS } from "@/reader/coverSvg";

const clean = (svg: string | null | undefined) => sanitizeCoverWith(sanitizeFragment, svg);

it("strips <script> and on* handlers", () => {
  const out = clean(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="5" height="5" onclick="x()"/></svg>',
  )!;
  expect(out).toContain("<rect");
  expect(out).not.toMatch(/<script/i);
  expect(out).not.toMatch(/\son\w+\s*=/i);
});

it("removes an external <image href>", () => {
  const out = clean('<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.test/p.png" width="5" height="5"/></svg>')!;
  expect(out).not.toContain("evil.test");
  expect(out).not.toMatch(/href=/i);
});

it("drops xlink:href and foreignObject", () => {
  const out = clean('<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="https://evil.test/p.png"/><foreignObject><div/></foreignObject></svg>')!;
  expect(out).not.toContain("evil.test");
  expect(out).not.toMatch(/foreignobject/i);
});

it("returns undefined (placeholder) for empty, oversize, non-svg or sanitized-to-empty", () => {
  expect(clean(null)).toBeUndefined();
  expect(clean("  ")).toBeUndefined();
  expect(clean("<script>alert(1)</script>")).toBeUndefined();
  expect(clean("x".repeat(MAX_COVER_SVG_CHARS + 1))).toBeUndefined();
});

it("keeps a benign cover", () => {
  expect(clean('<svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>')).toContain("<circle");
});

import { safeCoverThumb } from "@/components/CommonsCover";

describe("safeCoverThumb", () => {
  it("accepts a base64 JPEG data URI", () => {
    expect(safeCoverThumb("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
  });

  it("rejects SVG, remote URLs, and anything with markup or quotes", () => {
    expect(safeCoverThumb("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
    expect(safeCoverThumb("https://evil.test/x.jpg")).toBeUndefined();
    expect(safeCoverThumb('data:image/jpeg;base64,AA"><script>')).toBeUndefined();
    expect(safeCoverThumb(null)).toBeUndefined();
    expect(safeCoverThumb("")).toBeUndefined();
  });
});
