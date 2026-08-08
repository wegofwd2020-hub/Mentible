import { themes, THEME_META, colors } from "@/constants/theme";
import { contrastRatio } from "@/theme/contrast";

const KEYS = Object.keys(colors) as (keyof typeof colors)[];

it("studio-dark and studio-light are registered with the full token shape", () => {
  for (const name of ["studio-dark", "studio-light"] as const) {
    expect(themes[name]).toBeDefined();
    for (const k of KEYS) expect(themes[name][k]).toMatch(/^#|rgba/);
    expect(THEME_META[name]).toBeDefined();
  }
  expect(THEME_META["studio-dark"].mode).toBe("dark");
  expect(THEME_META["studio-light"].mode).toBe("light");
});

it("both Studio palettes meet WCAG AA for body text", () => {
  for (const name of ["studio-dark", "studio-light"] as const) {
    const p = themes[name];
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.textSecondary, p.surface)).toBeGreaterThanOrEqual(4.5);
  }
});
