// Mentible UI theme tokens.
//
// (Platform is used only by the typography block below, for web-vs-native fonts.)
import { Platform } from "react-native";

// Colours derive from the brand mark ("growing mind"): indigo = mind,
// green = growth, red-orange = the "M" / primary action, teal = the book.
// See docs/adr/ADR-006 (brand) and docs/adr/ADR-007 (book template palette);
// the app palette below is intentionally kept in step with the book output so
// authoring and reading feel continuous.
//
// `colors` is the default ("Study", dark). Two further palettes — `manuscriptColors`
// (light, print-bridge) and `readingColors` (sepia, reader-only) — are exported for
// a future theme switcher; nothing consumes them yet, so this change is additive and
// the default look only shifts from the old slate/indigo/yellow scheme onto the mark.

export const colors = {
  background: "#14152a",
  surface: "#1f2140",
  surfaceHigh: "#2c2f52",
  border: "#2c2f52",
  borderLight: "#3b3f6b",

  text: "#eef1f8",
  textSecondary: "#9aa3c0",
  textMuted: "#6b7299",

  // Brand indigo, lightened for legibility on the dark surface.
  primary: "#6d5ae6",
  primaryText: "#ffffff",

  // The red-orange "M" — the active/selected accent and primary call to action.
  brand: "#f2731f",
  brandText: "#2a0f04",

  // Growth green — generation/progress and positive "it grew" moments (pairs
  // with the sprout→leaf icon motif in the UI).
  growth: "#6cc79a",
  growthText: "#06321f",

  // Nav buttons. OFF: white face, indigo-ink glyphs, raised bevel (white
  // highlight / grey shadow). ON: red-orange brand face, dark glyphs, inset
  // bevel — so the active tile looks pressed in. (Was a saturated yellow face;
  // retired because it read close to the "For Dummies" anti-pattern called out
  // in the house-style notes — ADR-006 voice / docs/comparisons.)
  tileOffFace: "#ffffff",
  tileOffGlyph: "#1e1b4b",
  tileOffShadow: "#9aa3c0",
  tileOnFace: "#f2731f",
  tileOnGlyph: "#2a0f04",
  tileOnHi: "#f8a35e",
  tileOnLo: "#b5400f",
  // Secondary line (chip descriptions) on a light tile — dark slate, legible on
  // both the white and the brand-orange faces.
  tileSubGlyph: "#475569",

  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",

  white: "#ffffff",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
} as const;

export const typography = {
  // Fonts. The serif headings tie the app to the book output (Source Serif 4);
  // the sans keeps UI chrome legible; mono is for the BYOK key field + code.
  //
  // Web (react-native-web) resolves a CSS font *stack* and uses the values below.
  // On NATIVE the real families are now bundled (Inter + Source Serif 4 via
  // @expo-google-fonts, OpenDyslexic vendored) and applied by the global text
  // interceptor (src/lib/applyGlobalFont), which maps each weight to its concrete
  // family. The native values here are only read by the few sites that set a
  // fontFamily directly; the interceptor recognises "serif"/"Georgia" as a heading
  // and "monospace" as code, so these still resolve correctly.
  fontHeading: Platform.select({
    web: "'Source Serif 4', 'Iowan Old Style', Georgia, serif",
    ios: "Georgia", // built-in serif
    default: "serif", // Android built-in serif alias
  }),
  fontBody: Platform.select({
    web: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    default: undefined, // system sans on native until Inter is bundled
  }),
  fontMono: Platform.select({
    web: "'JetBrains Mono', 'SF Mono', 'IBM Plex Mono', Menlo, monospace",
    ios: "Menlo", // built-in monospace
    default: "monospace", // Android built-in monospace
  }),

  sizeXs: 12,
  sizeSm: 14,
  sizeMd: 16,
  sizeLg: 18,
  sizeXl: 22,
  sizeXxl: 28,

  lineHeightNormal: 1.5,
  lineHeightRelaxed: 1.75,
} as const;

// ── Additional palettes (for a future theme switcher; see the v1.1 accounts
// work). Same keys as `colors` so a ThemeProvider can swap one for another. ──

export type Palette = Record<keyof typeof colors, string>;

// "Manuscript" — light, warm-paper theme that bridges the app to the printed
// book (indigo ink, green growth, red-orange action on parchment).
export const manuscriptColors: Palette = {
  background: "#faf7f1",
  surface: "#ffffff",
  surfaceHigh: "#f3eee4",
  border: "#ece8fb",
  borderLight: "#e2ddf2",

  text: "#1e1b4b",
  textSecondary: "#5b5a78",
  textMuted: "#8a89a3",

  primary: "#312a8c",
  primaryText: "#ffffff",

  brand: "#d2400c",
  brandText: "#ffffff",

  growth: "#2a9258",
  growthText: "#ffffff",

  tileOffFace: "#ffffff",
  tileOffGlyph: "#1e1b4b",
  tileOffShadow: "#cfcadf",
  tileOnFace: "#d2400c",
  tileOnGlyph: "#ffffff",
  tileOnHi: "#e9683a",
  tileOnLo: "#9e2f08",
  tileSubGlyph: "#5b5a78",

  success: "#1f7544",
  error: "#b3261e",
  warning: "#b06a00",

  white: "#ffffff",
};

// "Reading" — sepia, low-glare reader theme for the book reader (the authored
// book is the hero; chrome recedes, like an e-reader page mode).
export const readingColors: Palette = {
  background: "#f3e9d2",
  surface: "#f7efdc",
  surfaceHigh: "#ece0c4",
  border: "#e0d3b5",
  borderLight: "#d6c7a4",

  text: "#3a2f1b",
  textSecondary: "#6d5d40",
  textMuted: "#8a795b",

  primary: "#312a8c",
  primaryText: "#ffffff",

  brand: "#a23708",
  brandText: "#ffffff",

  growth: "#1f7544",
  growthText: "#ffffff",

  tileOffFace: "#f7efdc",
  tileOffGlyph: "#3a2f1b",
  tileOffShadow: "#cdbd99",
  tileOnFace: "#a23708",
  tileOnGlyph: "#ffffff",
  tileOnHi: "#c2592a",
  tileOnLo: "#7a2906",
  tileSubGlyph: "#6d5d40",

  success: "#1f7544",
  error: "#9e2b22",
  warning: "#9a6300",

  white: "#ffffff",
};

// "Gilded Noir" — editorial charcoal + single gold accent (reader-leaning,
// premium). Single-accent by design: growth/brand collapse into gold (§2.3 of
// the theming proposal) — the a11y test gates text legibility, not the accent.
export const gildedNoirColors: Palette = {
  background: "#0d0d0d", surface: "#1a1a1a", surfaceHigh: "#242424",
  border: "#262626", borderLight: "#2f2f2f",
  text: "#f5f5f4", textSecondary: "#d6d3d1", textMuted: "#a8a29e",
  primary: "#c9a84c", primaryText: "#0d0d0d",
  brand: "#c9a84c", brandText: "#0d0d0d",
  growth: "#c9a84c", growthText: "#0d0d0d",
  tileOffFace: "#1a1a1a", tileOffGlyph: "#f0d78c", tileOffShadow: "#000000",
  tileOnFace: "#c9a84c", tileOnGlyph: "#0d0d0d", tileOnHi: "#f0d78c", tileOnLo: "#9a7f2f",
  tileSubGlyph: "#a8a29e",
  success: "#7fae86", error: "#c96a5c", warning: "#d1a24c",
  white: "#ffffff",
};

// "Forest & Moss" — greenhouse-at-dusk green + moss accent (reader-leaning,
// closest to the botanical growing-mind brand). The green accent already IS the
// growth semantic, so its single-accent collapse is softer than Noir's gold.
export const forestMossColors: Palette = {
  background: "#1a3c2a", surface: "#2d5a3d", surfaceHigh: "#356848",
  border: "#366348", borderLight: "#3f7452",
  text: "#f5f5f4", textSecondary: "#d6d3d1", textMuted: "#a8a29e",
  primary: "#5a8a5c", primaryText: "#0d2016",
  brand: "#5a8a5c", brandText: "#0d2016",
  growth: "#5a8a5c", growthText: "#0d2016",
  tileOffFace: "#2d5a3d", tileOffGlyph: "#a0c49d", tileOffShadow: "#0d2016",
  tileOnFace: "#5a8a5c", tileOnGlyph: "#0d2016", tileOnHi: "#a0c49d", tileOnLo: "#3f7452",
  tileSubGlyph: "#a8a29e",
  success: "#7fae86", error: "#c96a5c", warning: "#d1a24c",
  white: "#ffffff",
};

// "Navy Trust" — the SME studio brand (ADR-038): deep navy + a single restrained
// gold accent, warm cream text. Editorial, trustworthy, Anthropic-adjacent — the
// look of the design export ported to RN (OKLCH → the export's own hex fallbacks:
// navy #101828, card #1b2436, cream #F7F4EE, gold #D9A75A). Single-accent like
// Gilded Noir (brand/growth collapse to gold); gold is an ACCENT — components must
// use it for small marks (rules, labels, icons, badges), never a large fill.
export const navyTrustColors: Palette = {
  background: "#101828", surface: "#1b2436", surfaceHigh: "#24304a",
  border: "#2a3550", borderLight: "#35425f",
  text: "#f7f4ee", textSecondary: "#cdd2df", textMuted: "#98a0b5",
  primary: "#d9a75a", primaryText: "#101828",
  brand: "#d9a75a", brandText: "#101828",
  growth: "#d9a75a", growthText: "#101828",
  tileOffFace: "#1b2436", tileOffGlyph: "#e7c789", tileOffShadow: "#060a13",
  tileOnFace: "#d9a75a", tileOnGlyph: "#101828", tileOnHi: "#ecc98a", tileOnLo: "#a97e38",
  tileSubGlyph: "#98a0b5",
  success: "#7fae86", error: "#d1705a", warning: "#d6b25e",
  white: "#ffffff",
};

// "Studio" — the Studio re-skin's new navy identity (dark) and its light
// counterpart. Same shape as `colors`; dark leans on the navy/cream/gold family
// used elsewhere in the SME studio surfaces, light inverts to a warm paper
// background with a darker gold/green for AA contrast on white.
export const studioDarkColors: Palette = {
  background: "#0A0E1A", surface: "#131E36", surfaceHigh: "#1B2842",
  border: "#323846", borderLight: "#4E5565",
  text: "#F4F7FC", textSecondary: "#C6D4EC", textMuted: "#93A6C6",
  primary: "#F0DCAC", primaryText: "#0A0E1A",
  brand: "#F0DCAC", brandText: "#0A0E1A",
  growth: "#F0DCAC", growthText: "#0A0E1A",
  tileOffFace: "#131E36", tileOffGlyph: "#F0DCAC", tileOffShadow: "#05070E",
  tileOnFace: "#F0DCAC", tileOnGlyph: "#0A0E1A", tileOnHi: "#F7E9C6", tileOnLo: "#B79A5E",
  tileSubGlyph: "#93A6C6",
  success: "#8FCBAD", error: "#E29B9B", warning: "#E7C98A",
  white: "#ffffff",
};

export const studioLightColors: Palette = {
  background: "#F7F5F0", surface: "#FFFFFF", surfaceHigh: "#FAF8F2",
  border: "#CDCDCA", borderLight: "#B2B2B1",
  text: "#0C111B", textSecondary: "#3C495D", textMuted: "#6C7A8F",
  primary: "#8A6A22", primaryText: "#FFFFFF",
  brand: "#8A6A22", brandText: "#FFFFFF",
  growth: "#356E56", growthText: "#FFFFFF",
  tileOffFace: "#FFFFFF", tileOffGlyph: "#8A6A22", tileOffShadow: "#D8D3C7",
  tileOnFace: "#8A6A22", tileOnGlyph: "#FFFFFF", tileOnHi: "#A98A3E", tileOnLo: "#6A4F16",
  tileSubGlyph: "#6C7A8F",
  success: "#356E56", error: "#9C4A48", warning: "#8A6A22",
  white: "#ffffff",
};

export const themes = {
  study: colors as unknown as Palette,
  manuscript: manuscriptColors,
  reading: readingColors,
  "gilded-noir": gildedNoirColors,
  "forest-moss": forestMossColors,
  "navy-trust": navyTrustColors,
  "studio-dark": studioDarkColors,
  "studio-light": studioLightColors,
} as const;

export type ThemeName = keyof typeof themes;

// Studio re-skin (P0): the theme switcher shows only the two Studio palettes.
// Every other palette above stays DEFINED (a not-yet-migrated surface, e.g.
// the reader, may still reference one) — only the switcher's LIST is trimmed.
export const SWITCHABLE_THEMES: ThemeName[] = ["studio-dark", "studio-light"];

export const THEME_META: Record<ThemeName, { label: string; mode: "dark" | "light" | "sepia" }> = {
  study: { label: "Study", mode: "dark" },
  manuscript: { label: "Manuscript", mode: "light" },
  reading: { label: "Reading", mode: "sepia" },
  "gilded-noir": { label: "Gilded Noir", mode: "dark" },
  "forest-moss": { label: "Forest & Moss", mode: "dark" },
  "navy-trust": { label: "Navy Trust", mode: "dark" },
  "studio-dark": { label: "Studio", mode: "dark" },
  "studio-light": { label: "Studio Light", mode: "light" },
};
