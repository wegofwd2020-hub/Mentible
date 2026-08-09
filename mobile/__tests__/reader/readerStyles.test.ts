import { readerVars, readerCss, isDarkBackground } from "@/reader/readerStyles";
import { studioDarkColors, studioLightColors } from "@/constants/theme";

describe("reader theme vars", () => {
  it("detects dark vs light backgrounds", () => {
    expect(isDarkBackground(studioDarkColors)).toBe(true);
    expect(isDarkBackground(studioLightColors)).toBe(false);
  });
  it("gates the equation invert + color-scheme on the theme", () => {
    const dark = readerVars(studioDarkColors);
    expect(dark).toContain(`--bg: ${studioDarkColors.background}`);
    expect(dark).toContain("--eq-filter: invert(1)");
    expect(dark).toContain("--reader-scheme: dark");
    const light = readerVars(studioLightColors);
    expect(light).toContain(`--bg: ${studioLightColors.background}`);
    expect(light).toContain("--eq-filter: none");
    expect(light).toContain("--reader-scheme: light");
  });
  it("web CSS uses Playfair headings, no bold weight, and the gated filter", () => {
    const css = readerCss(studioDarkColors);
    expect(css).toContain("PlayfairDisplay_500Medium");
    expect(css).toContain("var(--eq-filter)");
    expect(css).not.toMatch(/h[12][^}]*font-weight:\s*700/); // headings not bold
  });
});
