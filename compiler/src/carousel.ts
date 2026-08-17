// A carousel derivative — N branded card frames rendered in one headless-Chromium
// pass (rasterizeManyToPng), emitted as a JSON envelope of base64 PNGs. Reuses the
// card SVG builder (card.ts) so the frames share the branded card look.
import { buildCardSvg, type CardInput } from "./card";
import { rasterizeManyToPng } from "./rasterize";

export interface CarouselInput {
  frames: CardInput[];
}

const SQUARE = 1080;

// Render every frame's branded SVG to a PNG in one Chromium pass, and emit a
// JSON envelope of base64 PNGs (the CLI stream carries one blob; this is how N
// images ride it).
export async function compileCarousel(input: CarouselInput): Promise<Buffer> {
  const svgs = input.frames.map((f) => buildCardSvg({ ...f, size: "square" }));
  const pngs = await rasterizeManyToPng(svgs, SQUARE);
  return Buffer.from(JSON.stringify({ png_base64: pngs.map((b) => b.toString("base64")) }));
}
