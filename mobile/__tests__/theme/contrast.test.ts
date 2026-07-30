import { contrastRatio } from "@/theme/contrast";
import { themes } from "@/constants/theme";
import type { ThemeName } from "@/constants/theme";

const NAMES: ThemeName[] = ["study", "manuscript", "reading", "gilded-noir", "forest-moss"];

it("computes known ratios (sanity)", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
});

// Body-text legibility is the guarantee every theme must meet (this is exactly
// the class of bug the nav sceneStyle fix addressed). Accent ratios vary by
// design and are reported, not hard-gated on the muted role.
it("every theme keeps body text legible on background and surface (AA 4.5:1)", () => {
  for (const name of NAMES) {
    const p = themes[name];
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
  }
});

it("every theme's primary accent is usable on its background (AA large/UI 3:1)", () => {
  for (const name of NAMES) {
    const p = themes[name];
    expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(3);
  }
});
