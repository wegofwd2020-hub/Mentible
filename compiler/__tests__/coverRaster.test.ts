import { renderCoverJpeg } from "../src/coverRaster";

it("renderCoverJpeg throws a clear error when puppeteer is not installed", async () => {
  await expect(renderCoverJpeg("<svg/>")).rejects.toThrow(/puppeteer is not installed/i);
});
