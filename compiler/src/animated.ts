// Animated derivative of the branded quote/summary card (P1-5 P3): the same
// buildCardSvg() content, SMIL-animated and captured frame-by-frame in
// headless Chromium, then GIF-encoded with pure-JS deps (gifenc + pngjs — no
// ffmpeg). See docs/ARTIFACT_PIPELINE.md and card.ts.
import { PNG } from "pngjs";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { buildCardSvg } from "./card";
import { rasterizeSvgFrames } from "./rasterize";

export type AnimatedPreset = "fade" | "slide" | "build";
export interface AnimatedInput {
  headline: string;
  subtext: string;
  source_label?: string;
  preset: AnimatedPreset;
  size: "square";
}

// The frame-capture OUTPUT width in px — NOT the SVG's coordinate grid.
// buildCardSvg lays content out on a native 1080x1080 viewBox; that viewBox is
// left untouched (rewriting it to 720 would clip the 1080-coord content to the
// top-left corner). rasterizeSvgFrames scales the rendered SVG down to this
// CSS width via shellHtml's max-width, which the viewBox lets it do cleanly.
const CAPTURE_WIDTH = 720;
const FPS = 12;
const DURATION_S = 2.5;
const HOLD_S = 0.8;
const HOLD_END = DURATION_S + HOLD_S;

// A branded animated card: buildCardSvg's static content, unmodified, wrapped
// in a SMIL-animated <g>. We author the SMIL ourselves (trusted compiler
// output — never routed through the reader's DOMPurify), so <animate>/
// <animateTransform> survive; page.evaluate(svg.setCurrentTime(t)) can only
// seek SMIL, never CSS @keyframes.
export function buildAnimatedCardSvg(input: AnimatedInput): string {
  const base = buildCardSvg({
    headline: input.headline,
    subtext: input.subtext,
    source_label: input.source_label,
    size: "square",
  });
  // buildCardSvg emits a single top-level <svg ...>...</svg> with text/rect
  // children directly under it (no outer <g>) — split off the opening tag
  // (kept verbatim, native 1080 viewBox/width/height untouched) and wrap the
  // inner content in the preset's animated <g>.
  const open = base.match(/^<svg[^>]*>/)?.[0] ?? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">`;
  const inner = base.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const anim = presetAnim(input.preset);
  return `${open}<g opacity="0">${anim}${inner}</g></svg>`;
}

// SMIL for the wrapper <g>. Each preset animates opacity (+ a transform) and
// freezes at the end state so the hold period renders the settled card.
function presetAnim(preset: AnimatedPreset): string {
  const fade = `<animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.7s" fill="freeze"/>`;
  if (preset === "fade") return fade;
  if (preset === "slide")
    return (
      fade +
      `<animateTransform attributeName="transform" type="translate" from="0 48" to="0 0" begin="0s" dur="0.7s" fill="freeze"/>`
    );
  // build
  return (
    fade +
    `<animateTransform attributeName="transform" type="scale" from="0.92" to="1" begin="0s" dur="0.7s" additive="sum" fill="freeze"/>`
  );
}

// Pure RGBA→GIF, unit-testable without Chromium.
export function encodeGif(frames: { data: Uint8Array; width: number; height: number }[], fps: number): Buffer {
  const enc = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    enc.writeFrame(index, f.width, f.height, { palette, delay });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

export async function compileAnimated(input: AnimatedInput): Promise<Buffer> {
  const svg = buildAnimatedCardSvg(input);
  const timepoints: number[] = [];
  for (let t = 0; t <= HOLD_END + 1e-9; t += 1 / FPS) timepoints.push(Number(t.toFixed(4)));
  const pngs = await rasterizeSvgFrames(svg, timepoints, CAPTURE_WIDTH);
  const frames = pngs.map((buf) => {
    const png = PNG.sync.read(buf);
    return { data: new Uint8Array(png.data), width: png.width, height: png.height };
  });
  return encodeGif(frames, FPS);
}
