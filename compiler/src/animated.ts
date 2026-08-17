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
const MOTION_S = 0.7; // the SMIL animation duration — single source of truth
const HOLD_MS = 1500; // how long the GIF dwells on the settled card before it loops

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
  const dur = `${MOTION_S}s`;
  const fade = `<animate attributeName="opacity" from="0" to="1" begin="0s" dur="${dur}" fill="freeze"/>`;
  if (preset === "fade") return fade;
  if (preset === "slide")
    return fade + `<animateTransform attributeName="transform" type="translate" from="0 48" to="0 0" begin="0s" dur="${dur}" fill="freeze"/>`;
  return fade + `<animateTransform attributeName="transform" type="scale" from="0.92" to="1" begin="0s" dur="${dur}" additive="sum" fill="freeze"/>`;
}

// Timepoints (seconds) to seek+capture: the motion window only. The frozen
// hold is one appended frame with a long delay, not ~30 identical captures.
export function motionTimepoints(): number[] {
  const tps: number[] = [];
  for (let t = 0; t <= MOTION_S + 1e-9; t += 1 / FPS) tps.push(Number(t.toFixed(4)));
  // MOTION_S isn't an exact multiple of the 1/FPS step (0.7 * 12 = 8.4), so the
  // loop above lands short of it — snap the final captured point to MOTION_S
  // exactly so the last frame is the true settled state.
  if (tps[tps.length - 1] !== MOTION_S) tps.push(MOTION_S);
  return tps;
}

// Pure RGBA→GIF, unit-testable without Chromium.
export function encodeGif(
  frames: { data: Uint8Array; width: number; height: number; delayMs?: number }[],
  fps: number,
): Buffer {
  const enc = GIFEncoder();
  const defaultDelay = Math.round(1000 / fps);
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    enc.writeFrame(index, f.width, f.height, { palette, delay: f.delayMs ?? defaultDelay });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

export async function compileAnimated(input: AnimatedInput): Promise<Buffer> {
  const svg = buildAnimatedCardSvg(input);
  const pngs = await rasterizeSvgFrames(svg, motionTimepoints(), CAPTURE_WIDTH);
  const frames = pngs.map((buf) => {
    const png = PNG.sync.read(buf);
    return { data: new Uint8Array(png.data), width: png.width, height: png.height } as {
      data: Uint8Array; width: number; height: number; delayMs?: number;
    };
  });
  // Dwell on the settled final frame before the loop restarts, instead of
  // capturing ~30 byte-identical frozen frames.
  if (frames.length) frames[frames.length - 1].delayMs = HOLD_MS;
  return encodeGif(frames, FPS);
}
