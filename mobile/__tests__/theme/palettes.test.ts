import { themes, THEME_META, manuscriptColors } from "@/constants/theme";
import type { ThemeName } from "@/constants/theme";
import { contrastRatio } from "@/theme/contrast";

const EXPECTED: ThemeName[] = [
  "study",
  "manuscript",
  "reading",
  "gilded-noir",
  "forest-moss",
  "navy-trust",
  "studio-dark",
  "studio-light",
];
const KEYS = Object.keys(manuscriptColors); // the full Palette key set

it("exposes all registered themes", () => {
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

// ADR-038: Navy Trust ships a legible dark palette (deep navy + single gold
// accent, cream text). Gate its body + muted text against the background so the
// palette can never regress into unreadable low-contrast text.
it("navy-trust text is legible on its background (WCAG)", () => {
  const p = themes["navy-trust"];
  expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5); // AA body
  expect(contrastRatio(p.textMuted, p.background)).toBeGreaterThanOrEqual(4.5); // AA muted
  expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(3); // gold accent visible
});

it("navy-trust is a dark, gold-accent palette matching the design export", () => {
  const p = themes["navy-trust"];
  expect(THEME_META["navy-trust"]).toEqual({ label: "Navy Trust", mode: "dark" });
  // Single gold accent (brand/growth collapse to primary, like Gilded Noir).
  expect(p.brand).toBe(p.primary);
  expect(p.growth).toBe(p.primary);
});
