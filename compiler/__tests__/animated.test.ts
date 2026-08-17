import { buildAnimatedCardSvg, encodeGif, motionTimepoints } from "../src/animated";
import { rasterizeSvgFrames } from "../src/rasterize";

const base = { headline: "Trust is the product", subtext: "Every claim traces to a source.", size: "square" as const };

it("each preset builds a card SVG (native 1080 viewBox) with SMIL animation + the copy", () => {
  const smil = { fade: "<animate", slide: "<animateTransform", build: "<animateTransform" } as const;
  for (const preset of ["fade", "slide", "build"] as const) {
    const svg = buildAnimatedCardSvg({ ...base, preset });
    // buildCardSvg's native coordinate grid must be preserved — NOT rewritten to
    // 720 (that would clip 1080-coord content to the top-left corner). The 720
    // is purely the capture OUTPUT width, applied downstream by rasterizeSvgFrames.
    expect(svg).toContain('viewBox="0 0 1080 1080"');
    expect(svg).toContain("Trust is the product");
    expect(svg).toContain("Every claim traces to a source.");
    expect(svg).toContain(smil[preset]);
    expect(svg).not.toContain("@keyframes"); // must be SMIL, not CSS (setCurrentTime can't seek CSS)
  }
});

it("rasterizeSvgFrames throws the puppeteer-absent contract (CI-safe)", async () => {
  await expect(rasterizeSvgFrames("<svg/>", [0, 0.1], 720)).rejects.toThrow(/puppeteer/i);
});

it("encodeGif turns RGBA frames into a GIF89a buffer", () => {
  const w = 2, h = 2;
  const red = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
  const blue = new Uint8Array([0,0,255,255, 0,0,255,255, 0,0,255,255, 0,0,255,255]);
  const gif = encodeGif([{ data: red, width: w, height: h }, { data: blue, width: w, height: h }], 12);
  expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  expect(gif.length).toBeGreaterThan(20);
});

it("motionTimepoints captures only the motion window (regression guard against the frozen-tail bloat)", () => {
  const tps = motionTimepoints();
  // 3.3s@12fps would be ~40 frames — the bug this guards against.
  expect(tps.length).toBeLessThanOrEqual(12);
  expect(tps[0]).toBe(0);
  expect(tps[tps.length - 1]).toBe(0.7);
});

it("encodeGif honors per-frame delayMs (settled-frame hold)", () => {
  const w = 2, h = 2;
  const red = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
  const blue = new Uint8Array([0,0,255,255, 0,0,255,255, 0,0,255,255, 0,0,255,255]);
  const single = encodeGif([{ data: red, width: w, height: h }], 12);
  const held = encodeGif(
    [{ data: red, width: w, height: h }, { data: blue, width: w, height: h, delayMs: 1500 }],
    12,
  );
  expect(held.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  expect(held.length).toBeGreaterThan(single.length);
});
