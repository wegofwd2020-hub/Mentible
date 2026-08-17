import { rasterizeToPng, rasterizeToJpeg } from "../src/rasterize";

it("throws a clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToPng({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});

it("rasterizeToJpeg throws the same clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToJpeg({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});
