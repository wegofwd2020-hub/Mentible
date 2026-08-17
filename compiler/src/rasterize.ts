// Rasterise HTML or an SVG fragment to a PNG via headless Chromium — the single
// screenshot path shared by the cover thumbnail (coverRaster.ts) and the DOCX
// renderer (docx.ts), so there is ONE puppeteer integration, not two.

const nativeImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;

interface PuppeteerPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  $(sel: string): Promise<PuppeteerEl | null>;
  screenshot(opts: { type: "png"; omitBackground?: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface PuppeteerEl {
  screenshot(opts: { type: "png"; omitBackground?: boolean }): Promise<Uint8Array>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

async function launchBrowser(): Promise<PuppeteerBrowser> {
  let puppeteer: { launch: (opts: Record<string, unknown>) => Promise<PuppeteerBrowser> };
  try {
    const mod = (await nativeImport("puppeteer")) as { default?: typeof puppeteer };
    puppeteer = (mod.default ?? (mod as unknown)) as typeof puppeteer;
  } catch {
    throw new Error("puppeteer is not installed — cannot rasterise to PNG.");
  }
  const launch: Record<string, unknown> = { headless: true };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launch.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  launch.args =
    process.env.SBQ_NO_SANDBOX === "1"
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [];
  return puppeteer.launch(launch);
}

function shellHtml(inner: string, width: number): string {
  return (
    `<!DOCTYPE html><html><body style="margin:0">` +
    `<div id="target" style="display:inline-block;max-width:${width}px">` +
    `<style>#target svg{max-width:${width}px;height:auto;display:block}</style>${inner}</div>` +
    `</body></html>`
  );
}

async function shotSvg(page: PuppeteerPage, svg: string, width: number, omitBackground: boolean): Promise<Buffer> {
  await page.setViewport({ width, height: 2000, deviceScaleFactor: 2 });
  await page.setContent(shellHtml(svg, width));
  const el = await page.$("#target");
  const buf = el
    ? await el.screenshot({ type: "png", omitBackground })
    : await page.screenshot({ type: "png", omitBackground });
  return Buffer.from(buf);
}

// Render `input.html` (a full body fragment) OR `input.svg` (wrapped in a shell)
// to a PNG Buffer at `width` px. Screenshots the #target element if present, else
// the page. Throws if puppeteer is unavailable.
export async function rasterizeToPng(input: {
  html?: string;
  svg?: string;
  width?: number;
  omitBackground?: boolean;
}): Promise<Buffer> {
  const width = input.width ?? 420;
  const omitBackground = input.omitBackground ?? false;
  const inner = input.html ?? input.svg ?? "";

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    return await shotSvg(page, inner, width, omitBackground);
  } finally {
    await browser.close();
  }
}

// Batch: ONE browser, N screenshots (one page per frame). Order preserved.
export async function rasterizeManyToPng(svgs: string[], width: number, omitBackground = false): Promise<Buffer[]> {
  const browser = await launchBrowser();
  try {
    const out: Buffer[] = [];
    for (const svg of svgs) {
      const page = await browser.newPage();
      out.push(await shotSvg(page, svg, width, omitBackground));
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}
