// A branded quote/summary card (headline + subtext + optional source label +
// brand mark) rendered to PNG for the Publish surface (P1-5). The SVG forks the
// cover's branded look (STUDIO palette, tokens.ts); the rasterizer is the same
// headless-Chromium path the cover uses.
import { STUDIO } from "./tokens";
import { rasterizeToPng } from "./rasterize";

export interface CardInput {
  headline: string;
  subtext: string;
  source_label?: string;
  size: "square" | "linkedin" | "story";
}

const SIZES: Record<CardInput["size"], { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  linkedin: { w: 1200, h: 627 },
  story: { w: 1080, h: 1920 },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Greedy word-wrap to at most `maxChars` per line (a deterministic heuristic —
// good enough for a fixed card; no font-metric measurement needed).
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

export function buildCardSvg(input: CardInput): string {
  const { w, h } = SIZES[input.size];
  const pad = Math.round(w * 0.08);
  const portrait = input.size === "story";
  const headSize = portrait ? 84 : Math.round(w * 0.06);
  const subSize = Math.round(headSize * 0.5);
  const headLines = wrap(input.headline, portrait ? 20 : 26, 4);
  const subLines = wrap(input.subtext, portrait ? 34 : 48, 4);

  let y = portrait ? Math.round(h * 0.32) : Math.round(h * 0.30);
  const headLH = Math.round(headSize * 1.14);
  const subLH = Math.round(subSize * 1.3);

  const head = headLines
    .map((l, i) => `<text x="${pad}" y="${y + i * headLH}" font-family="Georgia, 'Times New Roman', serif" font-size="${headSize}" font-weight="700" fill="${STUDIO.goldBright}">${esc(l)}</text>`)
    .join("");
  y += headLines.length * headLH + Math.round(headSize * 0.6);
  const sub = subLines
    .map((l, i) => `<text x="${pad}" y="${y + i * subLH}" font-family="Helvetica, Arial, sans-serif" font-size="${subSize}" fill="${STUDIO.navySoft}">${esc(l)}</text>`)
    .join("");
  y += subLines.length * subLH;

  const label = input.source_label
    ? `<text x="${pad}" y="${h - pad - 44}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(subSize * 0.7)}" fill="${STUDIO.goldSoft}">${esc(input.source_label)}</text>`
    : "";
  const brand = `<text x="${pad}" y="${h - pad}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(subSize * 0.72)}" font-weight="700" fill="${STUDIO.navySoft}">Mentible</text>`;
  const accent = `<rect x="${pad}" y="${Math.round((portrait ? h * 0.32 : h * 0.30) - headSize - 40)}" width="${Math.round(w * 0.18)}" height="8" fill="${STUDIO.goldBright}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${STUDIO.navy}"/>` +
    `<rect width="${w}" height="${h}" fill="${STUDIO.navySurface}" opacity="0.5"/>` +
    accent + head + sub + label + brand +
    `</svg>`
  );
}

export async function compileCard(input: CardInput): Promise<Buffer> {
  return rasterizeToPng({ svg: buildCardSvg(input), width: SIZES[input.size].w });
}
