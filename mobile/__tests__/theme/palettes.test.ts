import { themes, THEME_META, manuscriptColors } from "@/constants/theme";
import type { ThemeName } from "@/constants/theme";

const EXPECTED: ThemeName[] = ["study", "manuscript", "reading", "gilded-noir", "forest-moss"];
const KEYS = Object.keys(manuscriptColors); // the full Palette key set

it("exposes all five themes", () => {
  expect(Object.keys(themes).sort()).toEqual([...EXPECTED].sort());
});

it("every palette defines every Palette key (no missing colours)", () => {
  for (const name of EXPECTED) {
    const p = themes[name] as Record<string, string>;
    for (const k of KEYS) expect(typeof p[k]).toBe("string");
  }
});

it("every theme has switcher metadata with a label and mode", () => {
  for (const name of EXPECTED) {
    expect(THEME_META[name].label.length).toBeGreaterThan(0);
    expect(["dark", "light", "sepia"]).toContain(THEME_META[name].mode);
  }
});
