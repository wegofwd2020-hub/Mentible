import { rasterizeManyToPng } from "../src/rasterize";
import { buildCardSvg } from "../src/card";

it("rasterizeManyToPng throws the puppeteer-absent contract (CI-safe)", async () => {
  await expect(rasterizeManyToPng(["<svg/>"], 1080)).rejects.toThrow(/puppeteer/i);
});

it("each carousel frame's SVG carries its own copy at the square viewBox", () => {
  const frames = [
    { headline: "Hook", subtext: "Open strong.", size: "square" as const },
    { headline: "Point one", subtext: "A claim.", size: "square" as const },
  ];
  for (const f of frames) {
    const svg = buildCardSvg(f);
    expect(svg).toContain('viewBox="0 0 1080 1080"');
    expect(svg).toContain(f.headline);
    expect(svg).toContain(f.subtext);
  }
});
