// Rasterise a cover SVG to a PNG via headless Chromium (same engine as the
// diagram renderer). Used to produce a small cover thumbnail the mobile Library
// can display as the book's real cover (the EPUB itself carries the vector
// cover.svg, but the app has no on-device SVG/zip support). Heavy + optional —
// only the export path that wants a thumbnail pulls this in.

// Native dynamic import so this CJS build can load the ESM puppeteer package
// that's present only in the runtime image, not the committed deps (mirrors
// mermaid.ts).
const nativeImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;

const COVER_W = 1600;
const COVER_H = 2560;

interface PuppeteerPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  $(sel: string): Promise<PuppeteerEl | null>;
  screenshot(opts: { type: "png" }): Promise<Uint8Array>;
}
interface PuppeteerEl {
  screenshot(opts: { type: "png" }): Promise<Uint8Array>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

// Render `svg` (a full cover SVG) to a PNG Buffer at `width` px (cover aspect
// preserved). 420px is plenty for a Library thumbnail and keeps the payload
// small. Throws if puppeteer isn't installed.
export async function renderCoverPng(svg: string, width = 420): Promise<Buffer> {
  let puppeteer: { launch: (opts: Record<string, unknown>) => Promise<PuppeteerBrowser> };
  try {
    const mod = (await nativeImport("puppeteer")) as { default?: typeof puppeteer; launch?: unknown };
    puppeteer = (mod.default ?? (mod as unknown)) as typeof puppeteer;
  } catch {
    throw new Error("puppeteer is not installed — cannot rasterise the cover.");
  }

  const launch: Record<string, unknown> = { headless: true };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launch.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  launch.args =
    process.env.SBQ_NO_SANDBOX === "1"
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [];

  const browser = await puppeteer.launch(launch);
  try {
    const page = await browser.newPage();
    const height = Math.round((width * COVER_H) / COVER_W);
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0">` +
        `<div id="cover" style="width:${width}px">` +
        `<style>#cover svg{width:${width}px;height:auto;display:block}</style>${svg}</div>` +
        `</body></html>`,
    );
    const el = await page.$("#cover");
    if (!el) throw new Error("cover container not found");
    const buf = await el.screenshot({ type: "png" });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
