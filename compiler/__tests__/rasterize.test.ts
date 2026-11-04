import { rasterizeToPng, rasterizeToJpeg, rasterizeManyToPngResilient, rasterizeEachIsolated } from "../src/rasterize";

it("throws a clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToPng({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});

it("rasterizeToJpeg throws the same clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToJpeg({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});

it("rasterizeManyToPngResilient degrades to all-null instead of rejecting when the browser can't launch (CI-safe: puppeteer is genuinely absent here)", async () => {
  const out = await rasterizeManyToPngResilient(["<svg/>", "<svg/>", "<svg/>"], 100);
  expect(out).toEqual([null, null, null]);
});

// A real Chromium can't be made to fail deterministically on exactly one item
// in CI, so this drives rasterizeEachIsolated (the per-item loop, factored out
// of rasterizeManyToPngResilient) against a fake browser/page pair instead —
// item 2 of 3 throws, the other two succeed.
it("rasterizeEachIsolated isolates a single item's failure — the batch still resolves with the other buffers", async () => {
  type FakeBrowser = Parameters<typeof rasterizeEachIsolated>[0];
  const pages = [false, true, false].map((shouldFail) => ({
    setViewport: jest.fn(async () => {}),
    setContent: jest.fn(async () => {}),
    $: jest.fn(async () => {
      if (shouldFail) throw new Error("chromium choked on this fragment");
      return { screenshot: jest.fn(async () => new Uint8Array([1, 2, 3])) };
    }),
    screenshot: jest.fn(async () => new Uint8Array([1, 2, 3])),
    evaluate: jest.fn(async () => undefined),
    setRequestInterception: jest.fn(async () => {}),
    on: jest.fn(),
    close: jest.fn(async () => {}),
  }));
  let i = 0;
  const browser = {
    newPage: jest.fn(async () => pages[i++]),
    close: jest.fn(async () => {}),
  } as unknown as FakeBrowser;

  const out = await rasterizeEachIsolated(browser, ["<svg/>", "<svg/>", "<svg/>"], 100, false);

  expect(out).toHaveLength(3);
  expect(out[0]).toBeInstanceOf(Buffer);
  expect(out[1]).toBeNull();
  expect(out[2]).toBeInstanceOf(Buffer);
  // the failing item's page was still obtained (before the $ throw), so its
  // page.close() is still attempted (best-effort cleanup, no page leak).
  expect(pages[1].close).toHaveBeenCalledTimes(1);
});

// Renderer SSRF guard: the server's Chromium may only load inline data: URIs.
it("blocks every non-data network request while rasterising", async () => {
  type FakeBrowser = Parameters<typeof rasterizeEachIsolated>[0];
  const page = {
    setViewport: jest.fn(async () => {}),
    setContent: jest.fn(async () => {}),
    $: jest.fn(async () => null),
    screenshot: jest.fn(async () => new Uint8Array([1])),
    evaluate: jest.fn(async () => undefined),
    setRequestInterception: jest.fn(async () => {}),
    on: jest.fn(),
    close: jest.fn(async () => {}),
  };
  const browser = {
    newPage: jest.fn(async () => page),
    close: jest.fn(async () => {}),
  } as unknown as FakeBrowser;
  await rasterizeEachIsolated(browser, ["<svg/>"], 100, false);

  expect(page.setRequestInterception).toHaveBeenCalledWith(true);
  const handler = (page.on.mock.calls[0] as unknown[])[1] as (r: unknown) => void;
  const make = (url: string) => ({ url: () => url, continue: jest.fn(async () => {}), abort: jest.fn(async () => {}) });
  const internal = make("http://169.254.169.254/latest/meta-data/");
  const inline = make("data:image/png;base64,iVBORw0KGgo=");
  handler(internal);
  handler(inline);
  expect(internal.abort).toHaveBeenCalled();
  expect(internal.continue).not.toHaveBeenCalled();
  expect(inline.continue).toHaveBeenCalled();
});
