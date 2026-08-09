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
  it("sets explicit 500 weight on all headings and disables font-synthesis, to avoid faux-bold", () => {
    const css = readerCss(studioDarkColors);
    // The combined h1-h6 selector rule (immediately after the font-family:
    // var(--display) declaration) must set an explicit weight matching the
    // loaded single-weight PlayfairDisplay_500Medium face — otherwise the UA's
    // default bold <h1>-<h6> styling triggers browser faux-bold synthesis.
    const headingRuleMatch = /\.mentible-reader h1,[\s\S]*?\{([\s\S]*?)\}/.exec(css);
    expect(headingRuleMatch).not.toBeNull();
    const headingRuleBody = headingRuleMatch![1];
    expect(headingRuleBody).toMatch(/font-weight:\s*500/);
    expect(headingRuleBody).not.toMatch(/font-weight:\s*(700|600|bold)/);
    // The individual h1/h2/h3 (and h4-h6) rules must not re-introduce a
    // heavier weight that would override the 500 set above.
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const re = new RegExp(`\\.mentible-reader ${tag} \\{([^}]*)\\}`);
      const m = re.exec(css);
      if (m) expect(m[1]).not.toMatch(/font-weight:\s*(700|600|bold)/);
    }
    // Belt-and-suspenders: font-synthesis: none on the scoped root, so even a
    // future weight mismatch can't fall back to synthesized bold.
    expect(css).toContain("font-synthesis: none");
  });
});
